import { useEffect, useState } from 'react'
import {
  Alert,
  Breadcrumb,
  Button,
  Input,
  Modal,
  Select,
  Table,
  Tag,
  type TableColumnsType,
} from 'antd'
import { CheckOutlined, PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../auth/api'
import ListPagination from '../components/ListPagination'
import usePagedList from '../hooks/usePagedList'
import Field from '../ui/Field'
import { formatDate } from '../i18n/formatters'
import type { Classroom, Paged, RepairInput, RepairUpdateInput, RepairView } from '../types/api'

const STATUS_COLOR: Record<string, string> = {
  open: 'red',
  processing: 'blue',
  completed: 'purple',
  confirmed: 'green',
}

function classroomLabel(r: Pick<RepairView, 'building' | 'classroomName'>) {
  return r.building ? `${r.building} ${r.classroomName}` : r.classroomName
}

// The create body intentionally omits `images`: the original JS version did
// too, and the backend stores an absent json.RawMessage as NULL (vs '[]'), so
// keeping the key absent preserves the wire behavior.
type RepairCreateInput = Omit<RepairInput, 'images'>

// Process dialog state: the ticket under transition and its next status.
interface ProcessTarget extends RepairView {
  nextStatus: 'processing' | 'completed'
}

export default function RepairsPage() {
  const { t } = useTranslation('repairs')
  const { token, user: currentUser, can } = useAuth()
  const navigate = useNavigate()
  const canSubmit = can('repair:create')
  const canAssign = can('repair:assign')

  const [filterStatus, setFilterStatus] = useState('')
  const list = usePagedList<RepairView>({
    path: '/api/repairs',
    token,
    extraParams: { status: filterStatus },
  })
  const { loading } = list
  // Action errors are separate from the list fetch (the hook owns its error).
  const [actionError, setActionError] = useState('')
  const error = list.error || actionError

  const [classrooms, setClassrooms] = useState<Classroom[]>([])

  // Submit form.
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ classroomId: '', description: '' })
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  // Process (start / complete) dialog.
  const [processTarget, setProcessTarget] = useState<ProcessTarget | null>(null)
  const [processRemark, setProcessRemark] = useState('')
  const [processError, setProcessError] = useState('')
  const [processing, setProcessing] = useState(false)

  const [actingId, setActingId] = useState<number | null>(null)

  useEffect(() => {
    if (!canSubmit) return
    apiFetch<Paged<Classroom>>('/api/classrooms?page_size=500', { token })
      .then((data) => setClassrooms(Array.isArray(data?.items) ? data.items : []))
      .catch(() => setClassrooms([]))
  }, [token, canSubmit])

  const openCreate = () => {
    setForm({ classroomId: '', description: '' })
    setFormError('')
    setFormOpen(true)
  }

  const handleCreate = async () => {
    if (!form.classroomId) return setFormError(t('validation.classroomRequired'))
    if (!form.description.trim()) return setFormError(t('validation.descriptionRequired'))
    try {
      setSaving(true)
      setFormError('')
      const body: RepairCreateInput = {
        classroomId: Number(form.classroomId),
        description: form.description.trim(),
      }
      await apiFetch('/api/repairs', { method: 'POST', token, body })
      setFormOpen(false)
      list.reload()
    } catch (err) {
      setFormError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const openProcess = (row: RepairView, nextStatus: ProcessTarget['nextStatus']) => {
    setProcessTarget({ ...row, nextStatus })
    setProcessRemark('')
    setProcessError('')
  }

  const handleProcess = async () => {
    if (!processTarget) return
    try {
      setProcessing(true)
      setProcessError('')
      const body: RepairUpdateInput = { status: processTarget.nextStatus, remark: processRemark.trim() }
      await apiFetch(`/api/repairs/${processTarget.id}`, { method: 'PUT', token, body })
      setProcessTarget(null)
      list.reload()
    } catch (err) {
      setProcessError((err as Error).message)
    } finally {
      setProcessing(false)
    }
  }

  const handleConfirm = async (row: RepairView) => {
    try {
      setActingId(row.id)
      setActionError('')
      await apiFetch(`/api/repairs/${row.id}/confirm`, { method: 'POST', token })
      list.reload()
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setActingId(null)
    }
  }

  const columns: TableColumnsType<RepairView> = [
    {
      title: t('field.classroom'),
      key: 'classroom',
      width: 200,
      render: (_, r) => classroomLabel(r),
    },
    { title: t('field.description'), dataIndex: 'description', width: 280 },
    { title: t('field.creatorName'), dataIndex: 'creatorName', width: 140 },
    {
      title: t('field.assigneeName'),
      dataIndex: 'assigneeName',
      width: 140,
      render: (value: string) => value || '-',
    },
    {
      title: t('field.status'),
      dataIndex: 'status',
      width: 120,
      render: (value: string) => (
        <Tag color={STATUS_COLOR[value] ?? 'default'}>
          {t('status.' + value, { defaultValue: value })}
        </Tag>
      ),
    },
    {
      title: t('field.createdAt'),
      dataIndex: 'createdAt',
      width: 170,
      render: (value: string) => formatDate(value),
    },
    {
      title: t('field.actions'),
      key: 'actions',
      width: 180,
      fixed: 'right',
      render: (_, r) => {
        const isCreator = Number(currentUser?.id) === r.creatorId
        const canStart = canAssign && r.status === 'open'
        const canFinish = canAssign && r.status === 'processing'
        const canConfirm = isCreator && r.status === 'completed'
        return (
          <div className="classrooms-page__actions">
            {canStart && (
              <Button
                type="text"
                size="small"
                onClick={() => openProcess(r, 'processing')}
                disabled={actingId === r.id}
              >
                {t('action.start')}
              </Button>
            )}
            {canFinish && (
              <Button
                type="text"
                size="small"
                onClick={() => openProcess(r, 'completed')}
                disabled={actingId === r.id}
              >
                {t('action.finish')}
              </Button>
            )}
            {canConfirm && (
              <Button
                type="text"
                size="small"
                icon={<CheckOutlined />}
                onClick={() => handleConfirm(r)}
                disabled={actingId === r.id}
              >
                {t('action.confirm')}
              </Button>
            )}
            {!canStart && !canFinish && !canConfirm && (
              <span style={{ color: 'var(--cds-text-secondary)' }}>—</span>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div className="classrooms-page">
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
          { title: t('breadcrumb.current') },
        ]}
      />
      <h1 className="classrooms-page__heading">{t('title')}</h1>
      <p className="classrooms-page__subtitle">{t('subtitle')}</p>

      {error && (
        <Alert type="error" showIcon title={t('error.action')} description={error} className="classrooms-page__notice" />
      )}

      <div className="bookings-page__filters">
        <Field label={t('filter.status')} htmlFor="f-status" className="bookings-page__filter">
          <Select
            id="f-status"
            value={filterStatus}
            onChange={(value: string) => setFilterStatus(value)}
            options={[
              { value: '', label: t('filter.allStatuses') },
              { value: 'open', label: t('status.open') },
              { value: 'processing', label: t('status.processing') },
              { value: 'completed', label: t('status.completed') },
              { value: 'confirmed', label: t('status.confirmed') },
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
          placeholder={t('table.searchPlaceholder')}
          value={list.q}
          onChange={(e) => list.setQ(e.target.value)}
        />
        {canSubmit && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            {t('table.addButton')}
          </Button>
        )}
      </div>

      <Table<RepairView>
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={list.items}
        loading={loading}
        pagination={false}
        scroll={{ x: 1000 }}
        locale={{ emptyText: list.q ? t('empty.search') : t('empty.none') }}
      />

      <ListPagination
        page={list.page}
        pageSize={list.pageSize}
        totalItems={list.total}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
      />

      {/* Submit form */}
      <Modal
        open={formOpen}
        title={t('modal.create')}
        okText={t('modal.createSubmit')}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={() => setFormOpen(false)}
        onOk={handleCreate}
        confirmLoading={saving}
        destroyOnHidden
      >
        <div className="classrooms-page__form">
          <Field label={t('form.classroom')} htmlFor="r-classroom">
            <Select
              id="r-classroom"
              value={form.classroomId}
              onChange={(value: string) => setForm({ ...form, classroomId: value })}
              options={[
                { value: '', label: t('form.classroomPlaceholder') },
                ...classrooms.map((c) => ({
                  value: String(c.id),
                  label: classroomLabel({ building: c.building, classroomName: c.name }),
                })),
              ]}
            />
          </Field>
          <Field label={t('form.description')} htmlFor="r-description">
            <Input.TextArea
              id="r-description"
              placeholder={t('form.descriptionPlaceholder')}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={4}
            />
          </Field>
          {formError && (
            <Alert type="error" showIcon title={t('error.submit')} description={formError} />
          )}
        </div>
      </Modal>

      {/* Process dialog */}
      <Modal
        open={Boolean(processTarget)}
        title={processTarget?.nextStatus === 'processing' ? t('modal.processStart') : t('modal.processFinish')}
        okText={t('modal.processSubmit')}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={() => setProcessTarget(null)}
        onOk={handleProcess}
        confirmLoading={processing}
        destroyOnHidden
      >
        <div className="classrooms-page__form">
          <p className="classrooms-page__confirm-text">
            {t('modal.classroomLine', { classroom: processTarget ? classroomLabel(processTarget) : '' })}
          </p>
          <Field label={t('modal.remark')} htmlFor="r-remark">
            <Input.TextArea
              id="r-remark"
              placeholder={t('modal.remarkPlaceholder')}
              value={processRemark}
              onChange={(e) => setProcessRemark(e.target.value)}
              rows={3}
            />
          </Field>
          {processError && (
            <Alert type="error" showIcon title={t('error.action')} description={processError} />
          )}
        </div>
      </Modal>
    </div>
  )
}
