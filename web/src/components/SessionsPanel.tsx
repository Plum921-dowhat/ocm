import { useEffect, useState } from 'react'
import { Alert, Button, Input, Modal, Select, Table, type TableColumnsType, DatePicker } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../auth/api'
import ExportButton from './ExportButton'
import ListPagination from './ListPagination'
import SessionFormModal from './SessionFormModal'
import usePagedList from '../hooks/usePagedList'
import Field from '../ui/Field'
import type { Classroom, OfferingView, SessionView } from '../types/api'

export interface SessionsPanelProps {
  /** Whether the sessions tab is currently shown; drives lazy first render. */
  active: boolean
  /** Cross-tab prefill: offering id to filter by, consumed once written to state. */
  filterOfferingId?: string | null
  onFilterConsumed?: () => void
  /** Session mutations report the affected offering(s) so the owner refreshes its L2 caches. */
  onMutated?: (offeringId?: number, prevOfferingId?: number) => void
  offerings: OfferingView[]
  classrooms: Classroom[]
}

// SessionsPanel is the third tab of the course management page: a flat,
// full-featured view of all course sessions with combined filters (offering /
// classroom / date range), fuzzy search, pagination, xlsx export and CRUD via
// the shared SessionFormModal. Inactive tabs stay mounted but hidden, so the
// content is gated on first activation to avoid firing the sessions request on
// every page visit.
export default function SessionsPanel(props: SessionsPanelProps) {
  const { active } = props
  const [activated, setActivated] = useState(false)
  useEffect(() => {
    if (active) setActivated(true)
  }, [active])
  if (!activated) return null
  return <SessionsPanelContent {...props} />
}

function SessionsPanelContent({ filterOfferingId, onFilterConsumed, onMutated, offerings, classrooms }: SessionsPanelProps) {
  const { t, i18n } = useTranslation('courses')
  const { token, can } = useAuth()
  const canManage = can('course:manage')

  const [offeringId, setOfferingId] = useState(filterOfferingId ?? '')
  const [classroomId, setClassroomId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const list = usePagedList<SessionView>({
    path: '/api/sessions',
    token,
    extraParams: { offering_id: offeringId, classroom_id: classroomId, from, to },
  })
  // Action/delete errors are separate from the list fetch (the hook owns its error).
  const [actionError, setActionError] = useState('')
  const error = list.error || actionError

  // Cross-tab prefill: write the incoming offering filter once, then let the
  // owner clear the pending value so a later reload doesn't re-apply it.
  useEffect(() => {
    if (filterOfferingId) {
      setOfferingId(filterOfferingId)
      onFilterConsumed?.()
    }
  }, [filterOfferingId, onFilterConsumed])

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

  // The export endpoint honors the same filters as the list (but not q), so the
  // downloaded file covers the full filtered range - mirroring bookings export.
  const exportParams = new URLSearchParams()
  if (offeringId) exportParams.set('offering_id', offeringId)
  if (classroomId) exportParams.set('classroom_id', classroomId)
  if (from) exportParams.set('from', from)
  if (to) exportParams.set('to', to)

  const handleDelete = async () => {
    if (!delTarget) return
    const { id, offeringId: oid } = delTarget
    try {
      setDeleting(true)
      setDelError('')
      await apiFetch(`/api/sessions/${id}`, { method: 'DELETE', token })
      setDelTarget(null)
      list.reload()
      onMutated?.(oid)
    } catch (err) {
      setDelError((err as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  // classNames column joins admin-class names with a locale-appropriate
  // separator via Intl.ListFormat narrow style (same as the offerings table).
  const listFmt = new Intl.ListFormat(i18n.language, { style: 'narrow' })

  const columns: TableColumnsType<SessionView> = [
    { title: t('sessionField.id'), dataIndex: 'id', width: 72 },
    { title: t('sessionField.date'), dataIndex: 'date', width: 110 },
    {
      title: t('sessionField.period'),
      key: 'period',
      width: 110,
      render: (_, s) => periodLabel(s),
    },
    { title: t('sessionField.course'), dataIndex: 'courseName', width: 170, ellipsis: true },
    { title: t('sessionField.teachingClass'), dataIndex: 'teachingClassName', width: 160, ellipsis: true },
    {
      title: t('sessionField.classNames'),
      dataIndex: 'classNames',
      width: 180,
      render: (value: string[]) => (Array.isArray(value) && value.length ? listFmt.format(value) : '-'),
    },
    { title: t('sessionField.teacher'), dataIndex: 'teacher', width: 110 },
    { title: t('sessionField.semester'), dataIndex: 'semester', width: 130 },
    { title: t('sessionField.classroom'), dataIndex: 'classroomName', width: 150 },
    {
      title: t('sessionField.note'),
      dataIndex: 'note',
      width: 180,
      ellipsis: true,
      render: (value: string) => value || '-',
    },
  ]

  if (canManage) {
    columns.push({
      title: t('field.actions'),
      key: 'actions',
      width: 108,
      fixed: 'right',
      render: (_, s) => (
        <div className="courses-page__actions">
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
      ),
    })
  }

  return (
    <div className="sessions-panel">
      {error && (
        <Alert type="error" showIcon title={t('error.load')} description={error} className="courses-page__notice" />
      )}

      <div className="sessions-panel__filters">
        <Field label={t('sessionFilter.offering')} htmlFor="sessions-filter-offering" className="sessions-panel__filter">
          <Select
            id="sessions-filter-offering"
            value={offeringId}
            onChange={(value: string) => setOfferingId(value)}
            options={[
              { value: '', label: t('sessionFilter.allOfferings') },
              ...offerings.map((o) => ({
                value: String(o.id),
                label: [o.catalogName, o.teachingClassName, o.teacher].filter(Boolean).join(' / '),
              })),
            ]}
          />
        </Field>
        <Field label={t('sessionFilter.classroom')} htmlFor="sessions-filter-classroom" className="sessions-panel__filter">
          <Select
            id="sessions-filter-classroom"
            value={classroomId}
            onChange={(value: string) => setClassroomId(value)}
            options={[
              { value: '', label: t('sessionFilter.allClassrooms') },
              ...classrooms.map((c) => ({ value: String(c.id), label: c.name })),
            ]}
          />
        </Field>
        <Field label={t('sessionFilter.from')} htmlFor="sessions-filter-from" className="sessions-panel__filter">
          <DatePicker
            id="sessions-filter-from"
            allowClear={false}
            value={from ? dayjs(from) : null}
            onChange={(d) => setFrom(d ? d.format('YYYY-MM-DD') : '')}
          />
        </Field>
        <Field label={t('sessionFilter.to')} htmlFor="sessions-filter-to" className="sessions-panel__filter">
          <DatePicker
            id="sessions-filter-to"
            allowClear={false}
            value={to ? dayjs(to) : null}
            onChange={(d) => setTo(d ? d.format('YYYY-MM-DD') : '')}
          />
        </Field>
      </div>

      <div className="ds-table-toolbar">
        <span className="ds-table-toolbar__title">{t('table.sessions.title')}</span>
        <span className="ds-table-toolbar__hint">{t('table.sessions.description', { count: list.total })}</span>
        <Input
          allowClear
          className="ds-table-toolbar__search"
          placeholder={t('searchPlaceholder')}
          value={list.q}
          onChange={(e) => list.setQ(e.target.value)}
        />
        <ExportButton
          path={`/api/sessions/export?${exportParams.toString()}`}
          fallbackName="sessions.xlsx"
          onError={setActionError}
        />
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
            {t('sessionsExpanded.add')}
          </Button>
        )}
      </div>

      <Table<SessionView>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={list.items}
        loading={list.loading}
        pagination={false}
        scroll={{ x: 1440 }}
        locale={{ emptyText: list.q ? t('empty.noResults', { ns: 'common' }) : t('empty.noData', { ns: 'common' }) }}
      />

      <ListPagination
        page={list.page}
        pageSize={list.pageSize}
        totalItems={list.total}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
      />

      <SessionFormModal
        open={modalOpen}
        target={editTarget}
        offerings={offerings}
        classrooms={classrooms}
        onSuccess={(offeringId_, prevOfferingId_) => {
          list.reload()
          onMutated?.(offeringId_, prevOfferingId_)
        }}
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
