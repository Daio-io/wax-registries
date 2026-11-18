import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

const root = new URL('../', import.meta.url)
const cwd = fileURLToPath(root)

function readJson(path) {
  return JSON.parse(readFileSync(new URL(path, root), 'utf8'))
}

const expectedSymbols = {
  astryx: {
    react: ['Avatar', 'Badge', 'Button', 'Card', 'Text'],
    swift: ['Avatar', 'Button', 'Card', 'Heading', 'Text'],
  },
  'material-m2': { compose: ['Button', 'Card', 'Checkbox', 'Switch', 'Text'] },
  'material-m3': { compose: ['Button', 'Card', 'Checkbox', 'Switch', 'Text'] },
  'radix-primitives': {
    react: ['Checkbox', 'CheckboxIndicator', 'Dialog', 'DialogContent', 'DialogTrigger',
      'Tabs', 'TabsContent', 'TabsList', 'TabsTrigger'],
  },
  'radix-themes': { react: ['Badge', 'Button', 'Checkbox', 'Separator', 'Text'] },
  shadcn: { react: ['Badge', 'Button', 'Card', 'Checkbox', 'Separator'] },
}

test('the validator accepts six pilot bundles with seven exact component registries', () => {
  const result = execFileSync(process.execPath, ['scripts/validate.mjs', '--base', 'HEAD'], {
    cwd,
    encoding: 'utf8',
  })
  const [, revisions, registries] = /Validated (\d+) catalogue revisions and (\d+) language registries/.exec(result) ?? []
  assert.ok(Number(revisions) >= 6 && Number(registries) >= 7, result.trim())

  const { entries } = readJson('catalog/index.json')
  const pilots = entries.filter(({ id, revision }) => revision === 1 && Object.hasOwn(expectedSymbols, id))
  assert.deepEqual(pilots.map(({ id }) => id), Object.keys(expectedSymbols))
  for (const { id, registries, subdir } of pilots) {
    assert.deepEqual(Object.keys(registries), Object.keys(expectedSymbols[id]))
    for (const [language, artifact] of Object.entries(registries)) {
      const registry = readJson(`${subdir}/${artifact.path}`)
      assert.deepEqual(registry.components.map(({ symbol }) => symbol).sort(), expectedSymbols[id][language])
      assert.deepEqual(registry.tokens ?? [], [])
    }
  }
})

function readFixtures(path) {
  return readFileSync(new URL(`tests/fixtures/consumers/${path}`, root), 'utf8')
}

function reactReferences(name, { includeMemberBindings = false } = {}) {
  const source = ts.createSourceFile(name, readFixtures(`react/${name}`), ts.ScriptTarget.Latest, true)
  const imports = new Map()
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const coordinate = statement.moduleSpecifier.text
    const bindings = statement.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) {
      for (const { name, propertyName } of bindings.elements) {
        imports.set(name.text, { coordinate, symbol: propertyName?.text ?? name.text })
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      imports.set(bindings.name.text, { coordinate })
    }
  }

  const references = new Set()
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName
      if (ts.isIdentifier(tag) && imports.has(tag.text)) {
        const { coordinate, symbol } = imports.get(tag.text)
        references.add(`${coordinate} ${symbol}`)
      } else if (ts.isPropertyAccessExpression(tag) && imports.has(tag.expression.getText(source))) {
        const bindingName = tag.expression.getText(source)
        const { coordinate } = imports.get(bindingName)
        references.add(`${coordinate} ${tag.name.text}`)
        if (includeMemberBindings) references.add(`${coordinate} ${bindingName}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...references].sort()
}

function registryBindings(id, language) {
  const { entries } = readJson('catalog/index.json')
  const { subdir, registries } = entries.find((entry) => entry.id === id && entry.revision === 1)
  const registry = readJson(`${subdir}/${registries[language].path}`)
  return registry.components
    .flatMap((component) => [component.symbol, ...(component.aliases ?? [])]
      .map((symbol) => `${component.package} ${symbol}`))
    .sort()
}

test('the React pilot fixtures exercise the exact registered package and symbol pairs', () => {
  for (const id of ['astryx', 'radix-primitives', 'radix-themes', 'shadcn']) {
    assert.deepEqual(reactReferences(`${id}.tsx`), registryBindings(id, 'react'), id)
  }
})

test('React registry identities exclude unsupported Radix forms and unrelated same-name imports', () => {
  const negatives = {
    'radix-primitives': [
      '@radix-ui/react-dialog Root',
      '@radix-ui/react-dialog Trigger',
      '@radix-ui/react-tabs Root',
      '@radix-ui/react-tabs Trigger',
      'radix-ui Root',
      'radix-ui Trigger',
    ],
    shadcn: [
      '@/components/base/button Button',
      '@example/ui Button',
      '@workspace/ui/button Button',
    ],
  }
  for (const [id, expected] of Object.entries(negatives)) {
    const fixture = `${id}-unsupported.tsx`
    assert.deepEqual(reactReferences(fixture), expected)
    const bindings = new Set(registryBindings(id, 'react'))
    for (const reference of reactReferences(fixture, { includeMemberBindings: true })) {
      assert.ok(!bindings.has(reference), `Unsupported reference has a registry identity: ${reference}`)
    }
  }
})

test('the Phase 4 Radix regression fixture preserves the exact namespace collision', () => {
  const fixture = 'regressions/radix-primitives-namespace-collision.tsx'
  const registered = new Set(registryBindings('radix-primitives', 'react'))
  const members = reactReferences(fixture)
  assert.deepEqual(members, ['@radix-ui/react-tabs Root', '@radix-ui/react-tabs Trigger'])
  assert.ok(members.every((member) => !registered.has(member)))
  const bindings = reactReferences(fixture, { includeMemberBindings: true })
  assert.deepEqual(bindings.filter((binding) => registered.has(binding)), ['@radix-ui/react-tabs Tabs'])
})

test('native pilot fixtures cover both Compose namespaces and the Astryx Swift module', () => {
  for (const id of ['material-m2', 'material-m3']) {
    const fixture = readFixtures(`compose/${id}.kt`)
    const imports = [...fixture.matchAll(/^import (androidx\.compose\.material3?)\.(\w+)$/gm)]
      .map(([, namespace, symbol]) => `${namespace} ${symbol}`)
    assert.deepEqual(imports.sort(), registryBindings(id, 'compose'))
  }

  const swift = readFixtures('swift/astryx.swift')
  assert.match(swift, /^import Astryx$/m)
  const constructors = [...swift.matchAll(/\b(Astryx)\.(\w+)\s*(?:\(|\{)/g)]
    .map(([, module, symbol]) => `${module} ${symbol}`)
  assert.deepEqual(constructors.sort(), registryBindings('astryx', 'swift'))
})
