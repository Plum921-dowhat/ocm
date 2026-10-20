import { useEffect, useState } from 'react'
import { Alert, Breadcrumb, Button, Tag } from 'antd'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../auth/api'
import ImportPreviewTable from '../components/ImportPreviewTable'
import type { ImportJob } from '../types/api'

const STATUS_COLOR: Record<string, string> = {
  pending: 'blue',
  processing: 'blue',
  preview: 'purple',
  succeeded: 'green',
  failed: 'red',
  cancelled: 'default',
}

// 扁平化导入（教学班/作息制度）的后端计数单位是组而非文件行，汇总行按类型带单位。
function summaryUnit(type: string): string {
  if (type === 'teaching_classes') return 'modal.unitTeachingClasses'
  if (type === 'regimes') return 'modal.unitRegimes'
  return 'modal.unitRows'
}

// ImportDetailPage (/imports/:id) is the full-page preview for one import job,
// replacing the old detail modal so the (potentially very large) preview table
// gets the full content width. Loads job metadata, polls while pending/
// processing, and offers commit/cancel inline. A failed commit can be retried
// here too (the backend accepts failed→commit).
export default function ImportDetailPage() {
  const { t } = useTranslation('imports')
  const { id } = useParams()
  const navigate = useNavigate()
  const { token } = useAuth()

  const [job, setJob] = useState<ImportJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionPending, setActionPending] = useState(false)
  const [actionError, setActionError] = useState('')

  const load = async () => {
    try {
      const v = await apiFetch<ImportJob>(`/api/imports/${id}`, { token })
      setJob(v)
      setLoadError('')
      setLoading(false)
    } catch (e) {
      setLoadError((e as Error).message)
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Poll while the job is still pending or processing (initial preview, or a
  // commit/reanalyze in flight). Stops once it reaches a terminal state.
  useEffect(() => {
    if (!job || (job.status !== 'pending' && job.status !== 'processing')) return undefined
    const timer = setInterval(async () => {
      try {
        const v = await apiFetch<ImportJob>(`/api/imports/${id}`, { token })
        setJob(v)
      } catch {
        // keep the last known job on a transient poll failure
      }
    }, 1500)
    return () => clearInterval(timer)
  }, [job?.status, id, token])

  const typeLabel = (type?: string) => (type ? t('types.' + type + '.label', { defaultValue: type }) : '-')

  const handleCommit = async () => {
    setActionPending(true)
    setActionError('')
    try {
      await apiFetch(`/api/imports/${id}/commit`, { method: 'POST', token })
      await load() // flip to processing; the poll effect takes over
    } catch (e) {
      setActionError((e as Error).message)
    } finally {
      setActionPending(false)
    }
  }

  const handleCancel = async () => {
    setActionPending(true)
    setActionError('')
    try {
      await apiFetch(`/api/imports/${id}/cancel`, { method: 'POST', token })
      navigate('/imports')
    } catch (e) {
      setActionError((e as Error).message)
    } finally {
      setActionPending(false)
    }
  }

  const canCommit = job && (job.status === 'preview' || job.status === 'failed')
  const commitDisabled = actionPending || (job?.status === 'preview' && (job?.succeededRows ?? 0) === 0)

  return (
    <div className="imports-page">
      <Breadcrumb
        items={[
          {
            title: (
              <a
                href="/"
                onClick={(e) => {
                  e.preventDefault()
                  navigate('/')
                }}
              >
                {t('breadcrumb.home')}
              </a>
            ),
          },
          {
            title: (
              <a
                href="/imports"
                onClick={(e) => {
                  e.preventDefault()
                  navigate('/imports')
                }}
              >
                {t('breadcrumb.current')}
              </a>
            ),
          },
          { title: t('detail.heading', { label: typeLabel(job?.type) }) },
        ]}
      />
      <h1 className="courses-page__heading">
        {job ? t('detail.heading', { label: typeLabel(job.type) }) : t('modal.loading')}
      </h1>
      {loadError && (
        <Alert type="error" showIcon title={t('error.load')} description={loadError} className="courses-page__notice" />
      )}

      {loading ? (
        <p className="imports-page__summary">{t('modal.loading')}</p>
      ) : job ? (
        <>
          <div
            className="imports-page__detail-head"
            style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.5rem' }}
          >
            <Tag color={STATUS_COLOR[job.status] ?? 'default'}>
              {t('status.' + job.status, { defaultValue: job.status })}
            </Tag>
            <span className="imports-page__muted">{job.filename || t('unnamed')}</span>
          </div>

          <p className="imports-page__summary">
            {/* 扁平化导入（教学班/作息制度）的后端计数单位是组而非文件行，汇总行按类型带单位。 */}
            {(job.status === 'preview'
              ? t('modal.previewSummary', { succeeded: job.succeededRows, failed: job.failedRows, total: job.totalRows, unit: t(summaryUnit(job.type)) })
              : t('modal.detailSummary', { succeeded: job.succeededRows, failed: job.failedRows, total: job.totalRows, unit: t(summaryUnit(job.type)) }))}
          </p>

          {canCommit && (
            <div className="imports-page__actions" style={{ display: 'flex', gap: '.5rem', margin: '.5rem 0' }}>
              <Button type="primary" size="small" onClick={handleCommit} disabled={commitDisabled}>
                {job.status === 'failed' ? t('wizard.retry') : t('modal.commit')}
              </Button>
              {job.status === 'preview' && (
                <Button type="text" size="small" onClick={handleCancel} disabled={actionPending}>
                  {t('modal.cancel')}
                </Button>
              )}
            </div>
          )}

          {actionError && (
            <Alert
              type="error"
              showIcon
              title={t('error.action')}
              description={actionError}
              className="imports-page__upload-err"
            />
          )}

          <ImportPreviewTable job={job} token={token} t={t} />
        </>
      ) : null}
    </div>
  )
}
