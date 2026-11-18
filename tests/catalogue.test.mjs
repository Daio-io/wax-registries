import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('../', import.meta.url))
const upstreamCommit = 'd3904aade51e16f1c3c4d6e22140c2740c966c33'
const evidence = `sources/evidence/sample-ui/${upstreamCommit}`
const manifestPath = 'sources/sample-ui.json'
const sourcePath = 'src/button.tsx'
const registryPath = 'systems/sample-ui/revisions/1/.wax/registries/react.json'

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function write(cwd, path, value) {
  const destination = join(cwd, path)
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, value)
}

function writeJson(cwd, path, value) {
  write(cwd, path, JSON.stringify(value, null, 2) + '\n')
}

function readJson(cwd, path) {
  return JSON.parse(readFileSync(join(cwd, path), 'utf8'))
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function command(cwd, script, ...args) {
  const result = spawnSync(process.execPath, [`scripts/${script}.mjs`, ...args], { cwd, encoding: 'utf8' })
  return { status: result.status, output: result.stderr + result.stdout }
}

function succeeded(result) {
  assert.equal(result.status, 0, result.output)
}

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'wax-catalogue-test-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  git(cwd, 'init', '-b', 'main')
  git(cwd, 'config', 'user.name', 'Test Maintainer')
  git(cwd, 'config', 'user.email', 'catalogue-test@example.com')
  git(cwd, 'commit', '--allow-empty', '-m', 'Empty catalogue')
  git(cwd, 'branch', 'baseline')
  for (const path of ['scripts', 'schemas', 'package-lock.json']) {
    cpSync(join(repository, path), join(cwd, path), { recursive: true })
  }
  symlinkSync(join(repository, 'node_modules'), join(cwd, 'node_modules'), 'junction')
  git(cwd, 'add', 'scripts', 'schemas', 'package-lock.json')
  git(cwd, 'commit', '-m', 'Add catalogue tooling')

  const sourceFiles = {
    LICENSE: readFileSync(join(repository, 'LICENSE'), 'utf8').replace(/^Copyright .+$/m, 'Copyright (c) 2026 Sample UI'),
    'package.json': JSON.stringify({ name: '@sample/ui', version: '1.0.0', source: `./${sourcePath}` }),
    [sourcePath]: 'export function Button() { return null }\n',
  }
  for (const [path, value] of Object.entries(sourceFiles)) {
    write(cwd, `${evidence}/${path}`, value)
  }
  writeJson(cwd, manifestPath, {
    id: 'sample-ui',
    name: 'Sample UI',
    upstream: { repository: 'https://github.com/example/sample-ui', commit: upstreamCommit },
    minimum_wax_version: readJson(cwd, 'schemas/wax-contract-pin.json').minimum_wax_version,
    coverage: ['React Button'],
    gaps: ['Styling tokens and other components'],
    license: { spdx: 'MIT', files: ['LICENSE'] },
    files: Object.fromEntries(Object.entries(sourceFiles).map(([path, value]) => [path, digest(value)])),
    packages: [{
      coordinate: '@sample/ui', channel: 'stable', supported_line: 'Pinned source',
      manifest: 'package.json', version: '1.0.0',
    }],
    registries: {
      react: [{
        id: 'button',
        symbol: 'Button',
        package: '@sample/ui',
        source: sourcePath,
        documentation: 'https://example.com/ui/button',
      }],
    },
    overrides: {},
  })
  return cwd
}

test('generates and validates a reproducible registry from pinned source', (t) => {
  const cwd = fixture(t)
  succeeded(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'))
  const first = readFileSync(join(cwd, registryPath))
  assert.deepEqual(JSON.parse(first).components.map(({ id, symbol, package: coordinate }) => (
    { id, symbol, package: coordinate }
  )), [{ id: 'button', symbol: 'Button', package: '@sample/ui' }])
  succeeded(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'))
  assert.deepEqual(readFileSync(join(cwd, registryPath)), first)
  succeeded(command(cwd, 'generate', '--check'))
  succeeded(command(cwd, 'validate', '--base', 'baseline'))
})

test('requires a top-level Compose component and records its import namespace and package version', (t) => {
  const cwd = fixture(t)
  const manifest = readJson(cwd, manifestPath)
  const namespace = 'androidx.compose.material'
  const declaration = 'src/Button.kt'
  const metadata = 'libraryversions.toml'
  const inputs = {
    [declaration]: `package androidx.compose.material
private object Hidden {
  @Composable
  public fun Button() {}
}
`,
    [metadata]: 'COMPOSE = "1.14.0-alpha01"\n',
  }
  for (const [path, value] of Object.entries(inputs)) {
    write(cwd, `${evidence}/${path}`, value)
    manifest.files[path] = digest(value)
  }
  delete manifest.files[sourcePath]
  delete manifest.files['package.json']
  rmSync(join(cwd, evidence, sourcePath))
  rmSync(join(cwd, evidence, 'package.json'))
  manifest.packages = [{
    coordinate: 'androidx.compose.material:material',
    import: namespace,
    version: '1.14.0-alpha01',
    manifest: metadata,
    version_key: 'COMPOSE',
    channel: 'alpha',
    supported_line: 'Pinned source',
  }]
  manifest.registries = {
    compose: [{
      id: 'button',
      symbol: 'Button',
      package: namespace,
      source: declaration,
      documentation: 'https://example.com/material/button',
    }],
  }
  writeJson(cwd, manifestPath, manifest)

  rejected(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'), /Missing public component declaration Button/)
  snapshot(cwd, declaration, `package androidx.compose.material
/* /* nested comment */ { */
private const val json = """{ "key": "value"
@Composable
public fun Button() {}
"""
@Composable
public fun Button() {}
`)
  succeeded(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'))
  const root = 'systems/sample-ui/revisions/1'
  const [button] = readJson(cwd, `${root}/.wax/registries/compose.json`).components
  assert.equal(button.package, namespace)
  assert.equal(button.details.source_evidence.start_line, 8)
  assert.equal(readJson(cwd, `${root}/provenance.json`).source.packages[0].version, '1.14.0-alpha01')
  succeeded(command(cwd, 'validate', '--base', 'baseline'))
})

function rejected(result, diagnostic) {
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, diagnostic)
}

function snapshot(cwd, path, value) {
  const manifest = readJson(cwd, manifestPath)
  manifest.files[path] = digest(value)
  write(cwd, `${evidence}/${path}`, value)
  writeJson(cwd, manifestPath, manifest)
}

function published(cwd) {
  succeeded(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'))
  git(cwd, 'add', 'catalog', 'sources', 'systems')
  git(cwd, 'commit', '-m', 'Publish sample catalogue')
  git(cwd, 'branch', 'published')
}

test('follows a pinned React entrypoint through named and star re-exports', (t) => {
  const cwd = fixture(t)
  snapshot(cwd, 'src/index.ts', "export * from './components/index.js'\n")
  snapshot(cwd, 'src/components/index.tsx', "export { Button } from '../button.js'\n")
  const manifest = readJson(cwd, manifestPath)
  manifest.registries.react[0].checks = [{ path: 'src/index.ts', kind: 'typescript-export' }]
  writeJson(cwd, manifestPath, manifest)

  succeeded(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'))
  succeeded(command(cwd, 'generate', '--check'))
})

test('a React type-only re-export fails the runtime export check', (t) => {
  const cwd = fixture(t)
  snapshot(cwd, 'src/index.ts', "export type { Button } from './button'\n")
  const manifest = readJson(cwd, manifestPath)
  manifest.registries.react[0].checks = [{ path: 'src/index.ts', kind: 'typescript-export' }]
  writeJson(cwd, manifestPath, manifest)

  rejected(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'), /Missing public export Button/)
})

const generationFailures = [
  ['source file is missing', (cwd) => rmSync(join(cwd, evidence, sourcePath)), /Missing regular file.*button\.tsx/],
  ['source file is outside the allowlist', (cwd, manifest) => delete manifest.files[sourcePath], /outside the allowlist/],
  ['source digest differs', (cwd) => write(cwd, `${evidence}/${sourcePath}`, 'edited\n'), /Source digest mismatch/],
  ['public declaration is missing', (cwd, manifest) => { manifest.registries.react[0].symbol = 'Missing' }, /Missing public component declaration Missing/],
  ['component is private', (cwd, manifest) => {
    const content = 'function Button() { return null }\n'
    write(cwd, `${evidence}/${sourcePath}`, content)
    manifest.files[sourcePath] = digest(content)
  }, /Missing public export Button/],
  ['duplicate component id', (cwd, manifest) => {
    manifest.registries.react.push({ ...manifest.registries.react[0], symbol: 'Different' })
  }, /Duplicate component id/],
  ['license is missing', (cwd, manifest) => {
    rmSync(join(cwd, evidence, 'LICENSE'))
    delete manifest.files.LICENSE
  }, /outside the allowlist.*LICENSE/],
  ['minimum engine predates the contract', (cwd, manifest) => { manifest.minimum_wax_version = '0.10.0' }, /below contract floor/],
]
for (const [name, alter, diagnostic] of generationFailures) {
  test(`generation rejects a manifest when ${name}`, (t) => {
    const cwd = fixture(t)
    const manifest = readJson(cwd, manifestPath)
    alter(cwd, manifest)
    writeJson(cwd, manifestPath, manifest)

    rejected(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'), diagnostic)
  })
}

function changeArtifact(cwd, key, alter, rehash = true) {
  const index = readJson(cwd, 'catalog/index.json')
  const entry = index.entries[0]
  const artifact = key === 'react' ? entry.registries.react : entry[key]
  const path = join(entry.subdir, artifact.path)
  const document = readJson(cwd, path)
  alter(document)
  writeJson(cwd, path, document)
  if (rehash) {
    artifact.sha256 = digest(readFileSync(join(cwd, path)))
    writeJson(cwd, 'catalog/index.json', index)
  }
}

const validationFailures = [
  ['registry digest differs', (cwd) => changeArtifact(cwd, 'react', (registry) => {
    registry.components = []
  }, false), /Artifact digest mismatch/],
  ['registry schema is unsupported', (cwd) => changeArtifact(cwd, 'react', (registry) => {
    registry.schema_version = 999
  }), /does not satisfy registry schema/],
  ['registry IDs clash', (cwd) => changeArtifact(cwd, 'react', (registry) => {
    registry.components.push({ ...registry.components[0], symbol: 'Duplicate' })
  }), /Duplicate identity button/],
  ['definition language map differs', (cwd) => changeArtifact(cwd, 'definition', (definition) => {
    definition.design_systems['sample-ui'].registries = {
      react: { source: '.wax/registries/react.json' },
      swift: { source: '.wax/registries/swift.json' },
    }
  }), /Definition language map/],
  ['definition registry path differs', (cwd) => changeArtifact(cwd, 'definition', (definition) => {
    definition.design_systems['sample-ui'].registries.react.source = '.wax/registries/other.json'
  }), /Definition registry source/],
  ['catalogue registry path leaves its bundle', (cwd) => {
    const index = readJson(cwd, 'catalog/index.json')
    index.entries[0].registries.react.path = '../other/.wax/registries/react.json'
    writeJson(cwd, 'catalog/index.json', index)
  }, /does not satisfy registry-catalog schema|Unexpected react registry path/],
  ['vendored schema drifts from its contract pin', (cwd) => {
    const schemaPath = 'schemas/registry.schema.json'
    write(cwd, schemaPath, readFileSync(join(cwd, schemaPath), 'utf8') + '\n')
  }, /Wax schema drift/],
]
for (const [name, alter, diagnostic] of validationFailures) {
  test(`validation rejects a catalogue when ${name}`, (t) => {
    const cwd = fixture(t)
    published(cwd)
    alter(cwd)

    rejected(command(cwd, 'validate', '--base', 'baseline'), diagnostic)
  })
}

test('blocks historical edits and deletions while appending a revision', (t) => {
  const cwd = fixture(t)
  published(cwd)
  const manifest = readJson(cwd, manifestPath)
  manifest.gaps.push('Animated states')
  writeJson(cwd, manifestPath, manifest)
  succeeded(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '2'))
  succeeded(command(cwd, 'validate', '--base', 'published'))

  changeArtifact(cwd, 'react', (registry) => { registry.components[0].symbol = 'Edited' }, false)
  rejected(command(cwd, 'validate', '--base', 'published'), /Historical file changed or was removed/)
  rmSync(join(cwd, 'systems/sample-ui/revisions/1'), { recursive: true })
  rejected(command(cwd, 'validate', '--base', 'published'), /Historical file changed or was removed/)
})

test('detects removed historical index entries', (t) => {
  const cwd = fixture(t)
  published(cwd)
  writeJson(cwd, 'catalog/index.json', { schema_version: 1, entries: [] })
  rejected(command(cwd, 'validate', '--base', 'published'), /Historical catalogue entry changed or was removed/)
})

test('requires changed inputs and a consecutive revision number', (t) => {
  const cwd = fixture(t)
  published(cwd)
  rejected(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '2'), /Effective content is unchanged/)
  const generatorPath = 'scripts/generate.mjs'
  write(cwd, generatorPath, readFileSync(join(cwd, generatorPath), 'utf8') + '\n')
  git(cwd, 'add', generatorPath)
  git(cwd, 'commit', '-m', 'Change tooling without changing generation')
  rejected(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '2'), /Effective content is unchanged/)
  const manifest = readJson(cwd, manifestPath)
  manifest.name = 'Sample UI revised'
  writeJson(cwd, manifestPath, manifest)
  rejected(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'), /Revision 1 is immutable/)
  rejected(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '3'), /Revision must increase by one/)
  succeeded(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '2'))
  succeeded(command(cwd, 'validate', '--base', 'published'))
})

test('groups Swift and React under one revision and requires a top-level Swift module export', (t) => {
  const cwd = fixture(t)
  const swiftPath = 'packages/apple/Sources/SampleUI/Button/Button.swift'
  const packagePath = 'packages/apple/Package.swift'
  snapshot(cwd, swiftPath, `import SwiftUI
internal enum Hidden {
  public struct Button: View {}
}
`)
  snapshot(cwd, packagePath, '.library(name: "SampleUI", targets: ["SampleUI"]),\n')
  const manifest = readJson(cwd, manifestPath)
  manifest.packages.push({ coordinate: 'SampleUI', channel: 'experimental', supported_line: 'Pinned source' })
  manifest.registries.swift = [{
    id: 'button',
    symbol: 'Button',
    package: 'SampleUI',
    source: swiftPath,
    documentation: 'https://example.com/ui/apple/button',
  }]
  writeJson(cwd, manifestPath, manifest)

  rejected(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'), /Swift module product evidence/)
  manifest.registries.swift[0].checks = [{ kind: 'swift-product', path: packagePath, symbol: 'SampleUI' }]
  writeJson(cwd, manifestPath, manifest)
  rejected(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'), /Missing public component declaration Button/)
  snapshot(cwd, swiftPath, `import SwiftUI
/* /* nested comment */ { */
private let json = #"""
{ "key": "value"
public struct Button: View {}
"""#
public struct Button: View {}
`)
  succeeded(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'))
  succeeded(command(cwd, 'validate', '--base', 'baseline'))
  const index = readJson(cwd, 'catalog/index.json')
  assert.equal(index.entries.length, 1)
  assert.deepEqual(Object.keys(index.entries[0].registries), ['react', 'swift'])
  const [button] = readJson(cwd, 'systems/sample-ui/revisions/1/.wax/registries/swift.json').components
  assert.equal(button.details.source_evidence.start_line, 7)
})

test('replays a published revision after a reviewed schema upgrade', (t) => {
  const cwd = fixture(t)
  published(cwd)
  const schemaPath = 'schemas/registry.schema.json'
  const newContract = readJson(cwd, schemaPath)
  newContract.properties.schema_version.const = 2
  writeJson(cwd, schemaPath, newContract)
  const pinPath = 'schemas/wax-contract-pin.json'
  const newPin = readJson(cwd, pinPath)
  newPin.sha256['registry.schema.json'] = digest(readFileSync(join(cwd, schemaPath)))
  newPin.minimum_wax_version = '0.12.0'
  writeJson(cwd, pinPath, newPin)
  const manifestSchemaPath = 'schemas/source.schema.json'
  const newManifestSchema = readJson(cwd, manifestSchemaPath)
  newManifestSchema.required.push('new_policy')
  writeJson(cwd, manifestSchemaPath, newManifestSchema)
  git(cwd, 'add', 'schemas')
  git(cwd, 'commit', '-m', 'Upgrade the catalogue schemas')

  succeeded(command(cwd, 'generate', '--check'))
  succeeded(command(cwd, 'validate', '--base', 'published'))
})

test('rejects abbreviated license headers as evidence', (t) => {
  const cwd = fixture(t)
  snapshot(cwd, 'LICENSE', 'MIT License\nCopyright (c) Example Project\n')

  rejected(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'), /Missing complete MIT license/)
})

test('accepts a minimum Wax version with SemVer build metadata', (t) => {
  const cwd = fixture(t)
  const manifest = readJson(cwd, manifestPath)
  manifest.minimum_wax_version = '0.11.0-alpha.1+catalogue'
  writeJson(cwd, manifestPath, manifest)

  succeeded(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'))
  succeeded(command(cwd, 'validate', '--base', 'baseline'))
})

test('uses the package’s public entrypoint even when a component check is omitted', (t) => {
  const cwd = fixture(t)
  snapshot(cwd, 'package.json', JSON.stringify({
    name: '@sample/ui',
    version: '1.0.0',
    exports: { '.': './src/index.ts' },
  }))
  snapshot(cwd, 'src/index.ts', 'export const Text = () => null\n')
  const manifest = readJson(cwd, manifestPath)
  manifest.packages[0].version = '1.0.0'
  manifest.packages[0].manifest = 'package.json'
  writeJson(cwd, manifestPath, manifest)
  rejected(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'), /Missing public export Button.*src\/index.ts/)

  snapshot(cwd, 'src/index.ts', "export { Button } from './button.js'\n")
  succeeded(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'))
  succeeded(command(cwd, 'validate', '--base', 'baseline'))
})

test('rejects React packages whose export map does not expose the package root', (t) => {
  const cwd = fixture(t)
  for (const exports of [
    {},
    { './button': './src/button.tsx' },
    { '.': {} },
    { '.': null },
    { '.': { types: './dist/index.d.ts' } },
    [],
  ]) {
    snapshot(cwd, 'package.json', JSON.stringify({
      name: '@sample/ui',
      version: '1.0.0',
      source: './src/button.tsx',
      exports,
    }))
    rejected(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'), /Package root export is missing/)
  }
})

test('requires an explicit source entrypoint for a dist-only package', (t) => {
  const cwd = fixture(t)
  snapshot(cwd, 'package.json', JSON.stringify({
    name: '@sample/ui',
    version: '1.0.0',
    exports: { '.': { default: './dist/index.js', types: './dist/index.d.ts' } },
  }))
  snapshot(cwd, 'src/index.ts', "export { Button } from './button.js'\n")
  const manifest = readJson(cwd, manifestPath)
  manifest.packages[0].version = '1.0.0'
  manifest.packages[0].manifest = 'package.json'
  writeJson(cwd, manifestPath, manifest)
  rejected(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'), /Curate an allowlisted TypeScript entrypoint/)

  manifest.packages[0].entrypoint = 'src/index.ts'
  writeJson(cwd, manifestPath, manifest)
  succeeded(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'))
})

test('rejects a whitespace-only display name', (t) => {
  const cwd = fixture(t)
  const manifest = readJson(cwd, manifestPath)
  manifest.name = '   '
  writeJson(cwd, manifestPath, manifest)
  rejected(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'), /source schema: data\/name/)
})

test('requires a pinned package manifest for React npm imports', (t) => {
  const cwd = fixture(t)
  const manifest = readJson(cwd, manifestPath)
  delete manifest.packages[0].manifest
  delete manifest.packages[0].version
  writeJson(cwd, manifestPath, manifest)

  rejected(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'), /Missing pinned package\.json/)
})

test('checks Rust catalogue display-name and label bounds in UTF-8 bytes', (t) => {
  const cwd = fixture(t)
  const manifest = readJson(cwd, manifestPath)

  for (const name of ['\u0085\t', 'é'.repeat(129)]) {
    writeJson(cwd, manifestPath, { ...manifest, name })
    rejected(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'), /Invalid display name/)
  }
  writeJson(cwd, manifestPath, { ...manifest, gaps: ['é'.repeat(1025)] })
  rejected(command(cwd, 'generate', '--source', 'sample-ui', '--revision', '1'), /Catalogue label exceeds 2048 bytes/)
})
