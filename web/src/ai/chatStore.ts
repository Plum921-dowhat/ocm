import { apiStream } from '../auth/api'
import i18n from '../i18n/index'
import type { AiProposal, AiTool } from './aiChatItems'

// The conversation lives outside React on purpose.
//
// AiChat is mounted once by the app shell, but the shell itself can remount
// (auth bootstrap, downstream layout overrides, hot reload). Keeping the
// session in a module store means switching pages — or remounting the shell —
// keeps both the open window and the message history. It is also what lets the
// dashboard shortcut open the window from anywhere.
export interface ChatMessage {
  key: string
  role: 'user' | 'assistant'
  content: string
  tools?: AiTool[]
  proposal?: AiProposal | null
  error?: string
  status?: 'streaming' | 'done' | 'aborted'
}

export interface ChatState {
  open: boolean
  messages: ChatMessage[]
  streaming: boolean
  /** Unsent text, kept here so closing the panel does not discard a draft. */
  draft: string
}

let state: ChatState = { open: false, messages: [], streaming: false, draft: '' }
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

function patch(next: Partial<ChatState>) {
  state = { ...state, ...next }
  emit()
}

export function subscribeChat(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getChatState(): ChatState {
  return state
}

export function openChat() {
  if (!state.open) patch({ open: true })
}

export function closeChat() {
  if (state.open) patch({ open: false })
}

export function toggleChat() {
  patch({ open: !state.open })
}

export function setChatDraft(draft: string) {
  if (state.draft !== draft) patch({ draft })
}

// Non-render state: the in-flight request, the transcript sent to the backend,
// and the signed-in owner. `session` invalidates callbacks from an aborted run
// so a reset cannot be overwritten by a late stream chunk.
let abort: AbortController | null = null
let history: Array<{ role: string; content: string }> = []
let owner: number | null = null
let session = 0
let seq = 0

const nextKey = () => `m-${Date.now()}-${seq++}`

export function abortChat() {
  abort?.abort()
}

export function resetChat() {
  session += 1
  abort?.abort()
  abort = null
  history = []
  patch({ messages: [], streaming: false, draft: '' })
}

// A different account must not inherit the previous conversation. The id is
// stable across shell remounts, so this only fires on login/logout.
export function bindChatOwner(id: number | null) {
  if (owner === id) return
  owner = id
  resetChat()
}

// Logout: drop the transcript and close the panel. Without this the next
// session would inherit both, because the store outlives the app shell.
export function clearChatSession() {
  resetChat()
  owner = null
  patch({ open: false })
}

export async function sendChat(raw: string, token: string | null) {
  const text = raw.trim()
  if (!text || state.streaming) return

  const current = session
  const assistantKey = nextKey()
  patch({
    messages: [
      ...state.messages,
      { key: nextKey(), role: 'user', content: text, status: 'done' },
      { key: assistantKey, role: 'assistant', content: '', tools: [], status: 'streaming' },
    ],
    streaming: true,
    draft: '',
  })

  const update = (next: Partial<ChatMessage>) => {
    if (session !== current) return
    patch({ messages: state.messages.map((m) => (m.key === assistantKey ? { ...m, ...next } : m)) })
  }

  let textAcc = ''
  let tools: AiTool[] = []
  let proposal: AiProposal | null = null
  let failed = ''
  let aborted = false
  // Deltas arrive per token; coalesce state updates so a long answer does not
  // re-render the whole transcript hundreds of times.
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let dirty = false

  const flush = () => {
    flushTimer = null
    if (!dirty) return
    dirty = false
    update({ content: textAcc })
  }
  const scheduleFlush = () => {
    dirty = true
    if (!flushTimer) flushTimer = setTimeout(flush, 60)
  }

  const onEvent = (name: string, data: Record<string, any> | null) => {
    if (name === 'delta' && data?.content) {
      textAcc += data.content
      scheduleFlush()
    } else if (name === 'tool') {
      if (data!.status === 'running') {
        tools = [...tools, { name: data!.name, status: 'running' }]
      } else {
        tools = tools.map((tool) =>
          tool.name === data!.name && tool.status === 'running' ? { ...tool, status: data!.status } : tool,
        )
      }
      update({ tools: tools.map((tool) => ({ ...tool })) })
    } else if (name === 'proposal') {
      proposal = { ...data, state: 'proposed', error: '' } as AiProposal
      update({ proposal })
    } else if (name === 'error') {
      failed = data?.message || i18n.t('error.fallback', { ns: 'aiChat' })
    }
    // 'done' needs no handling: the stream ending is what finalizes the bubble.
  }

  const { promise, controller } = apiStream('/api/ai/chat', {
    token,
    body: { messages: [...history, { role: 'user', content: text }] },
    onEvent,
  })
  abort = controller

  try {
    await promise
  } catch (err) {
    if ((err as Error).name === 'AbortError') aborted = true
    else failed = (err as Error).message
  } finally {
    if (flushTimer) clearTimeout(flushTimer)
    if (abort === controller) abort = null
    // A reset (new chat / account switch) threw this transcript away; do not
    // resurrect it or leak its text into the next conversation.
    if (session === current) {
      history = [...history, { role: 'user', content: text }]
      if (textAcc) history.push({ role: 'assistant', content: textAcc })
      if (aborted) {
        tools = tools.map((tool) => (tool.status === 'running' ? { ...tool, status: 'error' } : tool))
      }
      patch({
        messages: state.messages.map((m) =>
          m.key === assistantKey
            ? {
                ...m,
                content: textAcc,
                tools,
                proposal,
                error: failed || undefined,
                status: aborted ? 'aborted' : 'done',
              }
            : m,
        ),
        streaming: false,
      })
    }
  }
}
