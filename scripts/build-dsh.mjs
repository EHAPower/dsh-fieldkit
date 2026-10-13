import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { WorkspaceAnalyzer, FaceModelEmitter } from '@deepseek-ai/dsh-typert-generator'
import { withFieldkitRemotes } from './fieldkit-remote-model.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const scratch = join(root, '.dsh', 'typert-build')
const workspace = join(scratch, 'workspace')
const packageDir = join(workspace, 'packages', 'dsh-fieldkit')
const tsc = join(root, 'node_modules', '.bin', 'tsc')
const tsdown = join(root, 'node_modules', '.bin', 'tsdown')

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

async function json(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function main() {
  if (!existsSync(tsc) || !existsSync(tsdown)) {
    throw new Error('Install the pinned build dependencies with npm ci --ignore-scripts before building')
  }
  await rm(scratch, { recursive: true, force: true })
  await rm(join(root, 'lib'), { recursive: true, force: true })
  await mkdir(join(root, 'lib', 'types'), { recursive: true })
  await mkdir(join(packageDir, 'src'), { recursive: true })
  await cp(join(root, 'src', 'remote.ts'), join(packageDir, 'src', 'remote.ts'))
  await cp(join(root, 'src', 'remote-types.ts'), join(packageDir, 'src', 'remote-types.ts'))

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
    compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2024', strict: true },
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
  run(tsc, ['-b', '--force', 'tsconfig.host.json'], workspace)
  const model = new WorkspaceAnalyzer({ root: workspace, faces: ['host'], packages: [stageManifest.name], checkDiagnostics: false }).analyze()
  const face = withFieldkitRemotes(model.faces[0], await readFile(join(packageDir, 'src/remote.ts'), 'utf8'), stageManifest.name)
  const artifact = new FaceModelEmitter(face).emit(stageManifest.name)
  if (!artifact.remote) throw new Error('Official emitter did not emit the Fieldkit Remote contract')
  for (const [file, content] of Object.entries({
    'typert.host.js': artifact.js, 'typert.host.d.ts': artifact.dts,
    'typert.remote-client.js': artifact.remote.js, 'typert.remote-client.d.ts': artifact.remote.dts,
    'typert.remote-client.d.ts.map': artifact.remote.dtsMap,
  })) {
    await writeFile(join(root, 'lib', file), content)
  }

  await json(join(scratch, 'tsconfig.runtime.json'), {
    compilerOptions: {
      declaration: true, declarationMap: true, outDir: relative(scratch, join(root, 'lib')), rootDir: relative(scratch, join(root, 'src')),
      module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', strict: true, skipLibCheck: true,
    },
    include: [join(root, 'src', 'remote.ts'), join(root, 'src', 'remote-types.ts')],
  })
  run(tsc, ['-p', join(scratch, 'tsconfig.runtime.json')], root)
  await writeFile(join(scratch, 'client.tsdown.config.mjs'), `import { defineConfig } from 'tsdown'\nexport default defineConfig({ entry: { client: ${JSON.stringify(join(root, 'src', 'client.ts'))} }, outDir: ${JSON.stringify(join(root, 'lib'))}, format: 'cjs', inputOptions: (options) => { const { define, ...rest } = options; return { ...rest, transform: { ...rest.transform, define } } }, define: { 'process.env.NODE_ENV': '\"production\"' }, clean: false, dts: false, outExtensions: () => ({ js: '.js' }), external: ['react', 'react/jsx-runtime', 'react-dom'], outputOptions: { banner: \"window.__ModuleLoader__.load({ id: '@ehapower/dsh-fieldkit', factory: (require) => { var module = { exports: {} }; var exports = module.exports;\", footer: 'return module.exports; } });' } })\n`)
  run(tsdown, ['--config', join(scratch, 'client.tsdown.config.mjs')], root)
}

await main()
