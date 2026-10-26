import { useState } from 'react'
import { Alert, Button, theme } from 'antd'
import { CaretRightOutlined, CheckCircleFilled, CloseCircleFilled, LoadingOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../auth/api'

// One entry of the assistant turn, in arrival order: a chunk of the model's
// reasoning trace or a tool it called. The backend streams both as they happen,
// so keeping them in a single list preserves the real sequence
// (think -> call -> think -> call -> answer) instead of regrouping by type.
export type AiStep =
  | { kind: 'thinking'; text: string }
  | {
      kind: 'tool'
      id?: string
      name: string
      status: 'running' | 'ok' | 'error'
      args?: Record<string, unknown>
      total?: number
      shown?: number
    }

type ToolStep = Extract<AiStep, { kind: 'tool' }>

// One booking/session clash attached to a proposal (ProposalPayload.conflicts).
export interface AiConflict {
  kind: 'session' | 'booking'
  courseName?: string
  displayName?: string
  periodStart: number
  periodEnd: number
}

// ProposalPayload as emitted by the backend's propose_booking tool and
// forwarded verbatim in SSE 'proposal' events.
export interface AiProposal {
  payload: {
    classroomId: number
    classroomName: string
    date: string
    periodStart: number
    periodEnd: number
    periodLabel: string
    purpose: string
    conflicts: AiConflict[]
  }
  state: 'proposed' | 'submitting' | 'confirmed' | 'failed' | 'dismissed'
  error: string
}

const STEP_ICON = {
  running: <LoadingOutlined spin />,
  ok: <CheckCircleFilled />,
  error: <CloseCircleFilled />,
}

// ThinkingChain renders the turn's real sequence: reasoning text and tool calls
// interleaved in arrival order. It stays expanded while the turn is working (so
// the wait has visible progress) and folds into one line with the elapsed time
// once the answer starts; clicking the header re-opens it.
//
// Only real data is rendered. Models that return no reasoning trace and call no
// tools get no block at all — no invented "thinking" steps.
export function ThinkingChain({
  steps,
  thinkingMs,
  streaming,
}: {
  steps?: AiStep[]
  thinkingMs?: number
  streaming?: boolean
}) {
  const { t } = useTranslation('aiChat')
  const [manual, setManual] = useState<boolean | null>(null)
  // Ant Design tokens follow the light/dark scheme; the app's CSS bridge only
  // exposes text colours, so semantic status colours come from the theme.
  const { token } = theme.useToken()
  const list = steps ?? []
  if (list.length === 0) return null

  const running = Boolean(streaming) && thinkingMs === undefined
  const expanded = manual ?? running
  const seconds = Math.max(1, Math.round((thinkingMs ?? 0) / 1000))
  const toolCount = list.filter((step) => step.kind === 'tool').length
  const statusColor = (status: 'running' | 'ok' | 'error') =>
    status === 'error' ? token.colorError : status === 'running' ? token.colorTextTertiary : token.colorSuccess

  // Only the arguments and row counts: the tool name is already the label.
  const describe = (step: ToolStep): string => {
    const args = step.args ?? {}
    const parts: string[] = []
    if (typeof args.date === 'string' && args.date) parts.push(args.date)
    if (typeof args.periodStart === 'number' && typeof args.periodEnd === 'number') {
      parts.push(t('thinking.periods', { start: args.periodStart, end: args.periodEnd }))
    }
    for (const value of [args.building, args.q]) {
      if (typeof value === 'string' && value) parts.push(value)
    }
    if (typeof step.total === 'number') {
      parts.push(
        typeof step.shown === 'number' && step.shown < step.total
          ? t('thinking.foundPartial', { total: step.total, shown: step.shown })
          : t('thinking.found', { total: step.total }),
      )
    }
    return parts.join(' · ')
  }

  return (
    <div className="ai-chat__think">
      <button
        type="button"
        className="ai-chat__think-head"
        aria-expanded={expanded}
        aria-label={expanded ? t('thinking.collapse') : t('thinking.expand')}
        onClick={() => setManual(!expanded)}
      >
        <CaretRightOutlined className="ai-chat__think-caret" rotate={expanded ? 90 : 0} />
        <span className={running ? 'ai-chat__think-label ai-chat__think-label--running' : 'ai-chat__think-label'}>
          {running ? t('thinking.running') : t('thinking.done', { seconds })}
        </span>
        {!running && toolCount > 0 && (
          <span className="ai-chat__think-count">{t('thinking.stepCount', { count: toolCount })}</span>
        )}
      </button>

      {expanded && (
        <div className="ai-chat__think-body">
          {list.map((step, i) => {
            if (step.kind === 'thinking') {
              return (
                <p key={`think-${i}`} className="ai-chat__think-text">
                  {step.text}
                </p>
              )
            }
            const detail = describe(step)
            return (
              <div key={step.id || `tool-${i}`} className="ai-chat__step">
                <span className="ai-chat__step-icon" style={{ color: statusColor(step.status) }}>
                  {STEP_ICON[step.status]}
                </span>
                <span className="ai-chat__step-label">{t('tools.' + step.name, { defaultValue: step.name })}</span>
                {detail && <span className="ai-chat__step-desc">· {detail}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ConflictNote({ conflicts }: { conflicts?: AiConflict[] }) {
  const { t } = useTranslation('aiChat')
  if (!conflicts || conflicts.length === 0) return null
  const items = conflicts.slice(0, 5).map((c) => {
    const kind = c.kind === 'session' ? t('conflict.sessionKind') : t('conflict.bookingKind')
    const course = c.courseName ? ' ' + c.courseName : ''
    const name = c.displayName ? t('conflict.nameWrap', { name: c.displayName }) : ''
    return t('conflict.item', { kind, start: c.periodStart, end: c.periodEnd, course, name })
  })
  return (
    <Alert
      className="ai-chat__conflict"
      type="warning"
      showIcon
      title={t('conflict.title', { count: conflicts.length })}
      description={items.join(t('conflict.join'))}
    />
  )
}

// ProposalCard renders one AI-generated booking preview with its own
// confirmation state machine: proposed -> submitting -> confirmed / failed, or
// dismissed. The confirm button submits through the existing booking API,
// which re-validates permissions and conflicts server-side.
export function ProposalCard({ proposal }: { proposal: AiProposal }) {
  const { t } = useTranslation('aiChat')
  const { token } = useAuth()
  const [state, setState] = useState<'proposed' | 'submitting' | 'confirmed' | 'failed' | 'dismissed'>(
    proposal.state === 'dismissed' ? 'dismissed' : 'proposed',
  )
  const [error, setError] = useState('')

  if (state === 'dismissed') {
    return <p className="ai-chat__proposal-dismissed">{t('proposal.dismissed')}</p>
  }

  const confirm = async () => {
    setState('submitting')
    try {
      await apiFetch('/api/bookings', {
        method: 'POST',
        token,
        body: {
          classroomId: proposal.payload.classroomId,
          date: proposal.payload.date,
          periodStart: proposal.payload.periodStart,
          periodEnd: proposal.payload.periodEnd,
          purpose: proposal.payload.purpose,
        },
      })
      setState('confirmed')
    } catch (err) {
      setError((err as Error & { status?: number }).status === 409 ? t('error.bookingConflict') : (err as Error).message)
      setState('failed')
    }
  }

  return (
    <div className="ai-chat__proposal">
      <h3 className="ai-chat__proposal-title">{t('proposal.title')}</h3>
      <dl className="ai-chat__proposal-fields">
        <div>
          <dt>{t('proposal.fieldLabel.classroom')}</dt>
          <dd>{proposal.payload.classroomName}</dd>
        </div>
        <div>
          <dt>{t('proposal.fieldLabel.date')}</dt>
          <dd>{proposal.payload.date}</dd>
        </div>
        <div>
          <dt>{t('proposal.fieldLabel.period')}</dt>
          <dd>{proposal.payload.periodLabel}</dd>
        </div>
        <div className="ai-chat__proposal-purpose">
          <dt>{t('proposal.fieldLabel.purpose')}</dt>
          <dd>{proposal.payload.purpose}</dd>
        </div>
      </dl>
      {state === 'proposed' && <ConflictNote conflicts={proposal.payload.conflicts} />}
      {state === 'confirmed' && (
        <Alert
          type="success"
          showIcon
          title={t('proposal.successTitle')}
          action={
            <Link to="/bookings" className="ai-chat__proposal-link">
              {t('proposal.successLink')}
            </Link>
          }
        />
      )}
      {state === 'failed' && <Alert type="error" showIcon title={t('proposal.failedTitle')} description={error} />}
      {(state === 'proposed' || state === 'submitting') && (
        <div className="ai-chat__proposal-actions">
          <Button type="primary" size="small" loading={state === 'submitting'} onClick={confirm}>
            {state === 'submitting' ? t('proposal.confirming') : t('proposal.confirm')}
          </Button>
          <Button size="small" disabled={state === 'submitting'} onClick={() => setState('dismissed')}>
            {t('action.cancel', { ns: 'common' })}
          </Button>
        </div>
      )}
    </div>
  )
}
