import { lstatSync } from 'node:fs'
import {
  digest, exists, filesBelow, git, gitRead, gitTree, isAncestor, json, localPath, own, parse, read,
  readJson, requireThat, resolveCommit, sha, sha256, slug,
} from './files.mjs'
import { checkMinimumWaxVersion, loadPinnedContracts } from './contracts.mjs'
import { evidencePath, extractRegistriesV1 } from './recipes.mjs'

export const indexPath = 'catalog/index.json'
export const emptyIndex = { schema_version: 1, entries: [] }

const revisionPath = (id, revision) => `systems/${id}/revisions/${revision}`
const definitionPath = '.wax/wax.config.json'
const provenancePath = 'provenance.json'
const manifestPath = (id) => `sources/${id}.json`
const registryPath = (language) => `.wax/registries/${language}.json`
const recipeV1 = 'curated-components-v1'
const currentRecipe = recipeV1
const renderers = new Map([[recipeV1, renderBundleV1]])

function compareEntries(left, right) {
  return (left.id > right.id) - (left.id < right.id) || left.revision - right.revision
}

function artifact(path, bytes) {
  return { path, sha256: digest(bytes) }
}

function validateMetadata({ id, name, coverage, gaps }) {
  requireThat(!/^\p{White_Space}*$/u.test(name) && Buffer.byteLength(name) <= 256, `Invalid display name for ${id}`)
  for (const label of [...coverage, ...gaps]) {
    requireThat(Buffer.byteLength(label) <= 2048, `Catalogue label exceeds 2048 bytes for ${id}`)
  }
}

export function loadIndex(root, contracts) {
  const index = exists(root, indexPath) ? readJson(root, indexPath) : emptyIndex
  contracts.validate('registry-catalog', index, indexPath)
  return index
}

export function loadManifest(root, id, contracts) {
  const path = manifestPath(id)
  const manifest = readJson(root, path)
  contracts.validate('source', manifest, path)
  requireThat(manifest.id === id, `Source manifest ID does not match filename: ${path}`)
  validateMetadata(manifest)
  return manifest
}

function isGeneratorFile(path) {
  return path === 'package-lock.json'
    || (path.startsWith('scripts/') && path.endsWith('.mjs'))
    || (path.startsWith('schemas/') && path.endsWith('.json'))
}

function pinnedFiles(root, commit) {
  return Object.fromEntries(gitTree(root, commit, 'scripts', 'schemas', 'package-lock.json')
    .filter(({ path }) => isGeneratorFile(path))
    .map(({ path, mode }) => {
      requireThat(mode === '100644' || mode === '100755', `Invalid generator input at ${commit}: ${path}`)
      return [path, digest(gitRead(root, commit, path))]
    }))
}

export function pinGenerator(root) {
  const commit = git(root, 'log', '-1', '--format=%H', '--', 'scripts', 'schemas', 'package-lock.json').toString().trim()
  requireThat(sha.test(commit), 'Commit the catalogue generator and lockfile before creating a revision')
  const pinned = pinnedFiles(root, commit)
  const local = [...filesBelow(root, 'scripts'), ...filesBelow(root, 'schemas'), 'package-lock.json']
    .filter(isGeneratorFile)
  requireThat(
    local.length === Object.keys(pinned).length && local.every((path) => (
      own(pinned, path) && pinned[path] === digest(read(root, path))
    )),
    'Commit generator changes before creating a revision',
  )
  return { commit, sha256: pinned }
}

function verifyGenerator(root, pin, subdir) {
  requireThat(pin && sha.test(pin.commit) && isAncestor(root, pin.commit), `Invalid generator commit for ${subdir}`)
  const expected = pinnedFiles(root, pin.commit)
  requireThat(
    own(expected, 'scripts/generate.mjs')
      && own(expected, 'scripts/lib/recipes.mjs')
      && own(expected, 'package-lock.json')
      && json(expected) === json(pin.sha256),
    `Generator source digest mismatch for ${subdir}`,
  )
  requireThat(
    gitTree(root, pin.commit, subdir).length === 0,
    `Generator commit already contains its output: ${subdir}`,
  )
}

function renderBundleV1(root, manifest, revision, generator, contracts) {
  const subdir = revisionPath(manifest.id, revision)
  const files = new Map()
  const registries = {}
  const registrySources = {}
  for (const [language, registry] of Object.entries(extractRegistriesV1(root, manifest))) {
    const path = registryPath(language)
    contracts.validate('registry', registry, path)
    const bytes = json(registry)
    files.set(path, bytes)
    registries[language] = artifact(path, bytes)
    registrySources[language] = { source: path }
  }

  const definition = {
    schema_version: 2,
    languages: {},
    design_systems: {
      [manifest.id]: { name: manifest.name, registries: registrySources },
    },
  }
  contracts.validate('waxrc', definition, definitionPath)
  files.set(definitionPath, json(definition))

  const upstreamVersion = `commit:${manifest.upstream.commit}`
  const provenance = {
    schema_version: 1,
    id: manifest.id,
    revision,
    upstream_version: upstreamVersion,
    source: manifest,
    recipe: { name: recipeV1, overrides_sha256: digest(json(manifest.overrides)) },
    generator,
  }
  files.set(provenancePath, json(provenance))

  const entry = {
    id: manifest.id,
    name: manifest.name,
    revision,
    subdir,
    minimum_wax_version: manifest.minimum_wax_version,
    definition: artifact(definitionPath, files.get(definitionPath)),
    registries,
    provenance: artifact(provenancePath, files.get(provenancePath)),
    upstream: [{ source: manifest.upstream.repository, version: upstreamVersion }],
    coverage: manifest.coverage,
    gaps: manifest.gaps,
  }
  return { entry, files }
}

export function buildBundle(root, manifest, revision, generator, contracts, recipe = currentRecipe) {
  const render = renderers.get(recipe)
  requireThat(render, `Unknown catalogue recipe: ${recipe}`)
  const { entry, files } = render(root, manifest, revision, generator, contracts)
  const { revision: _revision, subdir: _subdir, provenance: _provenance, ...metadata } = entry
  const effectiveContent = digest(json({ source: manifest, metadata }))
  return { entry, files, source: manifest, effectiveContent }
}

function checkRegistryIdentities(registry, path) {
  for (const [entries, key] of [[registry.components ?? [], 'symbol'], [registry.tokens ?? [], 'key']]) {
    const ids = new Set()
    const names = new Set()
    for (const entry of entries) {
      requireThat(!ids.has(entry.id), `Duplicate identity ${entry.id} in ${path}`)
      ids.add(entry.id)
      for (const name of [entry[key], ...(entry.aliases ?? [])]) {
        requireThat(!names.has(name), `Duplicate ${key} or alias ${name} in ${path}`)
        names.add(name)
      }
    }
  }
}

function readArtifact(root, subdir, entry) {
  const path = `${subdir}/${entry.path}`
  const bytes = read(root, path)
  requireThat(sha256.test(entry.sha256) && digest(bytes) === entry.sha256, `Artifact digest mismatch: ${path}`)
  return parse(bytes, path)
}

export function validateBundle(root, entry) {
  const { id, revision, subdir } = entry
  requireThat(Number.isSafeInteger(revision), `Invalid revision for ${id}: ${revision}`)
  validateMetadata(entry)
  requireThat(subdir === revisionPath(id, revision), `Invalid revision subdir for ${id}: ${subdir}`)
  checkMinimumWaxVersion(entry.minimum_wax_version)
  requireThat(entry.definition.path === definitionPath, `Unexpected definition path for ${subdir}`)
  requireThat(entry.provenance.path === provenancePath, `Unexpected provenance path for ${subdir}`)

  const provenance = readArtifact(root, subdir, entry.provenance)
  requireThat(
    provenance.schema_version === 1 && provenance.id === id && provenance.revision === revision
      && renderers.has(provenance.recipe?.name),
    `Invalid provenance or unknown recipe for ${subdir}`,
  )
  verifyGenerator(root, provenance.generator, subdir)
  const contracts = loadPinnedContracts(root, provenance.generator.commit)
  contracts.validate('source', provenance.source, `${subdir}/${provenancePath} source`)
  requireThat(provenance.source.id === id, `Provenance source ID does not match ${subdir}`)
  checkMinimumWaxVersion(provenance.source.minimum_wax_version, contracts.minimumWaxVersion)

  const definition = readArtifact(root, subdir, entry.definition)
  contracts.validate('waxrc', definition, `${subdir}/${definitionPath}`)
  requireThat(
    definition.design_systems && Object.keys(definition.design_systems).length === 1
      && own(definition.design_systems, id) && definition.design_systems[id].name === entry.name,
    `Definition does not identify ${id} in ${subdir}`,
  )
  const definitionRegistries = definition.design_systems[id].registries
  requireThat(
    definitionRegistries && Object.keys(definitionRegistries).length === Object.keys(entry.registries).length,
    `Definition language map does not match catalogue for ${subdir}`,
  )

  for (const [language, target] of Object.entries(entry.registries)) {
    const path = registryPath(language)
    requireThat(target.path === path, `Unexpected ${language} registry path for ${subdir}`)
    requireThat(
      own(definitionRegistries, language) && json(definitionRegistries[language]) === json({ source: path }),
      `Definition registry source does not match catalogue for ${subdir}/${language}`,
    )
    const registry = readArtifact(root, subdir, target)
    contracts.validate('registry', registry, `${subdir}/${path}`)
    checkRegistryIdentities(registry, `${subdir}/${path}`)
  }

  const expected = buildBundle(root, provenance.source, revision, provenance.generator, contracts, provenance.recipe.name)
  requireThat(json(expected.entry) === json(entry), `Catalogue entry does not match source for ${subdir}`)
  checkBundleBytes(root, expected)
  return expected
}

export function checkBundleBytes(root, { entry, files }) {
  const actual = filesBelow(root, entry.subdir)
  requireThat(actual.length === files.size, `Unexpected files in revision tree: ${entry.subdir}`)
  for (const [path, bytes] of files) {
    const destination = `${entry.subdir}/${path}`
    requireThat(read(root, destination).equals(Buffer.from(bytes)), `Generated bytes differ: ${destination}`)
  }
}

export function sortedIndex(entries) {
  return { schema_version: 1, entries: [...entries].sort(compareEntries) }
}

export function validateCatalogue(root, index, contracts, baseRef) {
  if (baseRef) validateHistory(root, index, contracts, baseRef)
  const expectedFiles = new Set()
  const expectedEvidence = new Set()
  const latest = new Map()

  for (const entry of index.entries) {
    const previous = latest.get(entry.id)
    requireThat(
      Number.isSafeInteger(entry.revision) && entry.revision === (previous?.revision ?? 0) + 1,
      `Duplicate or non-sequential revision for ${entry.id}: ${entry.revision}`,
    )
    const { source, effectiveContent } = validateBundle(root, entry)
    requireThat(
      !previous || previous.effectiveContent !== effectiveContent,
      `Revision ${entry.revision} has unchanged effective content for ${entry.id}`,
    )
    for (const path of Object.keys(source.files)) expectedEvidence.add(evidencePath(source, path))
    for (const { path } of [entry.definition, entry.provenance, ...Object.values(entry.registries)]) {
      expectedFiles.add(`${entry.subdir}/${path}`)
    }
    latest.set(entry.id, { revision: entry.revision, source, effectiveContent })
  }

  for (const [id, { source }] of latest) {
    const candidate = readJson(root, manifestPath(id))
    requireThat(
      json(candidate) === json(source),
      `Source manifest changed without a new revision: ${manifestPath(id)}`,
    )
  }
  for (const path of filesBelow(root, 'sources')) {
    const manifest = /^sources\/([a-z][a-z0-9-]{0,127})\.json$/.exec(path)
    if (manifest) {
      requireThat(latest.has(manifest[1]), `Source manifest lacks a published revision: ${path}`)
    } else {
      requireThat(expectedEvidence.has(path), `Source is outside the catalogue allowlist: ${path}`)
    }
  }
  for (const path of filesBelow(root, 'systems')) {
    requireThat(expectedFiles.has(path), `Unindexed artifact: ${path}`)
  }
  if (exists(root, indexPath)) {
    requireThat(
      read(root, indexPath).equals(Buffer.from(json(sortedIndex(index.entries)))),
      `Generated bytes differ: ${indexPath}`,
    )
  }
}

function validateHistory(root, index, contracts, ref) {
  const base = resolveCommit(root, ref)
  const oldIndexPath = gitTree(root, base, indexPath)
  const oldIndex = oldIndexPath.length ? parse(gitRead(root, base, indexPath), `${base}:${indexPath}`) : emptyIndex
  contracts.validate('registry-catalog', oldIndex, `${base}:${indexPath}`)

  const entries = new Map(index.entries.map((entry) => [`${entry.id}@${entry.revision}`, entry]))
  const published = new Set()
  for (const entry of oldIndex.entries) {
    const key = `${entry.id}@${entry.revision}`
    requireThat(
      entries.has(key) && json(entry) === json(entries.get(key)),
      `Historical catalogue entry changed or was removed: ${key}`,
    )
    published.add(key)
  }
  for (const entry of index.entries) {
    if (!published.has(`${entry.id}@${entry.revision}`)) {
      checkMinimumWaxVersion(entry.minimum_wax_version, contracts.minimumWaxVersion)
    }
  }
  for (const { mode, path } of gitTree(root, base, 'systems', 'sources/evidence')) {
    const stat = lstatSync(localPath(root, path), { throwIfNoEntry: false })
    const expectedMode = stat?.mode & 0o111 ? '100755' : '100644'
    requireThat(
      stat?.isFile() && mode === expectedMode && read(root, path).equals(gitRead(root, base, path)),
      `Historical file changed or was removed: ${path}`,
    )
  }
}

export function assertRevisionOptions(id, revision) {
  requireThat(typeof id === 'string' && slug.test(id), 'Expected a catalogue source slug after --source')
  requireThat(
    typeof revision === 'string' && /^[1-9]\d*$/.test(revision) && Number.isSafeInteger(Number(revision)),
    'Expected a positive integer after --revision',
  )
}
