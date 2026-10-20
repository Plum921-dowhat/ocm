import { useState } from 'react'
import { Alert, Button, Spin, Tag } from 'antd'
import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../auth/api'

// The backend's SSE 'tool' events (internal/ai agent.go).
export interface AiTool {
  name: string
  status: 'running' | 'ok' | 'error'
}

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

// ToolIndicator renders the tools the assistant called while answering. It is
// an inline strip above the answer text, so it stays compact: one tag per tool,
// with a spinner only while that tool is running.
export function ToolIndicator({ tools }: { tools?: AiTool[] }) {
  const { t } = useTranslation('aiChat')
  if (!tools || tools.length === 0) return null
  return (
    <div className="ai-chat__tools">
      {tools.map((tool, i) => {
        const label = t('tools.' + tool.name, { defaultValue: tool.name })
        if (tool.status === 'running') {
          return (
            <Tag key={`${tool.name}-${i}`} color="processing" icon={<Spin size="small" />}>
              {t('tool.running', { label })}
            </Tag>
          )
        }
        if (tool.status === 'error') {
          return (
            <Tag key={`${tool.name}-${i}`} color="error" icon={<CloseCircleFilled />}>
              {t('tool.error', { label })}
            </Tag>
          )
        }
        return (
          <Tag key={`${tool.name}-${i}`} color="success" icon={<CheckCircleFilled />}>
            {t('tool.ok', { label })}
          </Tag>
        )
      })}
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
