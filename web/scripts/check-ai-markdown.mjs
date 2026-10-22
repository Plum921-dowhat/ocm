#!/usr/bin/env node
// Guard the assistant's Markdown rendering.
//
// The Carbon chat rendered answer text through its own markdown-it pipeline.
// When the floating assistant moved to Ant Design X the raw string was dropped
// into a <div>, so "**bold**", "- item" and "| a | b |" showed up literally.
// Nothing failed: no type error, no console warning, just a silent loss of
// formatting. These checks keep that from happening again:
//
//   1. assistant content must go through MessageMarkdown, not a bare <div>
//   2. MessageMarkdown must actually feed the string to XMarkdown
//   3. no component may inject HTML with dangerouslySetInnerHTML
//   4. @ant-design/x-markdown must track the @ant-design/x version line
//
// Run: node scripts/check-ai-markdown.mjs   (npm test)

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')
const SRC = join(WEB, 'src')

const problems = []

function read(rel) {
  return readFileSync(join(WEB, rel), 'utf8')
}

function fail(message) {
  problems.push(message)
}

// 1. AiChat must render the answer through the wrapper.
const aiChat = read('src/ai/AiChat.tsx')
if (!/import\s+MessageMarkdown\s+from\s+['"]\.\/MessageMarkdown['"]/.test(aiChat)) {
  fail('src/ai/AiChat.tsx does not import MessageMarkdown (assistant answers would be plain text)')
}
if (!/<MessageMarkdown\b[^>]*content=\{m\.content\}/s.test(aiChat)) {
  fail('src/ai/AiChat.tsx does not render <MessageMarkdown content={m.content} />')
}
if (/<div[^>]*className="ai-chat__text"/.test(aiChat)) {
  fail('src/ai/AiChat.tsx still wraps the answer in a plain <div className="ai-chat__text">')
}

// 2. The wrapper must hand the string to a Markdown renderer.
const wrapper = read('src/ai/MessageMarkdown.tsx')
if (!/import\s+XMarkdown\s+from\s+['"]@ant-design\/x-markdown['"]/.test(wrapper)) {
  fail('src/ai/MessageMarkdown.tsx does not import XMarkdown from @ant-design/x-markdown')
}
if (!/<XMarkdown\b[^>]*content=\{content\}/s.test(wrapper)) {
  fail('src/ai/MessageMarkdown.tsx does not pass content to <XMarkdown />')
}
if (!/openLinksInNewTab/.test(wrapper)) {
  fail('src/ai/MessageMarkdown.tsx lost openLinksInNewTab (model links would navigate away from the console)')
}

// 3. Markdown is escaped and sanitized; raw HTML injection must stay absent.
function sourceFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(full)
  }
  return out
}

for (const file of sourceFiles(SRC)) {
  if (readFileSync(file, 'utf8').includes('dangerouslySetInnerHTML')) {
    fail(`${relative(WEB, file)} uses dangerouslySetInnerHTML; render Markdown through MessageMarkdown instead`)
  }
}

// 4. XMarkdown and X share a release line; a major/minor drift is untested.
const pkg = JSON.parse(read('package.json'))
const xVersion = pkg.dependencies?.['@ant-design/x']
const mdVersion = pkg.dependencies?.['@ant-design/x-markdown']
if (!mdVersion) {
  fail('package.json is missing @ant-design/x-markdown')
} else if (xVersion) {
  const line = (v) => v.replace(/^[^\d]*/, '').split('.').slice(0, 2).join('.')
  if (line(xVersion) !== line(mdVersion)) {
    fail(`@ant-design/x (${xVersion}) and @ant-design/x-markdown (${mdVersion}) are on different minor lines`)
  }
}

if (problems.length) {
  console.error('\nAI Markdown rendering checks failed:')
  for (const p of problems) console.error(`  ${p}`)
  console.error('\nAssistant answers must render through src/ai/MessageMarkdown.tsx.')
  process.exit(1)
}

console.log('ai markdown rendering OK')
