import { useEffect, useState } from 'react'
import { Alert, Breadcrumb, Button, Input, Modal, Select, Table, type TableColumnsType } from 'antd'
import { QRCodeSVG } from 'qrcode.react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../auth/api'
import ExportButton from '../components/ExportButton'
import ListPagination from '../components/ListPagination'
import usePagedList from '../hooks/usePagedList'
import Field from '../ui/Field'
import type { Checkin, CheckinRecord } from '../types/api'
import { CheckinStatusTag, STATUS_KEYS, StatusTag, formatDateTime } from './attendanceUi'

export default function AttendanceDetailPage() {
  const { t } = useTranslation('attendance')
  const { id } = useParams()
  const navigate = useNavigate()
  const { token, can } = useAuth()
  const canManage = can('attendance:manage')

  const [checkin, setCheckin] = useState<Checkin | null>(null)
  const [detailError, setDetailError] = useState('')
  const [now, setNow] = useState(() => new Date())

  const [statusFilter, setStatusFilter] = useState('')
  const list = usePagedList<CheckinRecord>({ path: `/api/checkins/${id}/records`, token, extraParams: { status: statusFilter } })
  const { loading } = list

  const [editTarget, setEditTarget] = useState<CheckinRecord | null>(null)
  const [editStatus, setEditStatus] = useState('')
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)

  const [actionError, setActionError] = useState('')

  const load = async () => {
    try {
      const v = await apiFetch<Checkin>(`/api/checkins/${id}`, { token })
      setCheckin(v)
      setDetailError('')
      if (v.status === 'closed') list.reload()
    } catch (err) {
      setDetailError((err as Error).message)
    }
  }

  useEffect(() => {
    load()
    const poll = setInterval(load, 5000)
    return () => clearInterval(poll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token])

  // 1s ticker drives the countdown; cleared once the checkin closes or has no
  // expiry.
  useEffect(() => {
    if (!checkin || checkin.status !== 'active' || !checkin.expiresAt) return undefined
    const tick = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(tick)
  }, [checkin])

  const remainingSeconds = () => {
    if (!checkin || !checkin.expiresAt) return null
    const s = Math.floor((new Date(checkin.expiresAt).getTime() - now.getTime()) / 1000)
    return Math.max(0, s)
  }

  const openEdit = (r: CheckinRecord) => {
    setEditTarget(r)
    setEditStatus(r.status)
    setEditError('')
  }

  const handleSave = async () => {
    if (!editTarget) return
    try {
      setSaving(true)
      setEditError('')
      await apiFetch(`/api/checkins/${id}/records/${editTarget.userId}`, {
        method: 'PUT',
        token,
        body: { status: editStatus },
      })
      setEditTarget(null)
      list.reload()
      load()
    } catch (err) {
      setEditError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleClose = async () => {
    try {
      setActionError('')
      await apiFetch(`/api/checkins/${id}/close`, { method: 'POST', token })
      load()
    } catch (err) {
      setActionError((err as Error).message)
    }
  }

  const counts = checkin?.counts
  const statItems = [
    { label: t('stat.expected'), value: counts?.expected ?? '-' },
    { label: t('status.present', { ns: 'common' }), value: counts?.present ?? '-' },
    { label: t('status.late', { ns: 'common' }), value: counts?.late ?? '-' },
    { label: t('status.absent', { ns: 'common' }), value: counts?.absent ?? '-' },
    { label: t('status.leave', { ns: 'common' }), value: counts?.leave ?? '-' },
  ]
  const expired = checkin?.status === 'active' && remainingSeconds() === 0 && checkin.expiresAt

  const remainingText = () => {
    const s = remainingSeconds() ?? 0
    const mm = String(Math.floor(s / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }

  const columns: TableColumnsType<CheckinRecord> = [
    { title: t('detail.field.name'), dataIndex: 'displayName', width: 140 },
    {
      title: t('detail.field.studentNo'),
      dataIndex: 'studentNo',
      width: 130,
      render: (value: string) => value || '-',
    },
    {
      title: t('detail.field.adminClass'),
      dataIndex: 'adminClass',
      width: 160,
      render: (value: string) => value || '-',
    },
    {
      title: t('detail.field.status'),
      dataIndex: 'status',
      width: 110,
      render: (value: string) => <StatusTag status={value} />,
    },
    {
      title: t('detail.field.checkedAt'),
      dataIndex: 'checkedAt',
      width: 180,
      render: (value: string | undefined) => (value ? formatDateTime(value) : '-'),
    },
    {
      title: t('detail.field.inRoster'),
      dataIndex: 'inRoster',
      width: 110,
      render: (value: boolean) => (value ? t('detail.inRosterYes') : t('detail.inRosterNo')),
    },
  ]

  if (canManage) {
    columns.push({
      title: t('detail.field.actions'),
      key: 'actions',
      width: 100,
      fixed: 'right',
      render: (_, r) => (
        <Button type="text" size="small" onClick={() => openEdit(r)}>
          {t('detail.action.modify')}
        </Button>
      ),
    })
  }

  return (
    <div className="courses-page">
      <Breadcrumb
        aria-label={t('aria.breadcrumb', { ns: 'common' })}
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
                href="/attendance"
                onClick={(e) => {
                  e.preventDefault()
                  navigate('/attendance')
                }}
              >
                {t('breadcrumb.attendance')}
              </a>
            ),
          },
          { title: checkin?.title ?? t('detail.titleFallback') },
        ]}
      />
      <h1 className="courses-page__heading">{checkin?.title ?? t('detail.titleFallback')}</h1>
      <p className="courses-page__subtitle">
        {checkin && (
          <>
            {t('detail.codePrefix')} {checkin.code} ·{' '}
            {checkin.courseName
              ? t('detail.courseAndClass', { course: checkin.courseName, teachingClass: checkin.teachingClassName })
              : t('detail.standalone')}
            {checkin.sessionText ? ` · ${checkin.sessionText}` : ''} ·{' '}
            {t('detail.startedAt', { time: formatDateTime(checkin.startsAt) })}
          </>
        )}
      </p>

      {detailError && (
        <Alert type="error" showIcon title={t('detail.error.load')} description={detailError} className="courses-page__notice" />
      )}
      {actionError && (
        <Alert type="error" showIcon title={t('detail.error.action')} description={actionError} className="courses-page__notice" />
      )}

      {checkin && (
        <div className="attendance-detail">
          {/* QR + status panel */}
          <div className="attendance-detail__panel">
            <div className="attendance-detail__qr">
              <QRCodeSVG value={checkin.code} size={280} />
              <div className="attendance-detail__code">{checkin.code}</div>
            </div>
            <div className="attendance-detail__side">
              <CheckinStatusTag status={checkin.status} />
              {checkin.status === 'active' && (
                <p className="attendance-detail__countdown">
                  {expired
                    ? t('detail.elapsed')
                    : checkin.expiresAt
                      ? t('detail.remaining', { time: remainingText() })
                      : t('detail.manualMode')}
                </p>
              )}
              {checkin.lateMinutes > 0 && <p>{t('detail.lateThreshold', { minutes: checkin.lateMinutes })}</p>}
              {canManage && checkin.status === 'active' && (
                <Button type="text" size="small" danger onClick={handleClose}>
                  {t('detail.closeBtn')}
                </Button>
              )}
              <p className="attendance-detail__hint">{t('detail.hint')}</p>
            </div>
          </div>

          {/* Live counts */}
          <div className="attendance-detail__stats">
            {statItems.map((s) => (
              <div key={s.label} className="attendance-detail__stat">
                <div className="attendance-detail__stat-value">{s.value}</div>
                <div className="attendance-detail__stat-label">{s.label}</div>
              </div>
            ))}
          </div>
          {checkin.counts.expected === 0 && checkin.offeringId > 0 && (
            <Alert
              type="warning"
              showIcon
              title={t('detail.warning.zeroExpectedTitle')}
              description={t('detail.warning.noRosterSubtitle')}
              className="courses-page__notice"
            />
          )}
        </div>
      )}

      {list.error && (
        <Alert type="error" showIcon title={t('detail.error.recordLoad')} description={list.error} className="courses-page__notice" />
      )}

      <div className="ds-table-toolbar">
        <span className="ds-table-toolbar__title">{t('detail.table.title')}</span>
        <span className="ds-table-toolbar__hint">{t('detail.table.description', { count: list.total })}</span>
        <Input
          allowClear
          className="ds-table-toolbar__search"
          value={list.q}
          onChange={(e) => list.setQ(e.target.value)}
          placeholder={t('detail.searchPlaceholder')}
        />
        <Select
          aria-label={t('detail.field.status')}
          className="ds-table-toolbar__filter"
          value={statusFilter}
          onChange={(value: string) => setStatusFilter(value)}
          options={[
            { value: '', label: t('list.filter.allStatuses') },
            { value: 'present', label: t('status.present', { ns: 'common' }) },
            { value: 'late', label: t('status.late', { ns: 'common' }) },
            { value: 'absent', label: t('status.absent', { ns: 'common' }) },
            { value: 'leave', label: t('status.leave', { ns: 'common' }) },
          ]}
        />
        <ExportButton path={`/api/checkins/${id}/export`} fallbackName={`checkin-${id}.xlsx`} onError={setActionError} />
      </div>

      {/* Checkin records are keyed by userId (the API returns no `id`), so the
          table's row key is userId. */}
      <Table<CheckinRecord>
        rowKey="userId"
        size="middle"
        columns={columns}
        dataSource={list.items}
        loading={loading}
        pagination={false}
        scroll={{ x: 1000 }}
        locale={{
          emptyText: loading
            ? t('detail.empty.loading')
            : statusFilter
              ? t('detail.empty.filtered')
              : t('detail.empty.none'),
        }}
      />

      <ListPagination
        page={list.page}
        pageSize={list.pageSize}
        totalItems={list.total}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
      />

      {/* Modify record */}
      <Modal
        open={Boolean(editTarget)}
        title={t('detail.modal.edit', { name: editTarget?.displayName ?? '' })}
        okText={t('detail.modal.editSubmit')}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={() => setEditTarget(null)}
        onOk={handleSave}
        confirmLoading={saving}
        destroyOnHidden
      >
        <div className="courses-page__form">
          <Field label={t('detail.modal.statusLabel')} htmlFor="edit-status">
            <Select
              id="edit-status"
              value={editStatus}
              onChange={(value: string) => setEditStatus(value)}
              options={STATUS_KEYS.map((value) => ({
                value,
                label: t('status.' + value, { ns: 'common' }),
              }))}
            />
          </Field>
          <p className="courses-page__subtitle">{t('detail.modal.hint')}</p>
          {editError && <Alert type="error" showIcon title={t('detail.error.save')} description={editError} />}
        </div>
      </Modal>
    </div>
  )
}
