import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const own = (object, key) => Object.hasOwn(object, key)
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const slug = /^[a-z][a-z0-9-]{0,127}$/
export const sha256 = /^[0-9a-f]{64}$/
export const sha = /^[0-9a-f]{40}$/

export function requireThat(condition, message) {
  if (!condition) throw new Error(message)
}

export function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]))
  }
  return value
}

export function json(value) {
  return JSON.stringify(ordered(value), null, 2) + '\n'
}

export function localPath(root, relative) {
  const parts = relative.split('/')
  requireThat(parts.every((part) => (
    part && part !== '.' && part !== '..' && !part.startsWith('-') && !/[\\:\x00-\x1f\x7f-\x9f]/.test(part)
  )), `Invalid relative path: ${relative}`)
  let current = resolve(root)
  for (const part of parts) {
    current = join(current, part)
    requireThat(!lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink(), `Symbolic link: ${relative}`)
  }
  return current
}

export function read(root, path) {
  const absolute = localPath(root, path)
  requireThat(lstatSync(absolute, { throwIfNoEntry: false })?.isFile(), `Missing regular file: ${path}`)
  return readFileSync(absolute)
}

export function parse(bytes, path) {
  try {
    return JSON.parse(bytes)
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}: ${error.message}`)
  }
}

export function readJson(root, path) {
  return parse(read(root, path), path)
}

export function exists(root, path) {
  return lstatSync(localPath(root, path), { throwIfNoEntry: false }) !== undefined
}

export function filesBelow(root, path) {
  const absolute = localPath(root, path)
  const stat = lstatSync(absolute, { throwIfNoEntry: false })
  if (stat === undefined) return []
  if (stat.isFile()) return [path]
  requireThat(stat.isDirectory(), `Expected a regular file or directory: ${path}`)
  return readdirSync(absolute).sort().flatMap((name) => filesBelow(root, `${path}/${name}`))
}

export function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
}

export function resolveCommit(root, ref) {
  return git(root, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).toString().trim()
}

export function gitTree(root, commit, ...paths) {
  const output = git(root, 'ls-tree', '-rz', commit, '--', ...paths).toString().split('\0').filter(Boolean)
  return output.map((row) => {
    const tab = row.indexOf('\t')
    const [mode, type] = row.slice(0, tab).split(' ')
    return { mode, type, path: row.slice(tab + 1) }
  })
}

export function isAncestor(root, commit) {
  return spawnSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: root }).status === 0
}

export function gitRead(root, commit, path) {
  return git(root, 'show', `${commit}:${path}`)
}
