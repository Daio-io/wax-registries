import { parseArgs } from 'node:util'
import { loadIndex, validateCatalogue } from './lib/catalogue.mjs'
import { loadContracts } from './lib/contracts.mjs'
import { requireThat } from './lib/files.mjs'

try {
  const { values } = parseArgs({ options: { base: { type: 'string' } } })
  requireThat(values.base, 'Specify the history baseline with --base <git-ref>')
  const root = process.cwd()
  const contracts = loadContracts(root)
  const index = loadIndex(root, contracts)
  validateCatalogue(root, index, contracts, values.base)
  const registries = index.entries.reduce((count, entry) => count + Object.keys(entry.registries).length, 0)
  console.log(`Validated ${index.entries.length} catalogue revisions and ${registries} language registries`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
