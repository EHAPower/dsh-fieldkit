import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const scratch = join(root, '.dsh', 'typert-build')
const workspace = join(scratch, 'workspace')
const packageDir = join(workspace, 'packages', 'dsh-fieldkit')
const generatedPackage = join(root, 'node_modules', '@deepseek-ai', 'dsh-typert-generator')
const stageGenerator = join(workspace, 'node_modules', '@deepseek-ai', 'dsh-typert-generator')
const tsc = join(generatedPackage, 'node_modules', '.bin', 'tsc')
const tsdown = join(root, 'node_modules', '.bin', 'tsdown')

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

async function json(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function patchGenerator() {
  const manifest = JSON.parse(await readFile(join(stageGenerator, 'package.json'), 'utf8'))
  if (manifest.version !== '0.2.0-rc.2') throw new Error(`Unsupported dsh-typert-generator ${manifest.version}; this compatibility patch is only audited for 0.2.0-rc.2`)
  const patches = [
    ['lib/types/analyzer.js', "        if (registration?.name === '@deepseek-ai/dsh-typert-protocol')\n            return true;\n", "        if (externalModuleIdentityForFile(declaration.getSourceFile().fileName)?.package === '@deepseek-ai/dsh-typert-protocol')\n            return true;\n"],
    ['lib/index.js', 'if (this.registrationForFile(declaration.getSourceFile().fileName)?.name === "@deepseek-ai/dsh-typert-protocol") return true;', 'if (externalModuleIdentityForFile(declaration.getSourceFile().fileName)?.package === "@deepseek-ai/dsh-typert-protocol") return true;'],
  ]
  for (const [file, needle, addition] of patches) {
    const path = join(stageGenerator, file)
    const source = await readFile(path, 'utf8')
    if (!source.includes(needle)) throw new Error(`Unsupported dsh-typert-generator 0.2.0-rc.2 layout: protocol identity predicate changed in ${file}`)
    await writeFile(path, source.replace(needle, `${needle}\n\t\t${addition}`))
  }
}

async function main() {
  if (!existsSync(generatedPackage) || !existsSync(tsc) || !existsSync(tsdown)) {
    throw new Error('Install the pinned build dependencies with npm ci --ignore-scripts before building')
  }
  await rm(scratch, { recursive: true, force: true })
  await rm(join(root, 'lib'), { recursive: true, force: true })
  await mkdir(join(root, 'lib', 'types'), { recursive: true })
  await mkdir(join(packageDir, 'src'), { recursive: true })
  await cp(join(root, 'src', 'remote.ts'), join(packageDir, 'src', 'remote.ts'))
  await cp(join(root, 'src', 'remote-types.ts'), join(packageDir, 'src', 'remote-types.ts'))
  await cp(generatedPackage, stageGenerator, { recursive: true })
  await patchGenerator()

  const stageManifest = {
    name: '@ehapower/dsh-fieldkit', version: '0.2.0', private: true, type: 'module',
    exports: {
      '.': { types: './lib/types/remote.d.ts', default: './lib/remote.js' },
      './remote-types': { types: './lib/types/remote-types.d.ts', default: './lib/remote-types.js' },
      './typert': { types: './lib/typert.host.d.ts', default: './lib/typert.host.js' },
      './remote': { types: './lib/typert.remote-client.d.ts', default: './lib/typert.remote-client.js' },
    },
    files: [
      'lib/remote.js', 'lib/remote-types.js',
      'lib/typert.host.js', 'lib/typert.host.d.ts',
      'lib/typert.remote-client.js', 'lib/typert.remote-client.d.ts',
    ],
  }
  await json(join(packageDir, 'package.json'), stageManifest)
  await json(join(workspace, 'package.json'), { private: true, type: 'module' })
  await json(join(workspace, 'tsconfig.host.json'), {
    files: [], references: [{ path: './packages/dsh-fieldkit/tsconfig.project.json' }],
  })
  await json(join(workspace, 'tsconfig.client.json'), {
    files: [], references: [{ path: './packages/dsh-fieldkit/tsconfig.project.json' }],
  })
  await json(join(packageDir, 'tsconfig.project.json'), {
    compilerOptions: {
      composite: true, declaration: true, emitDeclarationOnly: true, declarationMap: true,
      outDir: './lib/types', rootDir: './src', module: 'NodeNext', moduleResolution: 'NodeNext',
      target: 'ES2024', strict: true, skipLibCheck: true,
    },
    include: ['./src/remote.ts', './src/remote-types.ts'],
  })
  await writeFile(join(workspace, 'tsdown.config.mjs'), `import { defineConfig } from 'tsdown'\nimport { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'\nexport default defineConfig({ entry: { remote: './packages/dsh-fieldkit/src/remote.ts', 'remote-types': './packages/dsh-fieldkit/src/remote-types.ts' }, outDir: './packages/dsh-fieldkit/lib', format: 'esm', clean: false, dts: false, plugins: [typertPlugin({ mode: 'package', faces: ['host'] })] })\n`)

  run(tsc, ['-b', '--force', 'tsconfig.host.json'], workspace)
  run(tsdown, ['--config', 'tsdown.config.mjs'], workspace)
  for (const file of ['typert.host.js', 'typert.host.d.ts', 'typert.remote-client.js', 'typert.remote-client.d.ts', 'typert.remote-client.d.ts.map']) {
    const from = join(packageDir, 'lib', file)
    if (!existsSync(from)) throw new Error(`Typert generator did not emit ${file}`)
    await cp(from, join(root, 'lib', file))
  }

  await json(join(scratch, 'tsconfig.runtime.json'), {
    compilerOptions: {
      declaration: true, declarationMap: true, outDir: relative(scratch, join(root, 'lib')), rootDir: relative(scratch, join(root, 'src')),
      module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', strict: true, skipLibCheck: true,
    },
    include: [join(root, 'src', 'remote.ts'), join(root, 'src', 'remote-types.ts')],
  })
  run(tsc, ['-p', join(scratch, 'tsconfig.runtime.json')], root)
  await writeFile(join(scratch, 'client.tsdown.config.mjs'), `import { defineConfig } from 'tsdown'\nexport default defineConfig({ entry: { client: ${JSON.stringify(join(root, 'src', 'client.ts'))} }, outDir: ${JSON.stringify(join(root, 'lib'))}, format: 'cjs', clean: false, dts: false, outExtensions: () => ({ js: '.js' }), external: ['react', 'react/jsx-runtime', 'react-dom'], outputOptions: { banner: \"window.__ModuleLoader__.load({ id: '@ehapower/dsh-fieldkit', factory: (require) => { var module = { exports: {} }; var exports = module.exports;\", footer: 'return module.exports; } });' } })\n`)
  run(tsdown, ['--config', join(scratch, 'client.tsdown.config.mjs')], root)
}

await main()
