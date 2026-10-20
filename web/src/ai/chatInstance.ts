// Bridge for code outside the chat widget. The chat itself is lazy-loaded
// (React.lazy), so a caller such as the dashboard quick link must not import it
// directly; it sets `openRequested` and the widget picks the request up when it
// mounts, or calls `open()` once the widget is alive.
export const aiChatState: { open: (() => void) | null; openRequested: boolean } = {
  open: null,
  openRequested: false,
}

export function openAiChat() {
  aiChatState.openRequested = true
  aiChatState.open?.()
}
