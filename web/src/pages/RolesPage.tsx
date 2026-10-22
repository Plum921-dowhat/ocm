import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import {
  Alert,
  Breadcrumb,
  Button,
  Checkbox,
  Input,
  Modal,
  Table,
  Tag,
  type TableColumnsType,
} from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../auth/api'
import Field from '../ui/Field'
import type { CatalogPermission, Role } from '../types/api'

// Form state: permissions is a checkbox map keyed by permission code.
interface RoleForm {
  code: string
  name: string
  description: string
  permissions: Record<string, boolean>
}

const emptyForm: RoleForm = { code: '', name: '', description: '', permissions: {} }

export default function RolesPage() {
  const { t } = useTranslation('roles')
  const { token } = useAuth()
  const navigate = useNavigate()

  const [roles, setRoles] = useState<Role[]>([])
  const [catalog, setCatalog] = useState<CatalogPermission[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<RoleForm>(emptyForm)
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  const [editTarget, setEditTarget] = useState<Role | null>(null)
  const [editForm, setEditForm] = useState<RoleForm>(emptyForm)
  const [editError, setEditError] = useState('')
  const [editing, setEditing] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  const load = async () => {
    try {
      setLoading(true)
      setLoadError('')
      const [rolesData, catalogData] = await Promise.all([
        apiFetch<Role[]>('/api/roles', { token }),
        apiFetch<CatalogPermission[]>('/api/permissions', { token }),
      ])
      setRoles(Array.isArray(rolesData) ? rolesData : [])
      setCatalog(Array.isArray(catalogData) ? catalogData : [])
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

  // permissionChecked reads a permission key from a form's permission map.
  const permissionChecked = (form: RoleForm, code: string) => Boolean(form.permissions[code])

  const togglePermission = (form: RoleForm, setForm: Dispatch<SetStateAction<RoleForm>>, code: string, checked: boolean) =>
    setForm({ ...form, permissions: { ...form.permissions, [code]: checked } })

  const buildPermissions = (form: RoleForm) =>
    Object.entries(form.permissions)
      .filter(([, checked]) => checked)
      .map(([code]) => code)

  const openCreate = () => {
    setCreateForm(emptyForm)
    setCreateError('')
    setCreateOpen(true)
  }

  const handleCreate = async () => {
    if (!createForm.code.trim()) {
      setCreateError(t('validation.codeRequired'))
      return
    }
    if (!createForm.name.trim()) {
      setCreateError(t('validation.nameRequired'))
      return
    }
    try {
      setCreating(true)
      setCreateError('')
      await apiFetch('/api/roles', {
        method: 'POST',
        token,
        body: {
          code: createForm.code.trim(),
          name: createForm.name.trim(),
          description: createForm.description.trim(),
          permissions: buildPermissions(createForm),
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

  const openEdit = (role: Role | undefined) => {
    if (!role) return
    setEditTarget(role)
    const permissions: Record<string, boolean> = {}
    for (const perm of role.permissions) permissions[perm] = true
    setEditForm({ code: role.code, name: role.name, description: role.description, permissions })
    setEditError('')
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
      await apiFetch(`/api/roles/${editTarget.id}`, {
        method: 'PUT',
        token,
        body: {
          name: editForm.name.trim(),
          description: editForm.description.trim(),
          permissions: buildPermissions(editForm),
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
      await apiFetch(`/api/roles/${deleteTarget.id}`, { method: 'DELETE', token })
      setDeleteTarget(null)
      load()
    } catch (err) {
      setDeleteError((err as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  const catalogGroups = groupCatalog(catalog)

  const columns: TableColumnsType<Role> = [
    { title: t('field.id'), dataIndex: 'id', width: 72 },
    { title: t('field.code'), dataIndex: 'code', width: 180 },
    { title: t('field.name'), dataIndex: 'name', width: 180 },
    { title: t('field.description'), dataIndex: 'description', ellipsis: true },
    {
      title: t('field.permissions'),
      dataIndex: 'permissions',
      width: 130,
      render: (value: string[] | undefined) => {
        const list = value ?? []
        const all = list.includes('*')
        return <Tag color={all ? 'purple' : 'blue'}>{all ? t('permissions.all') : t('permissions.count', { count: list.length })}</Tag>
      },
    },
    {
      title: t('field.isSystem'),
      dataIndex: 'isSystem',
      width: 120,
      render: (value: boolean) => (
        <Tag color={value ? 'purple' : 'default'}>{value ? t('system.builtin') : t('system.custom')}</Tag>
      ),
    },
    {
      title: t('field.actions'),
      key: 'actions',
      width: 108,
      render: (_, role) => (
        <div className="roles-page__actions">
          <Button
            type="text"
            size="small"
            aria-label={t('action.edit', { ns: 'common' })}
            icon={<EditOutlined />}
            disabled={role.isSystem}
            onClick={() => openEdit(role)}
          />
          <Button
            type="text"
            size="small"
            danger
            aria-label={t('action.delete', { ns: 'common' })}
            icon={<DeleteOutlined />}
            disabled={role.isSystem}
            onClick={() => {
              setDeleteTarget(role)
              setDeleteError('')
            }}
          />
        </div>
      ),
    },
  ]

  return (
    <div className="roles-page">
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
      <h1 className="roles-page__heading">{t('title')}</h1>
      <p className="roles-page__subtitle">{t('subtitle')}</p>

      {loadError && (
        <Alert type="error" showIcon title={t('error.load')} description={loadError} className="roles-page__notice" />
      )}

      <div className="ds-table-toolbar">
        <span className="ds-table-toolbar__title">{t('table.title')}</span>
        <span className="ds-table-toolbar__hint">{t('table.description', { count: roles.length })}</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          {t('addButton')}
        </Button>
      </div>

      <Table<Role>
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={roles}
        loading={loading}
        pagination={false}
        scroll={{ x: 980 }}
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
        width={720}
        style={{ top: 32 }}
        styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
        destroyOnHidden
      >
        <div className="roles-page__form">
          <Field label={t('form.code')} htmlFor="create-role-code" hint={t('codeHelperCreate')}>
            <Input
              id="create-role-code"
              placeholder={t('placeholder.code')}
              value={createForm.code}
              onChange={(e) => setCreateForm({ ...createForm, code: e.target.value })}
            />
          </Field>
          <Field label={t('form.name')} htmlFor="create-role-name">
            <Input
              id="create-role-name"
              placeholder={t('placeholder.name')}
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
            />
          </Field>
          <Field label={t('form.description')} htmlFor="create-role-description">
            <Input.TextArea
              id="create-role-description"
              rows={2}
              value={createForm.description}
              onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
            />
          </Field>
          <div className="roles-page__perm-list">
            {catalogGroups.map((group) => (
              <div key={group.name} className="roles-page__perm-group">
                <div className="roles-page__perm-group-name">{group.name}</div>
                <div className="roles-page__perm-options">
                  {group.items.map((perm) => (
                    <Checkbox
                      key={perm.code}
                      id={`create-role-perm-${perm.code}`}
                      checked={permissionChecked(createForm, perm.code)}
                      onChange={(e) =>
                        togglePermission(createForm, setCreateForm, perm.code, e.target.checked)
                      }
                    >
                      {t('permOption', { name: perm.name, code: perm.code })}
                    </Checkbox>
                  ))}
                </div>
              </div>
            ))}
          </div>
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
        width={720}
        style={{ top: 32 }}
        styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
        destroyOnHidden
      >
        <div className="roles-page__form">
          <Field label={t('form.code')} htmlFor="edit-role-code" hint={t('codeHelperEdit')}>
            <Input id="edit-role-code" value={editForm.code} readOnly />
          </Field>
          <Field label={t('form.name')} htmlFor="edit-role-name">
            <Input
              id="edit-role-name"
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            />
          </Field>
          <Field label={t('form.description')} htmlFor="edit-role-description">
            <Input.TextArea
              id="edit-role-description"
              rows={2}
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
            />
          </Field>
          <div className="roles-page__perm-list">
            {catalogGroups.map((group) => (
              <div key={group.name} className="roles-page__perm-group">
                <div className="roles-page__perm-group-name">{group.name}</div>
                <div className="roles-page__perm-options">
                  {group.items.map((perm) => (
                    <Checkbox
                      key={perm.code}
                      id={`edit-role-perm-${perm.code}`}
                      checked={permissionChecked(editForm, perm.code)}
                      onChange={(e) =>
                        togglePermission(editForm, setEditForm, perm.code, e.target.checked)
                      }
                    >
                      {t('permOption', { name: perm.name, code: perm.code })}
                    </Checkbox>
                  ))}
                </div>
              </div>
            ))}
          </div>
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
        <p className="roles-page__confirm-text">{t('deleteConfirm', { name: deleteTarget?.name })}</p>
        {deleteError && <Alert type="error" showIcon title={t('error.delete')} description={deleteError} />}
      </Modal>
    </div>
  )
}

// groupCatalog buckets the permission catalog by categoryName, preserving
// the catalog's sorted order within each bucket.
function groupCatalog(catalog: CatalogPermission[]): Array<{ name: string; items: CatalogPermission[] }> {
  const groups = new Map<string, CatalogPermission[]>()
  for (const perm of catalog) {
    const bucket = groups.get(perm.categoryName)
    if (bucket) {
      bucket.push(perm)
    } else {
      groups.set(perm.categoryName, [perm])
    }
  }
  return Array.from(groups, ([name, items]) => ({ name, items }))
}
