import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { Alert, Avatar, Button, FloatButton, Tag, Tooltip } from 'antd'
import { Bubble, Prompts, Sender, Welcome } from '@ant-design/x'
import { CloseOutlined, PlusOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { aiChatState } from './chatInstance'
import { ProposalCard, ThinkingChain } from './aiChatItems'
import MessageMarkdown from './MessageMarkdown'
import {
  abortChat,
  bindChatOwner,
  closeChat,
  getChatState,
  openChat,
  resetChat,
  sendChat,
  setChatDraft,
  subscribeChat,
} from './chatStore'

// AiChat is the floating assistant: a launcher in the bottom-right corner that
// opens a compact panel (~380×620) instead of a full-height drawer, so the page
// underneath stays readable.
//
// The panel is rendered as a fixed element *outside* the layout flow (see
// AppShell): as a flex child of Layout it would claim width and squeeze the
// content. Its state lives in chatStore, so navigating between pages — even a
// shell remount — keeps both the window and the conversation.
export default function AiChat() {
  const { t } = useTranslation('aiChat')
  const { token, user } = useAuth()
  const tokenRef = useRef(token)
  tokenRef.current = token

  const { open, messages, streaming, draft } = useSyncExternalStore(
    subscribeChat,
    getChatState,
    getChatState,
  )
  const scrollRef = useRef<HTMLDivElement>(null)

  // A different account must not inherit the previous conversation.
  useEffect(() => {
    bindChatOwner(user?.id ?? null)
  }, [user?.id])

  // Let non-React callers (dashboard quick link) open the window. A request
  // fired before the lazy chunk finished loading is replayed on mount.
  useEffect(() => {
    aiChatState.open = openChat
    if (aiChatState.openRequested) {
      aiChatState.openRequested = false
      openChat()
    }
    return () => {
      if (aiChatState.open === openChat) aiChatState.open = null
    }
  }, [])

  // Escape closes the panel, matching the drawer behaviour it replaces.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeChat()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  // Follow the stream. Driving this from the message list (instead of the send
  // handler) also covers the case where the panel was closed and reopened.
  useEffect(() => {
    if (open) scrollToBottom()
  }, [messages, open, scrollToBottom])

  const starters = t('homescreen.starters', { returnObjects: true }) as string[]

  return (
    <>
      {!open && (
        <FloatButton
          className="ai-chat__launcher"
          type="primary"
          icon={<RobotOutlined />}
          aria-label={t('strings.launcher_isClosed')}
          onClick={openChat}
        />
      )}

      {open && (
        <section className="ai-chat" role="dialog" aria-label={t('assistantName')} aria-modal={false}>
          <header className="ai-chat__head">
            <span className="ai-chat__title">
              <Avatar size={24} icon={<RobotOutlined />} className="ai-chat__avatar ai-chat__avatar--ai" />
              {t('assistantName')}
              <Tag className="ai-chat__badge">{t('badge')}</Tag>
            </span>
            <div className="ai-chat__head-actions">
              <Tooltip title={t('newChat')}>
                <Button
                  type="text"
                  size="small"
                  icon={<PlusOutlined />}
                  aria-label={t('newChat')}
                  onClick={resetChat}
                  disabled={messages.length === 0 && !streaming}
                />
              </Tooltip>
              <Tooltip title={t('close')}>
                <Button
                  type="text"
                  size="small"
                  icon={<CloseOutlined />}
                  aria-label={t('close')}
                  onClick={closeChat}
                />
              </Tooltip>
            </div>
          </header>

          <div className="ai-chat__body">
            {messages.length === 0 ? (
              <div className="ai-chat__empty">
                <Welcome
                  icon={<RobotOutlined className="ai-chat__welcome-icon" />}
                  title={t('assistantName')}
                  description={t('homescreen.greeting')}
                />
                <Prompts
                  title={t('starterTitle')}
                  vertical
                  items={starters.map((label, i) => ({ key: String(i), label, description: undefined }))}
                  onItemClick={({ data }) => void sendChat(String(data.label), tokenRef.current)}
                />
              </div>
            ) : (
              <div className="ai-chat__list" ref={scrollRef}>
                {messages.map((m) =>
                  m.role === 'user' ? (
                    <Bubble
                      key={m.key}
                      placement="end"
                      variant="filled"
                      shape="corner"
                      className="ai-chat__bubble"
                      avatar={<Avatar size={26} icon={<UserOutlined />} className="ai-chat__avatar" />}
                      content={m.content}
                    />
                  ) : (
                    <Bubble
                      key={m.key}
                      placement="start"
                      variant="borderless"
                      className="ai-chat__bubble"
                      avatar={<Avatar size={26} icon={<RobotOutlined />} className="ai-chat__avatar ai-chat__avatar--ai" />}
                      loading={
                        m.status === 'streaming' &&
                        !m.content &&
                        !m.steps?.length &&
                        !m.proposal &&
                        !m.error
                      }
                      streaming={m.status === 'streaming' && Boolean(m.content)}
                      content={
                        <div className="ai-chat__answer">
                          <ThinkingChain
                            steps={m.steps}
                            thinkingMs={m.thinkingMs}
                            streaming={m.status === 'streaming'}
                          />
                          {m.content && (
                            <MessageMarkdown content={m.content} streaming={m.status === 'streaming'} />
                          )}
                          {m.proposal && <ProposalCard proposal={m.proposal} />}
                          {m.error && <Alert type="error" showIcon title={t('error.title')} description={m.error} />}
                          {m.status === 'aborted' && <p className="ai-chat__stopped">{t('stopped')}</p>}
                        </div>
                      }
                    />
                  ),
                )}
              </div>
            )}
          </div>

          <div className="ai-chat__composer">
            <Sender
              value={draft}
              onChange={setChatDraft}
              onSubmit={(message) => void sendChat(message, tokenRef.current)}
              loading={streaming}
              onCancel={abortChat}
              placeholder={t('strings.input_placeholder')}
              autoSize={{ minRows: 1, maxRows: 5 }}
              aria-label={t('strings.input_ariaLabel')}
            />
            <p className="ai-chat__disclaimer">{t('disclaimer')}</p>
          </div>
        </section>
      )}
    </>
  )
}
