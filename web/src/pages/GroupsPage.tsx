import { useEffect, useState } from 'react'
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
import Field from '../ui/Field'
import { formatDate } from '../i18n/formatters'
import type { GroupDetail, GroupView, Paged, Role, User } from '../types/api'

// Picker option shape: id is the stringified entity id (members/roles keep
// string ids in the form and convert on submit).
interface PickerOption {
  id: string
  text: string
}

// Form state: members/roles hold stringified ids while editing.
interface GroupForm {
  name: string
  description: string
  members: string[]
  roles: string[]
}

const emptyForm: GroupForm = { name: '', description: '', members: [], roles: [] }

export default function GroupsPage() {
  const { t } = useTranslation('groups')
  const { token } = useAuth()
  const navigate = useNavigate()

  const [groups, setGroups] = useState<GroupView[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<GroupForm>(emptyForm)
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  const [editTarget, setEditTarget] = useState<GroupView | null>(null)
  const [editForm, setEditForm] = useState<GroupForm>(emptyForm)
  const [editError, setEditError] = useState('')
  const [editing, setEditing] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<GroupView | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Picker sources: all users (up to 500) and all roles.
  const [userOptions, setUserOptions] = useState<PickerOption[]>([])
  const [roleOptions, setRoleOptions] = useState<PickerOption[]>([])

  const load = async () => {
    try {
      setLoading(true)
      setLoadError('')
      const groupsData = await apiFetch<GroupView[]>('/api/groups', { token })
      setGroups(Array.isArray(groupsData) ? groupsData : [])
    } catch (err) {
      setLoadError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const loadPickerSources = async () => {
    const [usersPage, roles] = await Promise.all([
      apiFetch<Paged<User>>('/api/users?page_size=500', { token }),
      apiFetch<Role[]>('/api/roles', { token }),
    ])
    setUserOptions(
      (usersPage?.items ?? []).map((u) => ({
        id: String(u.id),
        text: t('picker.userOption', { name: u.displayName, username: u.username }),
      })),
    )
    setRoleOptions(
      (roles ?? []).map((r) => ({
        id: String(r.id),
        text: t('picker.roleOption', { name: r.name, code: r.code }),
      })),
    )
  }

  const openCreate = async () => {
    setCreateForm(emptyForm)
    setCreateError('')
    setCreateOpen(true)
    try {
      await loadPickerSources()
    } catch {
      // Picker failure is non-fatal: name/description still work.
    }
  }

  const handleCreate = async () => {
    if (!createForm.name.trim()) {
      setCreateError(t('validation.nameRequired'))
      return
    }
    try {
      setCreating(true)
      setCreateError('')
      await apiFetch('/api/groups', {
        method: 'POST',
        token,
        body: {
          name: createForm.name.trim(),
          description: createForm.description.trim(),
          members: createForm.members.map(Number),
          roles: createForm.roles.map(Number),
        },
      })
      setCreateOpen(false)
      load()
    } catch (err) {
      setCreateError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const openEdit = async (group: GroupView) => {
    setEditTarget(group)
    setEditError('')
    try {
      const [detail] = await Promise.all([
        apiFetch<GroupDetail>(`/api/groups/${group.id}`, { token }),
        loadPickerSources(),
      ])
      setEditForm({
        name: detail.name,
        description: detail.description,
        members: (detail.members ?? []).map((m) => String(m.id)),
        roles: (detail.roles ?? []).map((r) => String(r.id)),
      })
    } catch (err) {
      setEditError((err as Error).message)
    }
  }

  const handleEdit = async () => {
    if (!editTarget) return
    if (!editForm.name.trim()) {
      setEditError(t('validation.nameRequired'))
      return
    }
    try {
      setEditing(true)
      setEditError('')
      await apiFetch(`/api/groups/${editTarget.id}`, {
        method: 'PUT',
        token,
        body: {
          name: editForm.name.trim(),
          description: editForm.description.trim(),
          members: editForm.members.map(Number),
          roles: editForm.roles.map(Number),
        },
      })
      setEditTarget(null)
      load()
    } catch (err) {
      setEditError((err as Error).message)
    } finally {
      setEditing(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      setDeleting(true)
      setDeleteError('')
      await apiFetch(`/api/groups/${deleteTarget.id}`, { method: 'DELETE', token })
      setDeleteTarget(null)
      load()
    } catch (err) {
      setDeleteError((err as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  const columns: TableColumnsType<GroupView> = [
    { title: t('field.id'), dataIndex: 'id', width: 72 },
    { title: t('field.name'), dataIndex: 'name', width: 200 },
    { title: t('field.description'), dataIndex: 'description', ellipsis: true },
    { title: t('field.memberCount'), dataIndex: 'memberCount', width: 110 },
    {
      title: t('field.createdAt'),
      dataIndex: 'createdAt',
      width: 170,
      render: (value: string) => formatDate(value),
    },
    {
      title: t('field.actions'),
      key: 'actions',
      width: 108,
      render: (_, group) => (
        <div className="groups-page__actions">
          <Button
            type="text"
            size="small"
            aria-label={t('action.edit', { ns: 'common' })}
            icon={<EditOutlined />}
            onClick={() => openEdit(group)}
          />
          <Button
            type="text"
            size="small"
            danger
            aria-label={t('action.delete', { ns: 'common' })}
            icon={<DeleteOutlined />}
            onClick={() => {
              setDeleteTarget(group)
              setDeleteError('')
            }}
          />
        </div>
      ),
    },
  ]

  const pickerOptions = (options: PickerOption[]) =>
    options.map((o) => ({ value: o.id, label: o.text }))

  return (
    <div className="groups-page">
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
      <h1 className="groups-page__heading">{t('title')}</h1>
      <p className="groups-page__subtitle">{t('subtitle')}</p>

      {loadError && (
        <Alert
          type="error"
          showIcon
          title={t('error.load')}
          description={loadError}
          className="groups-page__notice"
        />
      )}

      <div className="ds-table-toolbar">
        <span className="ds-table-toolbar__title">{t('table.title')}</span>
        <span className="ds-table-toolbar__hint">{t('table.description', { count: groups.length })}</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          {t('addButton')}
        </Button>
      </div>

      <Table<GroupView>
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={groups}
        loading={loading}
        pagination={false}
        scroll={{ x: 900 }}
        locale={{ emptyText: t('empty.none') }}
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
        <div className="groups-page__form">
          <Field label={t('form.name')} htmlFor="create-group-name">
            <Input
              id="create-group-name"
              placeholder={t('placeholder.name')}
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
            />
          </Field>
          <Field label={t('form.description')} htmlFor="create-group-description">
            <Input.TextArea
              id="create-group-description"
              rows={3}
              value={createForm.description}
              onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
            />
          </Field>
          <Field label={t('form.members')} htmlFor="create-group-members">
            <Select
              id="create-group-members"
              mode="multiple"
              allowClear
              placeholder={t('picker.members')}
              options={pickerOptions(userOptions)}
              value={createForm.members}
              onChange={(members: string[]) => setCreateForm({ ...createForm, members })}
              optionFilterProp="label"
            />
          </Field>
          <Field label={t('form.roles')} htmlFor="create-group-roles">
            <Select
              id="create-group-roles"
              mode="multiple"
              allowClear
              placeholder={t('picker.roles')}
              options={pickerOptions(roleOptions)}
              value={createForm.roles}
              onChange={(roles: string[]) => setCreateForm({ ...createForm, roles })}
              optionFilterProp="label"
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
        <div className="groups-page__form">
          <Field label={t('form.name')} htmlFor="edit-group-name">
            <Input
              id="edit-group-name"
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            />
          </Field>
          <Field label={t('form.description')} htmlFor="edit-group-description">
            <Input.TextArea
              id="edit-group-description"
              rows={3}
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
            />
          </Field>
          <Field label={t('form.members')} htmlFor="edit-group-members">
            <Select
              id="edit-group-members"
              mode="multiple"
              allowClear
              placeholder={t('picker.members')}
              options={pickerOptions(userOptions)}
              value={editForm.members}
              onChange={(members: string[]) => setEditForm({ ...editForm, members })}
              optionFilterProp="label"
            />
          </Field>
          <Field label={t('form.roles')} htmlFor="edit-group-roles">
            <Select
              id="edit-group-roles"
              mode="multiple"
              allowClear
              placeholder={t('picker.roles')}
              options={pickerOptions(roleOptions)}
              value={editForm.roles}
              onChange={(roles: string[]) => setEditForm({ ...editForm, roles })}
              optionFilterProp="label"
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
        <p className="groups-page__confirm-text">
          {t('deleteConfirm', { name: deleteTarget?.name })}
        </p>
        {deleteError && <Alert type="error" showIcon title={t('error.delete')} description={deleteError} />}
      </Modal>
    </div>
  )
}
