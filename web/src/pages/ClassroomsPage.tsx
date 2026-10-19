import { useState } from 'react'
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
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../auth/api'
import ExportButton from '../components/ExportButton'
import ListPagination from '../components/ListPagination'
import usePagedList from '../hooks/usePagedList'
import Field from '../ui/Field'
import { formatDate } from '../i18n/formatters'
import type { Classroom, ClassroomInput } from '../types/api'

// Enum value lists (not translatable text — the labels come from i18n).
const TYPE_KEYS = [
  'standard',
  'multimedia',
  'computer',
  'lab',
  'lecture_hall',
  'stadium',
  'drawing',
  'language',
  'studio',
  'special',
] as const
const STATUS_KEYS = ['available', 'maintenance', 'disabled'] as const

const STATUS_COLOR: Record<string, string> = {
  available: 'green',
  maintenance: 'blue',
  disabled: 'red',
}

// Form fields are all strings while editing; capacity converts on submit.
interface ClassroomForm {
  name: string
  building: string
  capacity: string
  type: string
  floor: string
  campus: string
  status: string
  description: string
}

const emptyForm: ClassroomForm = {
  name: '',
  building: '',
  capacity: '',
  type: 'standard',
  floor: '',
  campus: '',
  status: 'available',
  description: '',
}

export default function ClassroomsPage() {
  const { t } = useTranslation('classrooms')
  const { token, can } = useAuth()
  const navigate = useNavigate()
  const canManage = can('classroom:manage')

  const list = usePagedList<Classroom>({ path: '/api/classrooms', token })
  const { loading } = list
  // Export errors are separate from the list fetch (the hook owns its error).
  const [exportError, setExportError] = useState('')
  const error = list.error || exportError

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<ClassroomForm>(emptyForm)
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  const [editTarget, setEditTarget] = useState<Classroom | null>(null)
  const [editForm, setEditForm] = useState<ClassroomForm>(emptyForm)
  const [editError, setEditError] = useState('')
  const [editing, setEditing] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<Classroom | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  const validate = (form: ClassroomForm) => {
    if (!form.name.trim()) return t('validation.nameRequired')
    if (!form.capacity || Number(form.capacity) <= 0) return t('validation.capacityPositive')
    return ''
  }

  const buildBody = (form: ClassroomForm): ClassroomInput => ({
    name: form.name.trim(),
    building: form.building.trim(),
    capacity: Number(form.capacity),
    type: form.type,
    floor: form.floor.trim(),
    campus: form.campus.trim(),
    status: form.status,
    description: form.description.trim(),
  })

  const handleCreate = async () => {
    const msg = validate(createForm)
    if (msg) {
      setCreateError(msg)
      return
    }
    try {
      setCreating(true)
      setCreateError('')
      await apiFetch('/api/classrooms', {
        method: 'POST',
        token,
        body: buildBody(createForm),
      })
      setCreateOpen(false)
      setCreateForm(emptyForm)
      list.reload()
    } catch (err) {
      setCreateError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const openEdit = (c: Classroom) => {
    setEditTarget(c)
    setEditForm({
      name: c.name,
      building: c.building,
      capacity: String(c.capacity),
      type: c.type,
      floor: c.floor ?? '',
      campus: c.campus ?? '',
      status: c.status,
      description: c.description,
    })
    setEditError('')
  }

  const handleEdit = async () => {
    if (!editTarget) return
    const msg = validate(editForm)
    if (msg) {
      setEditError(msg)
      return
    }
    try {
      setEditing(true)
      setEditError('')
      await apiFetch(`/api/classrooms/${editTarget.id}`, {
        method: 'PUT',
        token,
        body: buildBody(editForm),
      })
      setEditTarget(null)
      list.reload()
    } catch (err) {
      setEditError((err as Error).message)
    } finally {
      setEditing(false)
    }
  }

  const openDelete = (c: Classroom) => {
    setDeleteTarget(c)
    setDeleteError('')
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      setDeleting(true)
      setDeleteError('')
      await apiFetch(`/api/classrooms/${deleteTarget.id}`, { method: 'DELETE', token })
      setDeleteTarget(null)
      list.reload()
    } catch (err) {
      setDeleteError((err as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  const columns: TableColumnsType<Classroom> = [
    { title: t('field.id'), dataIndex: 'id', width: 72 },
    { title: t('field.name'), dataIndex: 'name', width: 160 },
    { title: t('field.building'), dataIndex: 'building', width: 140 },
    { title: t('field.capacity'), dataIndex: 'capacity', width: 96 },
    {
      title: t('field.type'),
      dataIndex: 'type',
      width: 130,
      render: (value: string) => t('type.' + value, { defaultValue: value }),
    },
    { title: t('field.floor'), dataIndex: 'floor', width: 90 },
    { title: t('field.campus'), dataIndex: 'campus', width: 120 },
    {
      title: t('field.status'),
      dataIndex: 'status',
      width: 110,
      render: (value: string) => (
        <Tag color={STATUS_COLOR[value] ?? 'default'}>
          {t('status.' + value, { ns: 'common', defaultValue: value })}
        </Tag>
      ),
    },
    {
      title: t('field.createdAt'),
      dataIndex: 'createdAt',
      width: 170,
      render: (value: string) => formatDate(value),
    },
  ]

  if (canManage) {
    columns.push({
      title: t('field.actions'),
      key: 'actions',
      width: 108,
      fixed: 'right',
      render: (_, c) => (
        <div className="classrooms-page__actions">
          <Button
            type="text"
            size="small"
            aria-label={t('action.edit', { ns: 'common' })}
            icon={<EditOutlined />}
            onClick={() => openEdit(c)}
          />
          <Button
            type="text"
            size="small"
            danger
            aria-label={t('action.delete', { ns: 'common' })}
            icon={<DeleteOutlined />}
            onClick={() => openDelete(c)}
          />
        </div>
      ),
    })
  }

  const formFields = (
    form: ClassroomForm,
    setForm: (next: ClassroomForm) => void,
    idPrefix: string,
  ) => (
    <>
      <Field label={t('field.name')} htmlFor={`${idPrefix}-name`}>
        <Input
          id={`${idPrefix}-name`}
          placeholder={t('placeholder.name')}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>
      <Field label={t('field.building')} htmlFor={`${idPrefix}-building`}>
        <Input
          id={`${idPrefix}-building`}
          placeholder={t('placeholder.building')}
          value={form.building}
          onChange={(e) => setForm({ ...form, building: e.target.value })}
        />
      </Field>
      <Field label={t('field.capacity')} htmlFor={`${idPrefix}-capacity`}>
        <Input
          id={`${idPrefix}-capacity`}
          type="number"
          min={1}
          value={form.capacity}
          onChange={(e) => setForm({ ...form, capacity: e.target.value })}
        />
      </Field>
      <Field label={t('field.type')} htmlFor={`${idPrefix}-type`}>
        <Select
          id={`${idPrefix}-type`}
          value={form.type}
          onChange={(type: string) => setForm({ ...form, type })}
          options={TYPE_KEYS.map((k) => ({ value: k, label: t('type.' + k) }))}
        />
      </Field>
      <Field label={t('field.floor')} htmlFor={`${idPrefix}-floor`}>
        <Input
          id={`${idPrefix}-floor`}
          placeholder={t('placeholder.floor')}
          value={form.floor}
          onChange={(e) => setForm({ ...form, floor: e.target.value })}
        />
      </Field>
      <Field label={t('field.campus')} htmlFor={`${idPrefix}-campus`}>
        <Input
          id={`${idPrefix}-campus`}
          placeholder={t('placeholder.campus')}
          value={form.campus}
          onChange={(e) => setForm({ ...form, campus: e.target.value })}
        />
      </Field>
      <Field label={t('field.status')} htmlFor={`${idPrefix}-status`}>
        <Select
          id={`${idPrefix}-status`}
          value={form.status}
          onChange={(status: string) => setForm({ ...form, status })}
          options={STATUS_KEYS.map((k) => ({ value: k, label: t('status.' + k, { ns: 'common' }) }))}
        />
      </Field>
      <Field label={t('field.description')} htmlFor={`${idPrefix}-description`}>
        <Input
          id={`${idPrefix}-description`}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </Field>
    </>
  )

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
        <Alert type="error" showIcon title={t('error.load')} description={error} className="classrooms-page__notice" />
      )}

      <div className="ds-table-toolbar">
        <span className="ds-table-toolbar__title">{t('table.title')}</span>
        <span className="ds-table-toolbar__hint">{t('table.description', { count: list.total })}</span>
        <Input
          allowClear
          className="ds-table-toolbar__search"
          placeholder={t('searchPlaceholder')}
          value={list.q}
          onChange={(e) => list.setQ(e.target.value)}
        />
        <ExportButton path="/api/classrooms/export" fallbackName="classrooms.xlsx" onError={setExportError} />
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            {t('addButton')}
          </Button>
        )}
      </div>

      <Table<Classroom>
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={list.items}
        loading={loading}
        pagination={false}
        scroll={{ x: 1200 }}
        locale={{ emptyText: list.q ? t('empty.search') : t('empty.none') }}
      />

      <ListPagination
        page={list.page}
        pageSize={list.pageSize}
        totalItems={list.total}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
      />

      {/* Create */}
      <Modal
        open={createOpen}
        title={t('modal.create')}
        okText={t('modal.createSubmit')}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        confirmLoading={creating}
        destroyOnHidden
      >
        <div className="classrooms-page__form">
          {formFields(createForm, setCreateForm, 'create')}
          {createError && <Alert type="error" showIcon title={t('error.create')} description={createError} />}
        </div>
      </Modal>

      {/* Edit */}
      <Modal
        open={Boolean(editTarget)}
        title={t('modal.edit', { name: editTarget?.name ?? '' })}
        okText={t('modal.editSubmit')}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={() => setEditTarget(null)}
        onOk={handleEdit}
        confirmLoading={editing}
        destroyOnHidden
      >
        <div className="classrooms-page__form">
          {formFields(editForm, setEditForm, 'edit')}
          {editError && <Alert type="error" showIcon title={t('error.save')} description={editError} />}
        </div>
      </Modal>

      {/* Delete */}
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
        <p className="classrooms-page__confirm-text">{t('deleteConfirm', { name: deleteTarget?.name })}</p>
        {deleteError && <Alert type="error" showIcon title={t('error.delete')} description={deleteError} />}
      </Modal>
    </div>
  )
}
