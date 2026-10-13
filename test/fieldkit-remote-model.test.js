import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { WorkspaceAnalyzer, FaceModelEmitter } from '@deepseek-ai/dsh-typert-generator'
import { withFieldkitRemotes } from '../scripts/fieldkit-remote-model.mjs'

const packageName = '@fieldkit/model-test'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
await mkdir(join(root, '.dsh'), { recursive: true })
const scratch = await mkdtemp(join(root, '.dsh', 'remote-model-test-'))
after(() => rm(scratch, { recursive: true, force: true }))
let count = 0
const source = `import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Request, Result } from './dtos.js'
declare module '@deepseek-ai/cordis' { interface Context { testRemote: Probe } }
export class Probe extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'testRemote', { namespace: 'probe' }) }
  @Remote('ping')
  ping(request: Request): Promise<Result> { return Promise.resolve({ mode: request.choice, items: [], error: null }) }
}`
const dtos = `export interface Identity { readonly uid: string }
export interface Request { readonly choice: 'attach' | 'connect'; readonly identity?: Identity }
export interface Result { readonly mode: Request['choice']; readonly items: readonly Identity[]; readonly error: string | null }`

async function fixture(remoteSource = source, dtoSource = dtos, publicDtos = true) {
  const workspace = join(scratch, String(count++))
  const packageRoot = join(workspace, 'packages', 'probe')
  await mkdir(join(packageRoot, 'src'), { recursive: true })
  await writeFile(join(workspace, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  await writeFile(join(workspace, 'tsconfig.host.json'), JSON.stringify({
    compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, target: 'ES2024' },
    files: [], references: [{ path: './packages/probe/tsconfig.project.json' }],
  }))
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: packageName, type: 'module', exports: {
    '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
    ...(publicDtos ? { './remote-types': { types: './lib/types/dtos.d.ts', default: './lib/dtos.js' } } : {}),
  } }))
  await writeFile(join(packageRoot, 'tsconfig.project.json'), JSON.stringify({
    compilerOptions: { composite: true, declaration: true, emitDeclarationOnly: true, module: 'NodeNext',
      moduleResolution: 'NodeNext', target: 'ES2024', strict: true, skipLibCheck: true,
      outDir: './lib/types', rootDir: './src' }, include: ['./src/*.ts'],
  }))
  await writeFile(join(packageRoot, 'src/index.ts'), remoteSource)
  await writeFile(join(packageRoot, 'src/dtos.ts'), dtoSource)
  const model = new WorkspaceAnalyzer({ root: workspace, faces: ['host'], packages: [packageName] }).analyze()
  return { face: model.faces[0], source: remoteSource, packageRoot }
}

test('official emitter validates nested, optional, nullable, readonly and indexed DTO fields', async () => {
  const { face, source, packageRoot } = await fixture()
  const projected = withFieldkitRemotes(face, source, packageName)
  const artifact = new FaceModelEmitter(projected).emit(packageName)
  await writeFile(join(packageRoot, 'remote.mjs'), artifact.remote.js)
  const { TYPERT_REMOTE } = await import(pathToFileURL(join(packageRoot, 'remote.mjs')))
  const [descriptor] = TYPERT_REMOTE.descriptors
  assert.equal(descriptor.id, `${packageName}#probe/ping`)
  assert.equal(descriptor.service, 'testRemote')
  assert.equal(descriptor.parameters[0].codec.create().safeParse({ choice: 'attach' }).success, true)
  assert.equal(descriptor.parameters[0].codec.create().safeParse({ choice: 'attach', identity: { uid: 4 } }).success, false)
  assert.equal(descriptor.parameters[0].codec.create().safeParse({ choice: 'disconnect' }).success, false)
  assert.equal(descriptor.result.create().safeParse({ mode: 'connect', items: [{ uid: 'one' }], error: null }).success, true)
  assert.equal(descriptor.result.create().safeParse({ mode: 'connect', items: [{}], error: null }).success, false)
  assert.equal(descriptor.result.create().safeParse({ mode: 'connect', items: [] }).success, false)
  assert.match(artifact.remote.dts, /Promise<RemoteResult<Result>>/)
  assert.match(artifact.remote.dts, /@fieldkit\/model-test\/remote-types/)
})

test('endpoint and namespace changes come from authored source', async () => {
  const edited = source.replace("namespace: 'probe'", "namespace: 'other'").replace("@Remote('ping')", "@Remote('renamed')")
  const { face } = await fixture(edited)
  const [invocation] = withFieldkitRemotes(face, edited, packageName).packages[0].invocations
  assert.equal(invocation.id, `${packageName}#other/renamed`)
  assert.equal(invocation.implementation, 'ping')
})

test('unconstrained DTO fields fail closed before artifact emission', async () => {
  const { face } = await fixture(source, dtos.replace('readonly uid: string', 'readonly uid: unknown'))
  assert.throws(() => withFieldkitRemotes(face, source, packageName), /unconstrained keyword unknown/)
})

test('nonpublic boundary types and optional method parameters fail closed', async () => {
  const privateTypes = await fixture(source, dtos, false)
  assert.throws(() => withFieldkitRemotes(privateTypes.face, source, packageName), /public non-root type export/)
  const optional = source.replace('request: Request', 'request?: Request').replace('request.choice', "request?.choice ?? 'attach'")
  const { face } = await fixture(optional)
  assert.throws(() => withFieldkitRemotes(face, optional, packageName), /required plain JSON arguments/)
})

test('duplicate endpoints and stream markers fail closed', async () => {
  const duplicate = source.replace("@Remote('ping')", "@Remote('ping')\n  other(request: Request): Promise<Result> { return this.ping(request) }\n  @Remote('ping')")
  const duplicated = await fixture(duplicate)
  assert.throws(() => withFieldkitRemotes(duplicated.face, duplicate, packageName), /duplicate Remote endpoint/)
  const stream = source.replace("@Remote('ping')", "@Remote({ mode: 'stream' })")
  const streamed = await fixture(stream)
  assert.throws(() => withFieldkitRemotes(streamed.face, stream, packageName), /only @Remote\(literalName\)/)
})

test('subclasses cannot override the binding extracted from super', async () => {
  const override = source.replace('Remote, TypertRemoteService', 'Remote, TypertRemoteService, bindTypertRemote, type TypertGatewayBinding')
    .replace('  constructor(ctx: Context)', "  override readonly typertRemote: TypertGatewayBinding<this> = bindTypertRemote(this, 'other', { namespace: 'other' })\n  constructor(ctx: Context)")
  const { face } = await fixture(override)
  assert.throws(() => withFieldkitRemotes(face, override, packageName), /must not declare.*typertRemote/)
})

test('computed Remote class members cannot bypass binding checks', async () => {
  const override = source.replace('Remote, TypertRemoteService', 'Remote, TypertRemoteService, bindTypertRemote, type TypertGatewayBinding')
    .replace('  constructor(ctx: Context)', "  override readonly typertRemote: TypertGatewayBinding<this> = bindTypertRemote(this, 'other', { namespace: 'other' })\n  constructor(ctx: Context)")
  const template = override.replace('readonly typertRemote:', 'readonly [`typertRemote`]:')
  const dynamic = override.replace('export class Probe', "const bindingKey: 'typertRemote' = 'typertRemote'\nexport class Probe")
    .replace('readonly typertRemote:', 'readonly [bindingKey]:')
  for (const edited of [template, dynamic]) {
    const { face } = await fixture(edited)
    assert.throws(() => withFieldkitRemotes(face, edited, packageName), /computed Remote class members are not supported/)
  }
})

test('public Remote overloads cannot truncate the generated contract', async () => {
  const overload = source.replace("  @Remote('ping')\n  ping(request: Request): Promise<Result> { return Promise.resolve({ mode: request.choice, items: [], error: null }) }",
    "  ping(value: string): Promise<Result>\n  ping(value: number): Promise<Result>\n  @Remote('ping')\n  ping(value: string | number): Promise<Result> { return Promise.resolve({ mode: 'attach', items: [], error: null }) }")
    + '\nexport function verifyPublicOverload(probe: Probe): Promise<Result> { return probe.ping(3) }\n'
  const { face } = await fixture(overload)
  assert.throws(() => withFieldkitRemotes(face, overload, packageName), /Remote overloads are not supported/)
})
