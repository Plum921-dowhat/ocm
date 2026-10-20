import { useState } from 'react'
import { Alert, Button, Modal } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../auth/api'
import SessionFormModal from './SessionFormModal'
import type { Classroom, OfferingView, SessionView } from '../types/api'

// One cached page of sessions for an offering, owned by CourseManagementPage.
export interface SessionsCacheEntry {
  data: SessionView[]
  loading: boolean
  error: string
}

export interface SessionsMiniTableProps {
  offering: OfferingView
  entry: SessionsCacheEntry
  canManage: boolean
  offerings: OfferingView[]
  classrooms: Classroom[]
  /** Session mutations report the affected offering(s) so the owner refreshes its caches. */
  onMutated: (offeringId?: number, prevOfferingId?: number) => void
  /** Re-fetch the cached list for an offering (retry after a load error). */
  onReload: (offeringId: number) => void
  /** Cross-tab jump: open the sessions tab pre-filtered to this offering. */
  onViewAll: (offeringId: number) => void
}

// SessionsMiniTable renders inside an offerings-table expanded row: a compact
// read-mostly session list with light actions (add/edit/delete via the shared
// SessionFormModal). No filters - the full-filtered view lives in the sessions
// tab ("view all" jumps there).
export default function SessionsMiniTable({
  offering,
  entry,
  canManage,
  offerings,
  classrooms,
  onMutated,
  onReload,
  onViewAll,
}: SessionsMiniTableProps) {
  const { t } = useTranslation('courses')
  const { token } = useAuth()
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<SessionView | null>(null)
  const [delTarget, setDelTarget] = useState<SessionView | null>(null)
  const [delError, setDelError] = useState('')
  const [deleting, setDeleting] = useState(false)

  const periodLabel = (s: Pick<SessionView, 'periodStart' | 'periodEnd'>) =>
    s.periodStart === s.periodEnd
      ? t('sessionPeriod.single', { period: s.periodStart })
      : t('sessionPeriod.range', { start: s.periodStart, end: s.periodEnd })

  const openAdd = () => {
    setEditTarget(null)
    setModalOpen(true)
  }

  const openEdit = (s: SessionView) => {
    setEditTarget(s)
    setModalOpen(true)
  }

  const handleDelete = async () => {
    if (!delTarget) return
    const { id, offeringId } = delTarget
    try {
      setDeleting(true)
      setDelError('')
      await apiFetch(`/api/sessions/${id}`, { method: 'DELETE', token })
      setDelTarget(null)
      onMutated(offeringId)
    } catch (err) {
      setDelError((err as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="sessions-mini">
      <div className="sessions-mini__bar">
        <span className="sessions-mini__title">{t('sessionsExpanded.title', { count: entry.data.length })}</span>
        {canManage && (
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openAdd}>
            {t('sessionsExpanded.add')}
          </Button>
        )}
        <Button type="text" size="small" onClick={() => onViewAll(offering.id)}>
          {t('sessionsExpanded.viewAll')}
        </Button>
      </div>

      {/* The cache keeps the previous data while reloading, so the table stays
          mounted (no unmount/remount flicker); the loading/empty lines only
          show when there is nothing to display yet. */}
      {entry.error && (
        <div className="sessions-mini__hint">
          <span>
            {t('sessionsExpanded.loadError')}: {entry.error}
          </span>
          <Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => onReload(offering.id)}>
            {t('sessionsExpanded.retry')}
          </Button>
        </div>
      )}
      {entry.data.length > 0 ? (
        <table className="sessions-mini__table">
          <thead>
            <tr>
              <th>{t('sessionField.date')}</th>
              <th>{t('sessionField.period')}</th>
              <th>{t('sessionField.classroom')}</th>
              <th>{t('sessionField.note')}</th>
              {canManage && <th aria-label={t('field.actions')} />}
            </tr>
          </thead>
          <tbody>
            {entry.data.map((s) => (
              <tr key={s.id}>
                <td>{s.date}</td>
                <td>{periodLabel(s)}</td>
                <td>{s.classroomName}</td>
                <td>{s.note || '-'}</td>
                {canManage && (
                  <td>
                    <div className="sessions-mini__actions">
                      <Button
                        type="text"
                        size="small"
                        aria-label={t('action.edit', { ns: 'common' })}
                        icon={<EditOutlined />}
                        onClick={() => openEdit(s)}
                      />
                      <Button
                        type="text"
                        size="small"
                        danger
                        aria-label={t('action.delete', { ns: 'common' })}
                        icon={<DeleteOutlined />}
                        onClick={() => {
                          setDelError('')
                          setDelTarget(s)
                        }}
                      />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      ) : entry.loading ? (
        <p className="sessions-mini__hint">{t('empty.loading')}</p>
      ) : !entry.error ? (
        <p className="sessions-mini__hint">
          {t('sessionsExpanded.empty')}
          {canManage && (
            <Button type="text" size="small" icon={<PlusOutlined />} onClick={openAdd}>
              {t('sessionsExpanded.add')}
            </Button>
          )}
        </p>
      ) : null}

      <SessionFormModal
        open={modalOpen}
        target={editTarget}
        defaultOfferingId={String(offering.id)}
        offerings={offerings}
        classrooms={classrooms}
        onSuccess={onMutated}
        onClose={() => setModalOpen(false)}
      />

      <Modal
        open={Boolean(delTarget)}
        title={t('modal.delete')}
        okText={t('modal.deleteSubmit')}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={() => setDelTarget(null)}
        onOk={handleDelete}
        confirmLoading={deleting}
        okButtonProps={{ danger: true }}
        destroyOnHidden
      >
        <p className="courses-page__confirm-text">
          {t('sessionModal.deleteConfirm', {
            date: delTarget?.date ?? '',
            period: delTarget ? periodLabel(delTarget) : '',
            classroom: delTarget?.classroomName ?? '',
          })}
        </p>
        {delError && <Alert type="error" showIcon title={t('error.delete')} description={delError} />}
      </Modal>
    </div>
  )
}
