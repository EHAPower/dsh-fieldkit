import ts from 'typescript'
import { isTypertRemoteSegment } from '@deepseek-ai/dsh-typert-protocol'

function requireShape(condition, message) {
  if (!condition) throw new Error(`fieldkit Remote build: ${message}`)
}

// The plugin owns this restricted unary-JSON projection; the official emitter owns artifacts/codecs.
export function withFieldkitRemotes(face, source, packageName) {
  const file = ts.createSourceFile('remote.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const protocolImport = file.statements.find(statement => ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier)
    && statement.moduleSpecifier.text === '@deepseek-ai/dsh-typert-protocol')
  const imports = protocolImport?.importClause?.namedBindings
  requireShape(imports && ts.isNamedImports(imports), 'expected named official protocol imports')
  const localName = name => imports.elements.find(element => (element.propertyName?.text ?? element.name.text) === name)?.name.text
  const remoteName = localName('Remote')
  const baseName = localName('TypertRemoteService')
  requireShape(remoteName && baseName, 'expected official Remote and TypertRemoteService imports')
  const classes = file.statements.filter(statement => ts.isClassDeclaration(statement)
    && statement.heritageClauses?.some(clause => clause.token === ts.SyntaxKind.ExtendsKeyword
      && clause.types.some(type => ts.isIdentifier(type.expression) && type.expression.text === baseName)))
  requireShape(classes.length === 1 && classes[0].name, 'expected one TypertRemoteService class')
  const declaration = classes[0]
  requireShape(!declaration.members.some(member => member.name && ts.isComputedPropertyName(member.name)), 'computed Remote class members are not supported')
  const memberName = member => {
    const name = member.name
    if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) return name.text
  }
  requireShape(!declaration.members.some(member => memberName(member) === 'typertRemote'), 'TypertRemoteService subclasses must not declare a second typertRemote binding')
  const constructor = declaration.members.find(ts.isConstructorDeclaration)
  const calls = constructor?.body?.statements.filter(statement => ts.isExpressionStatement(statement)
    && ts.isCallExpression(statement.expression) && statement.expression.expression.kind === ts.SyntaxKind.SuperKeyword) ?? []
  requireShape(calls.length === 1, 'expected one explicit super(ctx, serviceKey, options) call')
  const [context, serviceArgument, options] = calls[0].expression.arguments
  requireShape(context && ts.isIdentifier(context) && serviceArgument && ts.isStringLiteral(serviceArgument), 'service binding must use a literal key')
  let namespace = serviceArgument.text
  if (options) {
    requireShape(ts.isObjectLiteralExpression(options) && options.properties.length === 1, 'only a literal namespace option is supported')
    const property = options.properties[0]
    requireShape(ts.isPropertyAssignment(property) && property.name.getText(file) === 'namespace'
      && ts.isStringLiteral(property.initializer), 'namespace must be a string literal')
    namespace = property.initializer.text
  }
  requireShape(calls[0].expression.arguments.length <= 3 && isTypertRemoteSegment(serviceArgument.text)
    && isTypertRemoteSegment(namespace), 'invalid service/namespace binding')

  const packageModel = face.packages.find(candidate => candidate.name === packageName)
  requireShape(packageModel && packageModel.invocations.length === 0, 'expected an unmodified analyzer model without Remote invocations')
  const classModel = face.graph.declarations.find(candidate => candidate.package === packageName && candidate.name === declaration.name.text)
  requireShape(classModel?.kind === 'class', 'Remote class is missing from the public type graph')
  const nodes = new Map(face.graph.nodes.map(node => [node.id, node]))
  const declarations = new Map(face.graph.declarations.map(item => [item.id, item]))
  const codecs = new Map()
  const active = new Set()
  const codecNodes = []
  const getNode = id => {
    const node = nodes.get(id)
    requireShape(node, `missing type node ${id}`)
    return node
  }
  const codec = id => {
    if (codecs.has(id)) return codecs.get(id)
    requireShape(!active.has(id), 'recursive DTOs are outside the supported JSON subset')
    active.add(id)
    const node = getNode(id)
    let projected
    switch (node.kind) {
      case 'keyword':
        requireShape(['string', 'number', 'boolean'].includes(node.name), `non-JSON or unconstrained keyword ${node.name}`)
        projected = { kind: 'keyword', name: node.name }
        break
      case 'literal':
        requireShape(node.value === null || ['string', 'boolean'].includes(typeof node.value)
          || typeof node.value === 'number' && Number.isFinite(node.value), 'non-JSON literal')
        projected = { kind: 'literal', value: node.value, text: node.text }
        break
      case 'parenthesized': projected = { kind: 'parenthesized', type: codec(node.type) }; break
      case 'union': projected = { kind: 'union', types: node.types.map(codec) }; break
      case 'array': projected = { kind: 'array', element: codec(node.element) }; break
      case 'operator':
        requireShape(node.operator === 'readonly' && getNode(node.type).kind === 'array', 'only readonly array operators are supported')
        projected = { kind: 'parenthesized', type: codec(node.type) }
        break
      case 'indexed-access': {
        const owner = getNode(node.object)
        const key = getNode(node.index)
        requireShape(owner.kind === 'reference' && owner.target.kind === 'declaration' && key.kind === 'literal'
          && typeof key.value === 'string', 'only named DTO property indexing is supported')
        const member = declarations.get(owner.target.symbol)?.members.find(item => item.name === key.value)
        requireShape(member?.kind === 'property' && !member.optional, 'indexed property must be a required DTO property')
        projected = { kind: 'parenthesized', type: codec(member.type) }
        break
      }
      case 'reference': {
        requireShape(node.target.kind === 'declaration' && node.arguments.length === 0, 'only local non-generic DTO references are supported')
        const dto = declarations.get(node.target.symbol)
        requireShape(dto?.package === packageName && dto.typeParameters.length === 0
          && dto.extends.length === 0 && dto.implements.length === 0, 'DTO must be local and have no generic or inherited shape')
        requireShape(dto.kind === 'interface' || dto.kind === 'alias', 'class values cannot cross the JSON boundary')
        projected = dto.kind === 'alias'
          ? { kind: 'parenthesized', type: codec(dto.type) }
          : { kind: 'object', members: propertyCodecs(dto.members) }
        break
      }
      case 'object': projected = { kind: 'object', members: propertyCodecs(node.members) }; break
      default: requireShape(false, `unsupported JSON type ${node.kind}`)
    }
    const codecId = `fieldkit-codec:${id}`
    codecNodes.push({ id: codecId, ...projected })
    codecs.set(id, codecId)
    active.delete(id)
    return codecId
  }
  const propertyCodecs = members => members.map(member => {
    requireShape(member.kind === 'property' && !member.computed && member.visibility === 'public'
      && !member.static, 'DTOs may only contain public JSON properties')
    return { ...member, type: codec(member.type) }
  })
  const boundary = (type, fallback) => {
    const imports = new Map()
    const visit = id => {
      const node = getNode(id)
      if (node.kind === 'reference') {
        requireShape(node.target.kind === 'declaration', 'Remote boundary must use public local types')
        const exported = packageModel.exports.find(item => item.symbol === node.target.symbol
          && item.subpath !== '.' && !['./typert', './remote'].includes(item.subpath))
        requireShape(exported, `Remote type ${node.name} needs a public non-root type export`)
        imports.set(node.target.symbol, { symbol: node.target.symbol, specifier: `${packageName}${exported.subpath.slice(1)}`, name: exported.name })
      } else if (node.kind === 'union') node.types.forEach(visit)
      else if (node.kind === 'parenthesized') visit(node.type)
      else requireShape(node.kind === 'keyword' || node.kind === 'literal', 'unsupported authored Remote boundary')
    }
    visit(type)
    const root = getNode(type)
    const named = root.kind === 'reference' ? imports.get(root.target.symbol) : undefined
    return {
      type, codecType: codec(type), acceptsUndefined: false,
      typeSymbol: named ? `${named.specifier}#${named.name}` : fallback,
      imports: [...imports.values()],
    }
  }
  const invocations = []
  const methodDeclarations = declaration.members.filter(ts.isMethodDeclaration)
  for (const method of methodDeclarations) {
    const decorators = ts.getDecorators(method) ?? []
    if (decorators.length === 0) continue
    const marker = decorators[0].expression
    requireShape(decorators.length === 1 && ts.isCallExpression(marker) && ts.isIdentifier(marker.expression)
      && marker.expression.text === remoteName && marker.arguments.length === 1 && ts.isStringLiteral(marker.arguments[0]), 'only @Remote(literalName) unary methods are supported')
    requireShape(ts.isIdentifier(method.name) && method.body && !method.typeParameters?.length, 'Remote methods must be concrete non-generic identifier methods')
    const models = classModel.members.filter(member => member.name === method.name.text)
    requireShape(methodDeclarations.filter(candidate => memberName(candidate) === method.name.text).length === 1
      && models.length === 1, 'Remote overloads are not supported; each method needs one source declaration and model')
    const model = models[0]
    requireShape(model?.kind === 'method' && model.visibility === 'public' && !model.static, 'Remote method must be public and non-static')
    requireShape(method.parameters.every(parameter => !parameter.initializer && !parameter.dotDotDotToken)
      && model.signature.parameters.every(parameter => parameter.binding === 'identifier' && !parameter.optional && !parameter.rest && !parameter.receiver), 'Remote parameters must be required plain JSON arguments')
    const exportedName = marker.arguments[0].text
    requireShape(isTypertRemoteSegment(exportedName) && !invocations.some(item => item.method === exportedName), 'invalid or duplicate Remote endpoint')
    const id = `${packageName}#${namespace}/${exportedName}`
    const result = getNode(model.signature.returns)
    requireShape(result.kind === 'reference' && result.target.kind === 'standard' && result.target.name === 'Promise'
      && result.arguments.length === 1, 'Remote results must be Promise<JSON DTO>')
    invocations.push({
      id, service: serviceArgument.text, namespace, method: exportedName,
      ...(exportedName === model.name ? {} : { implementation: model.name }),
      invocation: { kind: 'direct' },
      parameters: model.signature.parameters.map(parameter => ({ name: parameter.name, wire: parameter.name,
        source: 'json', boundary: boundary(parameter.type, `${id}:${parameter.name}`) })),
      result: boundary(result.arguments[0], `${id}:result`), location: model.location,
    })
  }
  requireShape(invocations.length > 0, 'no Remote methods found')
  return { ...face, packages: face.packages.map(item => item === packageModel ? { ...item, invocations } : item),
    graph: { ...face.graph, nodes: [...face.graph.nodes, ...codecNodes] } }
}
