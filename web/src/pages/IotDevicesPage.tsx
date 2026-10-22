import { useEffect, useState } from 'react'
import { Alert, Breadcrumb, Button, Input, Modal, Select, Table, Tag, type TableColumnsType } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../auth/api'
import ListPagination from '../components/ListPagination'
import usePagedList from '../hooks/usePagedList'
import Field from '../ui/Field'
import { formatDateTime } from '../i18n/formatters'
import type { Classroom, IotDevice, Paged } from '../types/api'

const STATUS_COLOR: Record<string, string> = {
  pending: 'blue',
  online: 'green',
  offline: 'default',
}

export default function IotDevicesPage() {
  const { t } = useTranslation('iot')
  const { token, can } = useAuth()
  const navigate = useNavigate()
  const canManage = can('iot:manage')

  const [filterStatus, setFilterStatus] = useState('')
  const list = usePagedList<IotDevice>({
    path: '/api/iot/devices',
    token,
    extraParams: { status: filterStatus },
  })
  const { loading } = list
  // Action errors are separate from the list fetch (the hook owns its error).
  const [actionError, setActionError] = useState('')
  const error = list.error || actionError

  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  useEffect(() => {
    if (!canManage) return
    apiFetch<Paged<Classroom>>('/api/classrooms?page_size=500', { token })
      .then((data) => setClassrooms(Array.isArray(data?.items) ? data.items : []))
      .catch(() => setClassrooms([]))
  }, [token, canManage])

  // Approve (claim) dialog for a pending device.
  const [approveTarget, setApproveTarget] = useState<IotDevice | null>(null)
  const [approveForm, setApproveForm] = useState({ name: '', classroomId: '', category: '' })
  const [approveError, setApproveError] = useState('')
  const [approving, setApproving] = useState(false)

  // Delete dialog.
  const [deleteTarget, setDeleteTarget] = useState<IotDevice | null>(null)
  const [deleting, setDeleting] = useState(false)

  const classroomLabel = (id: number | null | undefined) => {
    if (!id) return '—'
    const c = classrooms.find((x) => x.id === id)
    return c ? (c.building ? `${c.building} ${c.name}` : c.name) : `#${id}`
  }

  const openApprove = (d: IotDevice) => {
    setApproveTarget(d)
    setApproveForm({ name: d.name || d.externalId, classroomId: '', category: d.category === 'generic' ? '' : d.category })
    setApproveError('')
  }

  const handleApprove = async () => {
    if (!approveTarget) return
    if (!approveForm.name.trim()) return setApproveError(t('validation.nameRequired'))
    if (!approveForm.classroomId) return setApproveError(t('validation.classroomRequired'))
    try {
      setApproving(true)
      setApproveError('')
      const body: { name: string; classroomId: number; category?: string } = {
        name: approveForm.name.trim(),
        classroomId: Number(approveForm.classroomId),
      }
      if (approveForm.category.trim()) body.category = approveForm.category.trim()
      await apiFetch(`/api/iot/devices/${approveTarget.id}/approve`, { method: 'POST', token, body })
      setApproveTarget(null)
      list.reload()
    } catch (err) {
      setApproveError((err as Error).message)
    } finally {
      setApproving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      setDeleting(true)
      setActionError('')
      await apiFetch(`/api/iot/devices/${deleteTarget.id}`, { method: 'DELETE', token })
      setDeleteTarget(null)
      list.reload()
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  const columns: TableColumnsType<IotDevice> = [
    {
      title: t('field.name'),
      dataIndex: 'name',
      width: 150,
      render: (value: string) => value || '—',
    },
    { title: t('field.externalId'), dataIndex: 'externalId', width: 150 },
    { title: t('field.category'), dataIndex: 'category', width: 110 },
    { title: t('field.sourceId'), dataIndex: 'sourceId', width: 110 },
    {
      title: t('field.classroom'),
      key: 'classroom',
      width: 170,
      render: (_, d) => classroomLabel(d.classroomId),
    },
    {
      title: t('field.status'),
      dataIndex: 'status',
      width: 100,
      render: (value: string) => (
        <Tag color={STATUS_COLOR[value] ?? 'default'}>{t('status.' + value, { defaultValue: value })}</Tag>
      ),
    },
    {
      title: t('field.lastSeenAt'),
      dataIndex: 'lastSeenAt',
      width: 150,
      render: (value: string | undefined) => (value ? formatDateTime(value) : '—'),
    },
    {
      title: t('field.actions'),
      key: 'actions',
      width: 170,
      fixed: 'right',
      render: (_, d) => (
        <div className="classrooms-page__actions">
          <Button type="text" size="small" onClick={() => navigate(`/iot/${d.id}`)}>
            {t('action.detail')}
          </Button>
          {d.status === 'pending' && canManage && (
            <Button type="text" size="small" onClick={() => openApprove(d)}>
              {t('action.approve')}
            </Button>
          )}
          {canManage && (
            <Button type="text" size="small" danger onClick={() => setDeleteTarget(d)}>
              {t('action.delete', { ns: 'common' })}
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="classrooms-page">
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
          { title: t('breadcrumb.current') },
        ]}
      />
      <h1 className="classrooms-page__heading">{t('title')}</h1>
      <p className="classrooms-page__subtitle">{t('subtitle')}</p>

      {error && (
        <Alert type="error" showIcon title={t('error.action')} description={error} className="classrooms-page__notice" />
      )}

      <div className="bookings-page__filters">
        <Field label={t('filter.status')} htmlFor="iot-status" className="bookings-page__filter">
          <Select
            id="iot-status"
            value={filterStatus}
            onChange={(value: string) => setFilterStatus(value)}
            options={[
              { value: '', label: t('filter.allStatuses') },
              { value: 'pending', label: t('status.pending') },
              { value: 'online', label: t('status.online') },
              { value: 'offline', label: t('status.offline') },
            ]}
          />
        </Field>
      </div>

      <div className="ds-table-toolbar">
        <span className="ds-table-toolbar__title">{t('table.title')}</span>
        <span className="ds-table-toolbar__hint">{t('table.description', { count: list.total })}</span>
        <Input
          allowClear
          className="ds-table-toolbar__search"
          value={list.q}
          onChange={(e) => list.setQ(e.target.value)}
          placeholder={t('table.searchPlaceholder')}
        />
      </div>

      <Table<IotDevice>
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={list.items}
        loading={loading}
        pagination={false}
        scroll={{ x: 1115 }}
        locale={{ emptyText: list.q ? t('empty.search') : t('empty.none') }}
      />

      <ListPagination
        page={list.page}
        pageSize={list.pageSize}
        totalItems={list.total}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
      />

      {/* Approve dialog */}
      <Modal
        open={Boolean(approveTarget)}
        title={t('modal.approve')}
        okText={t('modal.approveSubmit')}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={() => setApproveTarget(null)}
        onOk={handleApprove}
        confirmLoading={approving}
        destroyOnHidden
      >
        <div className="classrooms-page__form">
          <p className="classrooms-page__confirm-text">{t('modal.approveHint')}</p>
          <Field label={t('modal.name')} htmlFor="iot-approve-name">
            <Input
              id="iot-approve-name"
              value={approveForm.name}
              onChange={(e) => setApproveForm({ ...approveForm, name: e.target.value })}
            />
          </Field>
          <Field label={t('modal.classroom')} htmlFor="iot-approve-classroom">
            <Select
              id="iot-approve-classroom"
              value={approveForm.classroomId}
              onChange={(value: string) => setApproveForm({ ...approveForm, classroomId: value })}
              options={[
                { value: '', label: t('validation.classroomRequired') },
                ...classrooms.map((c) => ({
                  value: String(c.id),
                  label: c.building ? `${c.building} ${c.name}` : c.name,
                })),
              ]}
            />
          </Field>
          <Field label={t('modal.category')} htmlFor="iot-approve-category">
            <Input
              id="iot-approve-category"
              value={approveForm.category}
              onChange={(e) => setApproveForm({ ...approveForm, category: e.target.value })}
            />
          </Field>
          {approveError && <Alert type="error" showIcon title={t('error.action')} description={approveError} />}
        </div>
      </Modal>

      {/* Delete dialog */}
      <Modal
        open={Boolean(deleteTarget)}
        title={t('modal.delete')}
        okText={t('modal.deleteSubmit')}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={() => setDeleteTarget(null)}
        onOk={handleDelete}
        confirmLoading={deleting}
        okButtonProps={{ danger: true }}
        destroyOnHidden
      >
        <p className="classrooms-page__confirm-text">
          {t('modal.deleteLine', { name: deleteTarget?.name || deleteTarget?.externalId })}
        </p>
      </Modal>
    </div>
  )
}
