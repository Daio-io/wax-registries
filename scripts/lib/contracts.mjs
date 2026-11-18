import Ajv2020 from 'ajv/dist/2020.js'
import semver from 'semver'
import { digest, gitRead, own, parse, read, requireThat, sha, sha256 } from './files.mjs'

const waxSchemas = ['registry-catalog', 'registry', 'waxrc']
const pinnedContracts = new Map()

function isVersion(value) {
  if (typeof value !== 'string') return false
  const version = semver.parse(value)
  if (!version) return false
  const build = version.build.length ? `+${version.build.join('.')}` : ''
  return value === version.version + build
}

function compileContracts(readSchema) {
  const pinPath = 'schemas/wax-contract-pin.json'
  const pin = parse(readSchema(pinPath), pinPath)
  requireThat(
    pin.repository === 'https://github.com/Daio-io/wax'
      && pin.upstream_directory === 'engine/crates/wax-contract/schemas'
      && sha.test(pin.commit)
      && isVersion(pin.minimum_wax_version)
      && pin.sha256 && typeof pin.sha256 === 'object'
      && Object.keys(pin.sha256).length === waxSchemas.length,
    'Invalid Wax schema contract pin',
  )

  const ajv = new Ajv2020({ allErrors: true, strict: false })
  const validators = new Map()
  for (const name of waxSchemas) {
    const filename = `${name}.schema.json`
    const path = `schemas/${filename}`
    const bytes = readSchema(path)
    requireThat(
      own(pin.sha256, filename) && sha256.test(pin.sha256[filename]) && pin.sha256[filename] === digest(bytes),
      `Wax schema drift: ${path}`,
    )
    validators.set(name, ajv.compile(JSON.parse(bytes)))
  }
  const sourcePath = 'schemas/source.schema.json'
  validators.set('source', ajv.compile(parse(readSchema(sourcePath), sourcePath)))

  return {
    minimumWaxVersion: pin.minimum_wax_version,
    validate(schema, value, path) {
      const validator = validators.get(schema)
      requireThat(
        validator(value),
        `${path} does not satisfy ${schema} schema: ${ajv.errorsText(validator.errors)}`,
      )
    },
  }
}

export function loadContracts(root) {
  return compileContracts((path) => read(root, path))
}

export function loadPinnedContracts(root, commit) {
  const key = `${root}\0${commit}`
  if (!pinnedContracts.has(key)) {
    pinnedContracts.set(key, compileContracts((path) => gitRead(root, commit, path)))
  }
  return pinnedContracts.get(key)
}

export function checkMinimumWaxVersion(version, floor) {
  requireThat(isVersion(version), `Invalid minimum Wax version: ${version}`)
  if (floor) {
    requireThat(semver.gte(version, floor), `Minimum Wax version ${version} is below contract floor ${floor}`)
  }
}
