import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  assertRevisionOptions, buildBundle, checkBundleBytes, indexPath, loadIndex, loadManifest,
  pinGenerator, sortedIndex, validateBundle, validateCatalogue,
} from './lib/catalogue.mjs'
import { checkMinimumWaxVersion, loadContracts } from './lib/contracts.mjs'
import { exists, git, json, localPath, requireThat } from './lib/files.mjs'

function publish(root, index, bundle) {
  const stage = mkdtempSync(join(root, '.catalogue-stage-'))
  try {
    for (const [path, bytes] of bundle.files) {
      const destination = join(stage, 'revision', path)
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, bytes)
    }
    writeFileSync(join(stage, 'index.json'), json(index))

    const { subdir } = bundle.entry
    if (exists(root, subdir)) {
      // An interrupted publication may have written the complete bundle before updating the index.
      checkBundleBytes(root, bundle)
    } else {
      const destination = localPath(root, subdir)
      mkdirSync(dirname(destination), { recursive: true })
      renameSync(join(stage, 'revision'), destination)
    }
    const destination = localPath(root, indexPath)
    mkdirSync(dirname(destination), { recursive: true })
    renameSync(join(stage, 'index.json'), destination)
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

function generate(root, contracts, source, revision) {
  const lock = git(root, 'rev-parse', '--path-format=absolute', '--git-path', 'wax-catalogue-generate.lock')
    .toString().trim()
  try {
    writeFileSync(lock, `${process.pid}\n`, { flag: 'wx' })
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Generation is locked at ${lock}. If the recorded PID has exited, remove the lock and retry.`)
    }
    throw error
  }
  try {
    const index = loadIndex(root, contracts)
    const manifest = loadManifest(root, source, contracts)
    checkMinimumWaxVersion(manifest.minimum_wax_version, contracts.minimumWaxVersion)
    const history = index.entries.filter((entry) => entry.id === source)
    const existing = history.find((entry) => entry.revision === revision)
    if (existing) {
      const published = validateBundle(root, existing)
      requireThat(json(published.source) === json(manifest), `Revision ${revision} is immutable; generate a new revision`)
      console.log(`${source} revision ${revision} is unchanged`)
      return
    }
    const previous = history.at(-1)
    requireThat(revision === (previous?.revision ?? 0) + 1, `Revision must increase by one for ${source}`)
    const bundle = buildBundle(root, manifest, revision, pinGenerator(root), contracts)
    if (previous) {
      const published = validateBundle(root, previous)
      requireThat(published.effectiveContent !== bundle.effectiveContent, `Effective content is unchanged for ${source}`)
    }

    const next = sortedIndex([...index.entries, bundle.entry])
    contracts.validate('registry-catalog', next, indexPath)
    publish(root, next, bundle)
    console.log(`Generated ${source} revision ${revision}`)
  } finally {
    rmSync(lock)
  }
}

try {
  const { values } = parseArgs({
    options: { source: { type: 'string' }, revision: { type: 'string' }, check: { type: 'boolean' } },
  })
  const root = process.cwd()
  const contracts = loadContracts(root)
  if (values.check) {
    requireThat(values.source === undefined && values.revision === undefined, '--check takes no other options')
    const index = loadIndex(root, contracts)
    validateCatalogue(root, index, contracts)
    console.log(`Reproduced ${index.entries.length} catalogue revisions`)
  } else {
    assertRevisionOptions(values.source, values.revision)
    generate(root, contracts, values.source, Number(values.revision))
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
