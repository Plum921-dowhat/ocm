import { useMemo } from 'react'
import XMarkdown from '@ant-design/x-markdown'

// Assistant answers are Markdown: the model emits headings, bullet lists,
// tables and fenced code, and both the mini program (components/md-view) and
// the pre-migration Carbon chat rendered them. After the Ant Design X rewrite
// the raw string was rendered inside a <div>, so every marker leaked through
// as literal text ("**bold**", "| a | b |"). This component is the single
// place that turns that string back into formatting.
//
// It is deliberately thin: the sanitizing policy, link behaviour and streaming
// handling live here so a future renderer swap only touches one file.

export interface MessageMarkdownProps {
  content: string
  /** True while the answer is still arriving; hides half-typed syntax. */
  streaming?: boolean
}

// DOMPurify already strips <script>, event handlers and javascript: URLs.
// The assistant has no legitimate need for embedded documents, form controls
// or inline styles (which could be used to overlay the rest of the console),
// so those are dropped as well. Markdown constructs are unaffected: fenced
// code becomes <pre><code>, tables become <table>, and column alignment uses
// the align attribute rather than a style attribute.
const PURIFY_CONFIG = {
  FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button', 'video', 'audio'],
  FORBID_ATTR: ['style'],
}

export default function MessageMarkdown({ content, streaming = false }: MessageMarkdownProps) {
  // A fresh object on every render would re-configure the parser on each
  // streamed token, so keep the identity stable while the status holds.
  const streamingConfig = useMemo(() => ({ hasNextChunk: streaming }), [streaming])

  return (
    <XMarkdown
      className="ai-chat__text"
      content={content}
      openLinksInNewTab
      dompurifyConfig={PURIFY_CONFIG}
      streaming={streamingConfig}
      // The panel is narrow, so the package's roomy defaults (1em block
      // margins, 2.8em list indents) are replaced by the rules in app.scss.
      disableDefaultStyles
    />
  )
}
