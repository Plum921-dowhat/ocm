import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import {
  Alert,
  Breadcrumb,
  Button,
  Input,
  Modal,
  Select,
  Table,
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
import type { AdminClass, Paged, TeachingClassInput, TeachingClassView } from '../types/api'

// classLabel formats an admin class as "grade/name" (or just name when the
// grade is empty). grade/name are backend data, so the format is locale-neutral.
const classLabel = (c: Pick<AdminClass, 'grade' | 'name'>) => (c.grade ? `${c.grade}/${c.name}` : c.name)

// Form state: classIds holds the selected member admin-class ids (numbers).
interface ClassForm {
  name: string
  note: string
  classIds: number[]
}

const emptyForm: ClassForm = { name: '', note: '', classIds: [] }

export default function TeachingClassesPage() {
  const { t, i18n } = useTranslation('teachingClasses')
  const { token, can } = useAuth()
  const navigate = useNavigate()
  const canManage = can('teaching_class:manage')

  const list = usePagedList<TeachingClassView>({ path: '/api/teaching-classes', token })
  const { loading } = list
  const [adminClasses, setAdminClasses] = useState<AdminClass[]>([])
  // Export errors are separate from the list fetch (the hook owns its error).
  const [exportError, setExportError] = useState('')
  const error = list.error || exportError

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<ClassForm>(emptyForm)
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  const [editTarget, setEditTarget] = useState<TeachingClassView | null>(null)
  const [editForm, setEditForm] = useState<ClassForm>(emptyForm)
  const [editError, setEditError] = useState('')
  const [editing, setEditing] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<TeachingClassView | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  // The admin-class dropdown needs the full option list; pull the maximum page.
  useEffect(() => {
    let cancelled = false
    apiFetch<Paged<AdminClass>>('/api/admin-classes?page_size=500', { token })
      .then((data) => {
        if (cancelled) return
        setAdminClasses(Array.isArray(data?.items) ? data.items : [])
      })
      .catch(() => {
        if (!cancelled) setAdminClasses([])
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const validate = (form: ClassForm) => {
    if (!form.name.trim()) return t('validation.nameRequired')
    if (form.classIds.length === 0) return t('validation.selectClass')
    return ''
  }

  const buildBody = (form: ClassForm): TeachingClassInput => ({
    name: form.name.trim(),
    note: form.note.trim(),
    classIds: form.classIds,
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
      await apiFetch('/api/teaching-classes', { method: 'POST', token, body: buildBody(createForm) })
      setCreateOpen(false)
      setCreateForm(emptyForm)
      list.reload()
    } catch (err) {
      setCreateError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const openEdit = (tc: TeachingClassView) => {
    setEditTarget(tc)
    setEditForm({
      name: tc.name,
      note: tc.note,
      classIds: (tc.classes || []).map((c) => c.id),
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
      await apiFetch(`/api/teaching-classes/${editTarget.id}`, { method: 'PUT', token, body: buildBody(editForm) })
      setEditTarget(null)
      list.reload()
    } catch (err) {
      setEditError((err as Error).message)
    } finally {
      setEditing(false)
    }
  }

  const openDelete = (tc: TeachingClassView) => {
    setDeleteTarget(tc)
    setDeleteError('')
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      setDeleting(true)
      setDeleteError('')
      await apiFetch(`/api/teaching-classes/${deleteTarget.id}`, { method: 'DELETE', token })
      setDeleteTarget(null)
      list.reload()
    } catch (err) {
      setDeleteError((err as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  // Members column joins admin-class labels with a locale-appropriate separator
  // (zh: "、" with en: ", ") via Intl.ListFormat narrow style.
  const listFmt = new Intl.ListFormat(i18n.language, { style: 'narrow' })
  const formatMembers = (classes: TeachingClassView['classes']) => {
    const labels = (classes || []).map(classLabel)
    return labels.length ? listFmt.format(labels) : '-'
  }

  const renderMemberSelect = (form: ClassForm, setForm: Dispatch<SetStateAction<ClassForm>>) => (
    // Controlled: the edit form's preselected members only take effect via the
    // controlled value prop (the modal does not remount its content on open).
    <Field label={t('form.classes')} htmlFor="tc-classes">
      <Select
        id="tc-classes"
        mode="multiple"
        allowClear
        value={form.classIds}
        options={adminClasses.map((a) => ({ value: a.id, label: classLabel(a) }))}
        onChange={(classIds: number[]) => setForm({ ...form, classIds })}
        placeholder={t('classesPicker.label')}
        disabled={adminClasses.length === 0}
      />
    </Field>
  )

  const columns: TableColumnsType<TeachingClassView> = [
    { title: t('field.id'), dataIndex: 'id', width: 72 },
    {
      title: t('field.name'),
      dataIndex: 'name',
      width: 200,
      render: (value: string) => value || '-',
    },
    {
      title: t('field.members'),
      key: 'members',
      ellipsis: true,
      render: (_, tc) => formatMembers(tc.classes),
    },
    {
      title: t('field.note'),
      dataIndex: 'note',
      ellipsis: true,
      render: (value: string) => value || '-',
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
      render: (_, tc) => (
        <div className="teaching-classes-page__actions">
          <Button
            type="text"
            size="small"
            aria-label={t('action.edit', { ns: 'common' })}
            icon={<EditOutlined />}
            onClick={() => openEdit(tc)}
          />
          <Button
            type="text"
            size="small"
            danger
            aria-label={t('action.delete', { ns: 'common' })}
            icon={<DeleteOutlined />}
            onClick={() => openDelete(tc)}
          />
        </div>
      ),
    })
  }

  return (
    <div className="teaching-classes-page">
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
      <h1 className="teaching-classes-page__heading">{t('title')}</h1>
      <p className="teaching-classes-page__subtitle">{t('subtitle')}</p>
      {adminClasses.length === 0 && (
        <Alert
          type="info"
          showIcon
          title={t('info.title')}
          description={t('info.subtitle')}
          className="teaching-classes-page__notice"
        />
      )}

      {error && (
        <Alert
          type="error"
          showIcon
          title={t('error.load')}
          description={error}
          className="teaching-classes-page__notice"
        />
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
        <ExportButton
          path="/api/teaching-classes/export"
          fallbackName="teaching-classes.xlsx"
          onError={setExportError}
        />
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            {t('addButton')}
          </Button>
        )}
      </div>

      <Table<TeachingClassView>
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
        <div className="teaching-classes-page__form">
          <Field label={t('form.name')} htmlFor="tc-name">
            <Input
              id="tc-name"
              placeholder={t('placeholder.name')}
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
            />
          </Field>
          {renderMemberSelect(createForm, setCreateForm)}
          <Field label={t('form.note')} htmlFor="tc-note">
            <Input
              id="tc-note"
              value={createForm.note}
              onChange={(e) => setCreateForm({ ...createForm, note: e.target.value })}
            />
          </Field>
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
        <div className="teaching-classes-page__form">
          <Field label={t('form.name')} htmlFor="tc-edit-name">
            <Input
              id="tc-edit-name"
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            />
          </Field>
          {renderMemberSelect(editForm, setEditForm)}
          <Field label={t('form.note')} htmlFor="tc-edit-note">
            <Input
              id="tc-edit-note"
              value={editForm.note}
              onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
            />
          </Field>
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
        <p className="teaching-classes-page__confirm-text">
          {t('deleteConfirm', { name: deleteTarget?.name })}
        </p>
        {deleteError && <Alert type="error" showIcon title={t('error.delete')} description={deleteError} />}
      </Modal>
    </div>
  )
}
