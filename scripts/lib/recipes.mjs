import { basename, dirname, isAbsolute, join } from 'node:path/posix'
import ts from 'typescript'
import { digest, own, parse, read, requireThat } from './files.mjs'

const checksForLanguage = {
  react: ['typescript-declaration', 'typescript-export'],
  swift: ['swift-public-type', 'swift-product'],
  compose: ['kotlin-composable'],
}

export function evidencePath(manifest, path) {
  return `sources/evidence/${manifest.id}/${manifest.upstream.commit}/${path}`
}

function loadEvidence(root, manifest) {
  const evidence = new Map()
  for (const [path, sha256] of Object.entries(manifest.files)) {
    const local = evidencePath(manifest, path)
    const bytes = read(root, local)
    requireThat(digest(bytes) === sha256, `Source digest mismatch: ${local}`)
    evidence.set(path, bytes.toString('utf8'))
  }
  return (path) => {
    requireThat(evidence.has(path), `Source is outside the allowlist for ${manifest.id}: ${path}`)
    return evidence.get(path)
  }
}

function verifyLicenses(root, manifest, evidence) {
  const { license } = manifest
  const requiredText = {
    MIT: [
      /Copyright\s+.*\d{4}/i,
      /permission is hereby granted, free of charge/i,
      /the above copyright notice and this permission notice shall be included/i,
      /the software is provided ["“]as is["”], without warranty of any kind/i,
      /out of or in connection with the software or the use or other dealings in the software/i,
    ],
    'Apache-2.0': [
      /Apache License Version 2\.0/i,
      /1\. Definitions\./i,
      /2\. Grant of Copyright License\./i,
      /3\. Grant of Patent License\./i,
      /4\. Redistribution\./i,
      /5\. Submission of Contributions\./i,
      /6\. Trademarks\./i,
      /7\. Disclaimer of Warranty\./i,
      /8\. Limitation of Liability\./i,
      /9\. Accepting Warranty or Additional Liability\./i,
      /END OF TERMS AND CONDITIONS/i,
    ],
  }[license.spdx]
  requireThat(
    license.files.some((path) => {
      const text = evidence(path).replace(/\s+/g, ' ')
      return requiredText.every((pattern) => pattern.test(text))
    }),
    `Missing complete ${license.spdx} license text in source evidence for ${manifest.id}`,
  )
  for (const path of license.files) {
    requireThat(evidence(path).trim(), `Empty license evidence: ${path}`)
  }
  if (license.notice) {
    requireThat(evidence(license.notice).trim(), `Empty NOTICE evidence: ${license.notice}`)
  }
  if (manifest.upstream.repository === 'https://github.com/androidx/androidx') {
    requireThat(license.spdx === 'Apache-2.0', 'AndroidX evidence requires Apache-2.0')
    const notice = read(root, 'NOTICE').toString().replace(/\s+/g, ' ')
    requireThat(
      notice.includes('The Android Open Source Project') && notice.includes('Apache License, Version 2.0'),
      'Root NOTICE is missing AndroidX copyright or license attribution',
    )
    for (const { source } of manifest.registries.compose ?? []) {
      const header = evidence(source).match(/^\s*\/\*[\s\S]*?\*\//)?.[0] ?? ''
      requireThat(
        /Copyright\s+(?:\(c\)\s+)?\d{4} The Android Open Source Project/i.test(header)
          && /Apache License, Version 2\.0|SPDX-License-Identifier: Apache-2\.0/.test(header),
        `AndroidX source is missing its original copyright or license notice: ${source}`,
      )
    }
  }
}

const esmConditions = new Set(['default', 'import', 'node', 'node-addons', 'module-sync'])
const sourceConditions = new Set([...esmConditions, 'source'])

function resolveExportTarget(target, conditions) {
  if (target == null) return target
  if (typeof target === 'string') return target.startsWith('./') ? target : false
  if (Array.isArray(target)) {
    let fallback = target.length ? undefined : null
    for (const candidate of target) {
      const result = resolveExportTarget(candidate, conditions)
      if (typeof result === 'string') return result
      if (result !== undefined) fallback = result
    }
    return fallback
  }
  if (typeof target === 'object') {
    // Matching conditions are tried in declaration order. An explicit null blocks the import.
    for (const [condition, candidate] of Object.entries(target)) {
      if (!conditions.has(condition)) continue
      const result = resolveExportTarget(candidate, conditions)
      if (result !== undefined) return result
    }
    return undefined
  }
  return false
}

function isTypeScriptTarget(value) {
  return typeof value === 'string' && /(?<!\.d)\.[cm]?tsx?$/.test(value)
}

function publicEntrypoint(pkg, document, evidence) {
  const packageDir = dirname(pkg.manifest)
  const exports = document.exports
  const includesSubpaths = exports && typeof exports === 'object' && Object.keys(exports).some((key) => key.startsWith('.'))
  const rootExport = includesSubpaths ? exports['.'] : exports
  const runtimeTarget = resolveExportTarget(rootExport, esmConditions)
  requireThat(
    exports == null || (typeof runtimeTarget === 'string' && !/\.d\.[cm]?ts$/.test(runtimeTarget)),
    `Package root export is missing from ${pkg.manifest}`,
  )
  const sourceTarget = resolveExportTarget(rootExport, sourceConditions)
  const target = [sourceTarget, document.source, document.module, document.main].find(isTypeScriptTarget)
  if (target) {
    requireThat(!isAbsolute(target), `Package entrypoint must be relative in ${pkg.manifest}`)
    const source = join(packageDir, target)
    requireThat(packageDir === '.' || source.startsWith(`${packageDir}/`), `Package entrypoint leaves ${pkg.manifest}`)
    requireThat(!pkg.entrypoint || pkg.entrypoint === source, `Package entrypoint must match ${pkg.manifest}`)
    evidence(source)
    return source
  }
  requireThat(pkg.entrypoint, `Curate an allowlisted TypeScript entrypoint for ${pkg.manifest}`)
  requireThat(
    packageDir === '.' || pkg.entrypoint.startsWith(`${packageDir}/`),
    `Curated entrypoint must be inside package directory for ${pkg.manifest}`,
  )
  evidence(pkg.entrypoint)
  return pkg.entrypoint
}

function verifyPackages(manifest, evidence) {
  const coordinates = new Set()
  const imports = new Map()
  for (const pkg of manifest.packages) {
    requireThat(!coordinates.has(pkg.coordinate), `Duplicate package coordinate: ${pkg.coordinate}`)
    coordinates.add(pkg.coordinate)
    const importKey = pkg.import ?? pkg.coordinate
    requireThat(!imports.has(importKey), `Duplicate package import: ${importKey}`)
    let entrypoint
    if (pkg.manifest) {
      const text = evidence(pkg.manifest)
      let matches
      if (pkg.version_key) {
        const assignment = new RegExp(`^[ \\t]*${pkg.version_key}[ \\t]*=[ \\t]*"([^"\\r\\n]+)"[ \\t]*(?:#.*)?$`, 'gm')
        const versions = [...text.matchAll(assignment)]
        matches = versions.length === 1 && versions[0][1] === pkg.version
      } else {
        requireThat(basename(pkg.manifest) === 'package.json', `Expected npm package.json evidence: ${pkg.manifest}`)
        requireThat(importKey === pkg.coordinate, `Npm import does not match package coordinate: ${importKey}`)
        const document = parse(text, pkg.manifest)
        matches = document.name === pkg.coordinate && document.version === pkg.version
        if (matches) entrypoint = publicEntrypoint(pkg, document, evidence)
      }
      requireThat(
        matches,
        `Package coordinate or version does not match ${pkg.manifest}`,
      )
    }
    imports.set(importKey, entrypoint)
  }
  return imports
}

function typescriptEvidence(manifest, evidence) {
  const paths = Object.keys(manifest.files).filter((path) => /\.[cm]?tsx?$/.test(path))
  const files = new Map(paths.map((path) => {
    const filename = `/${path}`
    return [filename, ts.createSourceFile(filename, evidence(path), ts.ScriptTarget.ESNext, true)]
  }))
  const directories = new Set(['/'])
  for (const filename of files.keys()) {
    for (let directory = dirname(filename); !directories.has(directory); directory = dirname(directory)) {
      directories.add(directory)
    }
  }

  const program = ts.createProgram({
    rootNames: [...files.keys()],
    options: {
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noLib: true,
      types: [],
    },
    host: {
      getSourceFile: (filename) => files.get(filename),
      getDefaultLibFileName: () => '',
      writeFile: () => { throw new Error('Source evidence cannot emit TypeScript') },
      getCurrentDirectory: () => '/',
      getCanonicalFileName: (filename) => filename,
      getNewLine: () => '\n',
      useCaseSensitiveFileNames: () => true,
      fileExists: (filename) => files.has(filename),
      directoryExists: (directory) => directories.has(directory),
      readFile: (filename) => files.get(filename)?.text,
    },
  })
  const checker = program.getTypeChecker()

  return {
    declaration(path, symbol) {
      evidence(path)
      const file = files.get(`/${path}`)
      requireThat(file, `Expected TypeScript source evidence: ${path}`)
      for (const statement of file.statements) {
        const candidates = ts.isVariableStatement(statement)
          ? statement.declarationList.declarations
          : [statement]
        for (const declaration of candidates) {
          const runtimeValue = ts.isVariableDeclaration(declaration)
            || ts.isFunctionDeclaration(declaration)
            || ts.isClassDeclaration(declaration)
          if (runtimeValue && declaration.name?.getText(file) === symbol) {
            return file.getLineAndCharacterOfPosition(declaration.name.getStart(file)).line + 1
          }
        }
      }
      return null
    },
    exports(path, symbol, source) {
      evidence(path)
      const file = files.get(`/${path}`)
      const module = file && checker.getSymbolAtLocation(file)
      const exported = module && checker.getExportsOfModule(module).find((entry) => entry.name === symbol)
      if (!exported || checker.getTypeOnlyAliasDeclaration(exported)) return false
      const value = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
      return value.valueDeclaration?.getSourceFile().fileName === `/${source}`
    },
  }
}

function blockCommentEnd(text, start) {
  const delimiters = /\/\*|\*\//g
  delimiters.lastIndex = start
  let depth = 1
  for (const token of text.matchAll(delimiters)) {
    depth += token[0] === '/*' ? 1 : -1
    if (depth === 0) return token.index + token[0].length
  }
  return text.length
}

const nativeTrivia = /\/\/[^\r\n]*|\/\*|(#*)("""|")|(')/

function triviaEnd(text, token, kotlin) {
  const [opener, hashes = '', doubleQuote, singleQuote] = token
  const start = token.index + opener.length
  if (opener === '/*') return blockCommentEnd(text, start)
  const quote = doubleQuote ?? singleQuote
  return quote ? stringEnd(text, start, quote, hashes, kotlin) : start
}

function interpolationEnd(text, start, kotlin) {
  const [open, close] = kotlin ? ['{', '}'] : ['(', ')']
  const tokens = new RegExp(nativeTrivia.source + (kotlin ? '|[{}]' : '|[()]'), 'g')
  tokens.lastIndex = start
  let depth = 1
  for (let token = tokens.exec(text); token; token = tokens.exec(text)) {
    if (token[0] === open) {
      depth += 1
    } else if (token[0] === close) {
      depth -= 1
      if (depth === 0) return tokens.lastIndex
    } else {
      tokens.lastIndex = triviaEnd(text, token, kotlin)
    }
  }
  return text.length
}

function stringEnd(text, start, quote, hashes, kotlin) {
  const delimiter = quote + hashes
  const escape = '\\' + hashes
  const interpolation = kotlin ? '${' : escape + '('
  for (let index = start; index < text.length; index += 1) {
    if (text.startsWith(delimiter, index)) return index + delimiter.length
    if (quote !== "'" && text.startsWith(interpolation, index)) {
      index = interpolationEnd(text, index + interpolation.length, kotlin) - 1
    } else if (!(kotlin && quote === '"""') && text.startsWith(escape, index)) {
      index += escape.length
    }
  }
  return text.length
}

// Mask trivia without shifting source line numbers or counting braces inside literals.
function maskNativeTrivia(text, { kotlin = false, keepStrings = false } = {}) {
  const trivia = new RegExp(nativeTrivia, 'g')
  let result = ''
  let cursor = 0
  for (let token = trivia.exec(text); token; token = trivia.exec(text)) {
    result += text.slice(cursor, token.index)
    const end = triviaEnd(text, token, kotlin)
    const value = text.slice(token.index, end)
    result += keepStrings && !value.startsWith('/') ? value : value.replace(/[^\r\n]/g, ' ')
    cursor = trivia.lastIndex = end
  }
  return result + text.slice(cursor)
}

function* topLevelMatches(text, pattern) {
  const braces = /[{}]/g
  let brace = braces.exec(text)
  let depth = 0
  for (const match of text.matchAll(pattern)) {
    while (brace && brace.index < match.index) {
      depth += brace[0] === '{' ? 1 : -1
      brace = braces.exec(text)
    }
    if (depth === 0) yield match
  }
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

function publicSwiftType(source, symbol) {
  const text = maskNativeTrivia(source)
  const pattern = new RegExp(`^[ \\t]*public\\s+(?:(?:final|nonisolated)\\s+)?(?:struct|class|enum)\\s+${RegExp.escape(symbol)}\\b`, 'gm')
  for (const match of topLevelMatches(text, pattern)) return lineOf(text, match.index)
  return null
}

function publicKotlinComposable(source, symbol, namespace) {
  const text = maskNativeTrivia(source, { kotlin: true })
  const packageDeclaration = /^\s*package\s+([\w.]+)\s*$/m.exec(text)
  if (packageDeclaration?.[1] !== namespace) return null
  const pattern = new RegExp(
    `^[ \\t]*@Composable\\b(?:\\s+@[^\\r\\n]+)*\\s+((?:\\w+\\s+)*)fun\\s+${RegExp.escape(symbol)}\\s*\\(`,
    'gm',
  )
  for (const match of topLevelMatches(text, pattern)) {
    if (!/\b(private|internal|protected)\b/.test(match[1])) {
      return lineOf(text, match.index + match[0].lastIndexOf(symbol))
    }
  }
  return null
}

function isShadcnCopiedSource(manifest, source, coordinate) {
  const file = /^apps\/v4\/registry\/bases\/radix\/ui\/([a-z][a-z0-9-]*)\.tsx$/.exec(source)
  return manifest.upstream.repository === 'https://github.com/shadcn-ui/ui'
    && file && coordinate === `@/components/ui/${file[1]}`
}

function verifyComponents(manifest, language, components, evidence, imports) {
  const ids = new Set()
  const symbols = new Set()
  const overrides = own(manifest.overrides, language) ? manifest.overrides[language] : {}
  const typescript = language === 'react' ? typescriptEvidence(manifest, evidence) : null
  const rows = []
  for (const component of components) {
    const { id, symbol, package: coordinate, source, checks = [] } = component
    const override = own(overrides, id) ? overrides[id] : undefined
    const { aliases = [], documentation } = { ...component, ...override }

    requireThat(imports.has(coordinate), `Component import is outside the package allowlist: ${coordinate}`)
    requireThat(!ids.has(id), `Duplicate component id in ${language}: ${id}`)
    ids.add(id)
    for (const name of [symbol, ...aliases]) {
      requireThat(!symbols.has(name), `Duplicate component symbol or alias in ${language}: ${name}`)
      symbols.add(name)
    }

    const declarationSymbol = checks.find((check) => (
      check.kind === 'typescript-declaration' && check.path === source
    ))?.symbol ?? symbol
    const nativeSource = typescript ? null : evidence(source)
    const declarations = {
      react: () => typescript.declaration(source, declarationSymbol),
      swift: () => {
        const productEvidence = checks.find(({ kind }) => kind === 'swift-product')
        requireThat(productEvidence, `Missing Swift module product evidence for ${symbol}`)
        const sourceRoot = join(dirname(productEvidence.path), 'Sources', coordinate)
        requireThat(source.startsWith(`${sourceRoot}/`), `Swift module does not match source path: ${source}`)
        return publicSwiftType(nativeSource, symbol)
      },
      compose: () => publicKotlinComposable(nativeSource, symbol, coordinate),
    }
    const startLine = declarations[language]()
    requireThat(startLine, `Missing public component declaration ${symbol} in ${source}`)

    for (const check of checks) {
      requireThat(checksForLanguage[language].includes(check.kind), `Invalid ${language} check: ${check.kind}`)
      const expected = check.symbol ?? symbol
      const text = evidence(check.path)
      const passed = {
        'typescript-declaration': () => typescript.declaration(check.path, expected),
        'typescript-export': () => typescript.exports(check.path, expected, source),
        'swift-public-type': () => publicSwiftType(text, expected),
        'swift-product': () => {
          requireThat(expected === coordinate, `Swift product does not match module: ${expected}`)
          const escaped = RegExp.escape(expected)
          return new RegExp(`\\.library\\s*\\(\\s*name:\\s*"${escaped}"\\s*,\\s*targets:\\s*\\[\\s*"${escaped}"\\s*\\]`).test(maskNativeTrivia(text, { keepStrings: true }))
        },
        'kotlin-composable': () => publicKotlinComposable(text, expected, coordinate),
      }[check.kind]()
      requireThat(passed, `Missing public export ${expected} in ${check.path} (${check.kind})`)
    }

    if (typescript) {
      const publishedEntrypoint = imports.get(coordinate)
      requireThat(
        publishedEntrypoint || isShadcnCopiedSource(manifest, source, coordinate),
        `Missing pinned package.json public entrypoint for React import ${coordinate}`,
      )
      const entrypoint = publishedEntrypoint ?? source
      for (const name of [symbol, ...aliases]) {
        requireThat(
          typescript.exports(entrypoint, name, source),
          `Missing public export ${name} for ${coordinate} at ${entrypoint}`,
        )
      }
    } else {
      const checkKind = language === 'swift' ? 'swift-public-type' : 'kotlin-composable'
      for (const name of aliases) {
        requireThat(
          checks.some((check) => check.kind === checkKind && check.symbol === name),
          `Missing public evidence for ${language} alias ${name}`,
        )
      }
    }

    const row = {
      id,
      symbol,
      package: coordinate,
      details: {
        status: 'partial',
        source_evidence: { path: source, start_line: startLine },
        documentation,
      },
    }
    if (aliases.length) row.aliases = [...aliases].sort()
    rows.push(row)
  }
  for (const id of Object.keys(overrides)) {
    requireThat(ids.has(id), `Override refers to unknown ${language} component: ${id}`)
  }
  return rows.sort((left, right) => (left.id > right.id) - (left.id < right.id))
}

export function extractRegistriesV1(root, manifest) {
  const evidence = loadEvidence(root, manifest)
  verifyLicenses(root, manifest, evidence)
  const imports = verifyPackages(manifest, evidence)
  for (const language of Object.keys(manifest.overrides)) {
    requireThat(own(manifest.registries, language), `Override refers to unknown registry: ${language}`)
  }
  return Object.fromEntries(Object.entries(manifest.registries).map(([language, components]) => [
    language,
    { schema_version: 1, components: verifyComponents(manifest, language, components, evidence, imports) },
  ]))
}
