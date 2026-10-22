#!/usr/bin/env node
// Guard the table column budget.
//
// Ant Design takes column widths literally: a column with `width` is rendered at
// that width under `table-layout: fixed`, and `scroll.x` decides how wide the
// table body is. Get the two out of sync and either the table scrolls sideways
// on a normal screen (scroll.x < the sum) or every column gets squeezed below
// its design width (scroll.x > the sum). Both happened in the Carbon -> Ant
// Design migration, so this check keeps the pair honest:
//
//   1. sum(column widths) <= scroll.x       - no column is rendered narrower
//                                             than its configured width
//   2. scroll.x <= CONTENT_WIDTH            - the table still fits a 1440px
//                                             screen without horizontal scroll
//
// Tables whose scroll.x is a computed expression are skipped (nothing to check
// statically) and reported, so they stay visible in the output.
//
// Run: node scripts/check-table-widths.mjs   (npm test)

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// 1440px window minus the 264px sidebar and the page gutters (measured).
const CONTENT_WIDTH = 1144

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'src', 'pages')

/** Files under src/pages (recursively; the tree is flat today). */
function pageFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...pageFiles(full))
    else if (name.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** Index just past the bracket that closes `open` at `start`, or -1. */
function matchBracket(src, start, open = '[', close = ']') {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    if (src[i] === open) depth++
    else if (src[i] === close) {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/** `<Table ...>` opening tags, skipping the generic parameter list. */
function tableTags(src) {
  const tags = []
  const re = /<Table\b(?:<[^>]*>)?/g
  let m
  while ((m = re.exec(src))) {
    let i = re.lastIndex
    let depth = 0
    // Walk to the matching `>` of the opening tag, ignoring `>` inside braces
    // (arrow functions) and strings.
    for (; i < src.length; i++) {
      const ch = src[i]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      else if (ch === '>' && depth === 0) break
    }
    tags.push({ start: m.index, end: i + 1, text: src.slice(m.index, i + 1) })
    re.lastIndex = i + 1
  }
  return tags
}

/** Column widths declared in `const NAME: TableColumnsType<...> = [...]`. */
function columnWidths(src, name) {
  const re = new RegExp(`const\\s+${name}\\s*(?::[^=]+)?=\\s*\\[`)
  const m = re.exec(src)
  if (!m) return null
  const arrStart = src.indexOf('[', m.index)
  const arrEnd = matchBracket(src, arrStart)
  if (arrEnd === -1) return null
  const body = src.slice(arrStart, arrEnd)
  const widths = [...body.matchAll(/width:\s*(\d+)/g)].map((x) => Number(x[1]))
  // Conditional columns appended after the literal (e.g. the actions column).
  const pushRe = new RegExp(`${name}\\.push\\(\\{`, 'g')
  let p
  while ((p = pushRe.exec(src))) {
    const objStart = src.indexOf('{', p.index)
    const objEnd = matchBracket(src, objStart, '{', '}')
    if (objEnd === -1) continue
    const chunk = src.slice(objStart, objEnd)
    const w = /width:\s*(\d+)/.exec(chunk)
    if (w) widths.push(Number(w[1]))
  }
  return widths
}

const problems = []
const skipped = []
let checked = 0

for (const file of pageFiles(SRC)) {
  const src = readFileSync(file, 'utf8')
  const rel = relative(join(HERE, '..'), file)
  for (const tag of tableTags(src)) {
    const cols = /columns=\{(\w+)\}/.exec(tag.text)
    if (!cols) continue
    const scroll = /scroll=\{\{\s*x:\s*(\d+)\s*\}\}/.exec(tag.text)
    if (!scroll) {
      // Tables sized purely by their container are fine; only note computed ones.
      if (/scroll=\{\{\s*x:\s*[^}\d]/.test(tag.text)) skipped.push({ rel, reason: 'computed scroll.x' })
      continue
    }
    const widths = columnWidths(src, cols[1])
    if (widths === null) {
      skipped.push({ rel, reason: `columns=${cols[1]} not found as a literal array` })
      continue
    }
    const sum = widths.reduce((a, b) => a + b, 0)
    const x = Number(scroll[1])
    checked++
    const line = src.slice(0, tag.start).split('\n').length
    if (sum > x) {
      problems.push(`${rel}:${line}  columns ${cols[1]} sum=${sum} > scroll.x=${x} (columns would be squeezed)`)
    }
    if (x > CONTENT_WIDTH) {
      problems.push(`${rel}:${line}  scroll.x=${x} > ${CONTENT_WIDTH} (horizontal scroll on a 1440px screen)`)
    }
  }
}

for (const s of skipped) console.log(`skip  ${s.rel}  (${s.reason})`)
console.log(`checked ${checked} table(s)`)

if (problems.length) {
  console.error('\nTable column budget violated:')
  for (const p of problems) console.error(`  ${p}`)
  console.error('\nFix by trimming widths so their sum fits scroll.x, and scroll.x fits the 1144px content area.')
  process.exit(1)
}

console.log('table column budget OK')
