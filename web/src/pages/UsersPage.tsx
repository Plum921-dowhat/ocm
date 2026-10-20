import { useState } from 'react'
import {
  Alert,
  Breadcrumb,
  Button,
  Checkbox,
  DatePicker,
  Input,
  Modal,
  Select,
  Table,
  Tag,
  type TableColumnsType,
} from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  KeyOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../auth/api'
import usePagedList from '../hooks/usePagedList'
import ListPagination from '../components/ListPagination'
import Field from '../ui/Field'
import { formatDate } from '../i18n/formatters'
import type {
  CatalogPermission,
  GroupBrief,
  Role,
  RoleBrief,
  User,
  UserGrantView,
  UserRolesInput,
  UserPermissionsInput,
} from '../types/api'

// User type enum values (not translatable text — labels come from i18n).
const TYPE_KEYS = ['student', 'teacher', 'staff'] as const

const TYPE_COLOR: Record<string, string> = {
  student: 'cyan',
  teacher: 'blue',
  staff: 'default',
}

const typeColor = (type: string) => TYPE_COLOR[type] ?? 'default'

interface CreateForm {
  username: string
  password: string
  displayName: string
  type: string
}

const emptyCreate: CreateForm = { username: '', password: '', displayName: '', type: 'staff' }

// One grant checkbox row: a role with optional expiry, or a catalog permission.
interface RoleGrantEntry {
  checked: boolean
  expiresAt: string
}

// Grants modal state: one entry per role (with optional expiry) and one per
// catalog permission. Groups are display-only.
interface GrantForm {
  roles: Record<string, RoleGrantEntry>
  permissions: Record<string, boolean>
  groups: GroupBrief[]
}

const emptyGrantForm: GrantForm = { roles: {}, permissions: {}, groups: [] }

export default function UsersPage() {
  const { t } = useTranslation('users')
  const { token, user: currentUser, can } = useAuth()
  const canManage = can('user:manage')
  const navigate = useNavigate()

  const list = usePagedList<User>({ path: '/api/users', token })
  const { loading } = list

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreate)
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  const [editTarget, setEditTarget] = useState<User | null>(null)
  const [editForm, setEditForm] = useState({ displayName: '', type: 'staff' })
  const [editError, setEditError] = useState('')
  const [editing, setEditing] = useState(false)

  const [pwdTarget, setPwdTarget] = useState<User | null>(null)
  const [pwdForm, setPwdForm] = useState({ password: '', confirm: '' })
  const [pwdError, setPwdError] = useState('')
  const [pwdSaving, setPwdSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  const [grantTarget, setGrantTarget] = useState<User | null>(null)
  const [grantRoles, setGrantRoles] = useState<Role[]>([])
  const [grantCatalog, setGrantCatalog] = useState<CatalogPermission[]>([])
  const [grantForm, setGrantForm] = useState<GrantForm>(emptyGrantForm)
  const [grantError, setGrantError] = useState('')
  const [grantLoading, setGrantLoading] = useState(false)
  const [grantSaving, setGrantSaving] = useState(false)

  const handleCreate = async () => {
    const { username, password, displayName, type } = createForm
    if (!username.trim() || !password || !displayName.trim()) {
      setCreateError(t('validation.createRequired'))
      return
    }
    try {
      setCreating(true)
      setCreateError('')
      await apiFetch('/api/users', {
        method: 'POST',
        token,
        body: {
          username: username.trim(),
          password,
          displayName: displayName.trim(),
          type,
        },
      })
      setCreateOpen(false)
      list.reload()
    } catch (err) {
      setCreateError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const openEdit = (u: User) => {
    setEditTarget(u)
    setEditForm({ displayName: u.displayName, type: u.type })
    setEditError('')
  }

  const handleEdit = async () => {
    if (!editTarget) return
    if (!editForm.displayName.trim()) {
      setEditError(t('validation.displayNameRequired'))
      return
    }
    try {
      setEditing(true)
      setEditError('')
      await apiFetch(`/api/users/${editTarget.id}`, {
        method: 'PUT',
        token,
        body: {
          displayName: editForm.displayName.trim(),
          type: editForm.type,
        },
      })
      setEditTarget(null)
      list.reload()
    } catch (err) {
      setEditError((err as Error).message)
    } finally {
      setEditing(false)
    }
  }

  const openPassword = (u: User) => {
    setPwdTarget(u)
    setPwdForm({ password: '', confirm: '' })
    setPwdError('')
  }

  const handlePassword = async () => {
    if (!pwdTarget) return
    if (!pwdForm.password) {
      setPwdError(t('validation.passwordRequired'))
      return
    }
    if (pwdForm.password !== pwdForm.confirm) {
      setPwdError(t('validation.passwordMismatch'))
      return
    }
    try {
      setPwdSaving(true)
      setPwdError('')
      await apiFetch(`/api/users/${pwdTarget.id}/password`, {
        method: 'PATCH',
        token,
        body: { password: pwdForm.password },
      })
      setPwdTarget(null)
    } catch (err) {
      setPwdError((err as Error).message)
    } finally {
      setPwdSaving(false)
    }
  }

  const openDelete = (u: User) => {
    setDeleteTarget(u)
    setDeleteError('')
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      setDeleting(true)
      setDeleteError('')
      await apiFetch(`/api/users/${deleteTarget.id}`, { method: 'DELETE', token })
      setDeleteTarget(null)
      list.reload()
    } catch (err) {
      setDeleteError((err as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  // ---- Grants modal ----

  const openGrants = async (u: User) => {
    setGrantTarget(u)
    setGrantError('')
    setGrantLoading(true)
    try {
      const [grants, roles, catalog] = await Promise.all([
        apiFetch<UserGrantView>(`/api/users/${u.id}/grants`, { token }),
        apiFetch<Role[]>('/api/roles', { token }),
        apiFetch<CatalogPermission[]>('/api/permissions', { token }),
      ])
      setGrantRoles(roles)
      setGrantCatalog(catalog)
      const form: GrantForm = { roles: {}, permissions: {}, groups: grants.groups }
      for (const role of roles) {
        const existing = grants.roles.find((g) => g.code === role.code)
        form.roles[role.code] = existing ? { checked: true, expiresAt: toDateInput(existing.expiresAt) } : { checked: false, expiresAt: '' }
      }
      for (const perm of catalog) {
        form.permissions[perm.code] = grants.permissions.some((g) => g.permission === perm.code)
      }
      setGrantForm(form)
    } catch (err) {
      setGrantError((err as Error).message)
    } finally {
      setGrantLoading(false)
    }
  }

  const handleGrantSave = async () => {
    if (!grantTarget) return
    try {
      setGrantSaving(true)
      setGrantError('')
      // Optional expiresAt: undefined drops the key on JSON.stringify, which
      // the Go side decodes as a nil pointer (never expires) — same wire
      // behavior as the explicit null the JS version sent.
      const roles: UserRolesInput['roles'] = Object.entries(grantForm.roles)
        .filter(([, v]) => v.checked)
        .map(([code, v]) => ({
          roleCode: code,
          expiresAt: v.expiresAt ? localMidnightUTC(v.expiresAt) : undefined,
        }))
      const permissions: UserPermissionsInput['permissions'] = Object.entries(grantForm.permissions)
        .filter(([, checked]) => checked)
        .map(([permission]) => ({ permission }))
      await apiFetch(`/api/users/${grantTarget.id}/roles`, {
        method: 'PUT',
        token,
        body: { roles },
      })
      await apiFetch(`/api/users/${grantTarget.id}/permissions`, {
        method: 'PUT',
        token,
        body: { permissions },
      })
      setGrantTarget(null)
      list.reload()
    } catch (err) {
      setGrantError((err as Error).message)
    } finally {
      setGrantSaving(false)
    }
  }

  const isSelf = (u: User | null | undefined) => Boolean(u) && String(u!.id) === String(currentUser?.id)

  const catalogGroups = groupCatalog(grantCatalog)

  const columns: TableColumnsType<User> = [
    { title: t('field.id'), dataIndex: 'id', width: 72 },
    { title: t('field.username'), dataIndex: 'username', width: 160 },
    { title: t('field.displayName'), dataIndex: 'displayName', width: 160 },
    {
      title: t('field.type'),
      dataIndex: 'type',
      width: 110,
      render: (value: string) => <Tag color={typeColor(value)}>{t('type.' + value, { defaultValue: value })}</Tag>,
    },
    {
      title: t('field.roles'),
      dataIndex: 'roles',
      width: 220,
      render: (items: RoleBrief[]) => <TagList items={items} />,
    },
    {
      title: t('field.groups'),
      dataIndex: 'groups',
      width: 200,
      render: (items: GroupBrief[]) => <TagList items={items} />,
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
      width: 168,
      fixed: 'right',
      render: (_, u) =>
        canManage ? (
          <div className="users-page__actions">
            <Button
              type="text"
              size="small"
              aria-label={t('action.edit', { ns: 'common' })}
              icon={<EditOutlined />}
              onClick={() => openEdit(u)}
            />
            <Button
              type="text"
              size="small"
              aria-label={t('iconAction.password')}
              icon={<KeyOutlined />}
              onClick={() => openPassword(u)}
            />
            <Button
              type="text"
              size="small"
              aria-label={t('iconAction.grants')}
              icon={<SafetyCertificateOutlined />}
              onClick={() => openGrants(u)}
            />
            <Button
              type="text"
              size="small"
              danger
              aria-label={t('action.delete', { ns: 'common' })}
              icon={<DeleteOutlined />}
              disabled={isSelf(u)}
              onClick={() => openDelete(u)}
            />
          </div>
        ) : (
          <span className="users-page__readonly">{t('readonly')}</span>
        ),
    },
  ]

  return (
    <div className="users-page">
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
      <h1 className="users-page__heading">{t('title')}</h1>
      <p className="users-page__subtitle">{t('subtitle')}</p>

      {list.error && (
        <Alert type="error" showIcon title={t('error.load')} description={list.error} className="users-page__notice" />
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
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            {t('addButton')}
          </Button>
        )}
      </div>

      <Table<User>
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={list.items}
        loading={loading}
        pagination={false}
        scroll={{ x: 1180 }}
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
        <div className="users-page__form">
          <Field label={t('form.username')} htmlFor="create-username">
            <Input
              id="create-username"
              value={createForm.username}
              onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
            />
          </Field>
          <Field label={t('form.password')} htmlFor="create-password">
            <Input.Password
              id="create-password"
              placeholder={t('form.passwordPlaceholder')}
              value={createForm.password}
              onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
            />
          </Field>
          <Field label={t('form.displayName')} htmlFor="create-displayName">
            <Input
              id="create-displayName"
              value={createForm.displayName}
              onChange={(e) => setCreateForm({ ...createForm, displayName: e.target.value })}
            />
          </Field>
          <Field label={t('form.type')} htmlFor="create-type">
            <Select
              id="create-type"
              value={createForm.type}
              onChange={(type: string) => setCreateForm({ ...createForm, type })}
              options={TYPE_KEYS.map((k) => ({ value: k, label: t('type.' + k) }))}
            />
          </Field>
          {createError && <Alert type="error" showIcon title={t('error.create')} description={createError} />}
        </div>
      </Modal>

      {/* Edit */}
      <Modal
        open={Boolean(editTarget)}
        title={t('modal.edit', { name: editTarget?.username ?? '' })}
        okText={t('modal.editSubmit')}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={() => setEditTarget(null)}
        onOk={handleEdit}
        confirmLoading={editing}
        destroyOnHidden
      >
        <div className="users-page__form">
          <Field label={t('form.displayName')} htmlFor="edit-displayName">
            <Input
              id="edit-displayName"
              value={editForm.displayName}
              onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
            />
          </Field>
          <Field label={t('form.type')} htmlFor="edit-type">
            <Select
              id="edit-type"
              value={editForm.type}
              onChange={(type: string) => setEditForm({ ...editForm, type })}
              options={TYPE_KEYS.map((k) => ({ value: k, label: t('type.' + k) }))}
            />
          </Field>
          {editError && <Alert type="error" showIcon title={t('error.save')} description={editError} />}
        </div>
      </Modal>

      {/* Password */}
      <Modal
        open={Boolean(pwdTarget)}
        title={t('modal.password', { name: pwdTarget?.username ?? '' })}
        okText={t('modal.passwordSubmit')}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={() => setPwdTarget(null)}
        onOk={handlePassword}
        confirmLoading={pwdSaving}
        destroyOnHidden
      >
        <div className="users-page__form">
          <Field label={t('form.newPassword')} htmlFor="pwd-password">
            <Input.Password
              id="pwd-password"
              value={pwdForm.password}
              onChange={(e) => setPwdForm({ ...pwdForm, password: e.target.value })}
            />
          </Field>
          <Field label={t('form.confirmPassword')} htmlFor="pwd-confirm">
            <Input.Password
              id="pwd-confirm"
              value={pwdForm.confirm}
              onChange={(e) => setPwdForm({ ...pwdForm, confirm: e.target.value })}
            />
          </Field>
          {pwdError && <Alert type="error" showIcon title={t('error.password')} description={pwdError} />}
        </div>
      </Modal>

      {/* Grants */}
      <Modal
        open={Boolean(grantTarget)}
        title={t('modal.grants', { name: grantTarget?.displayName ?? '' })}
        okText={t('modal.grantsSubmit')}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={() => setGrantTarget(null)}
        onOk={handleGrantSave}
        confirmLoading={grantSaving}
        width={720}
        style={{ top: 32 }}
        styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
        destroyOnHidden
      >
        <div className="users-page__grants">
          {grantLoading && <p>{t('empty.loading')}</p>}
          {grantError && <Alert type="error" showIcon title={t('error.grants')} description={grantError} />}
          {!grantLoading && (
            <>
              <section className="users-page__grants-section">
                <h3>{t('grants.roles')}</h3>
                <p className="users-page__grants-hint">{t('grants.rolesHint')}</p>
                {grantRoles.map((role) => {
                  const entry = grantForm.roles[role.code] ?? { checked: false, expiresAt: '' }
                  const expired = entry.checked && entry.expiresAt && new Date(entry.expiresAt) < startOfToday()
                  return (
                    <div key={role.id} className="users-page__grant-row">
                      <Checkbox
                        id={`grant-role-${role.id}`}
                        checked={entry.checked}
                        onChange={(e) =>
                          setGrantForm({
                            ...grantForm,
                            roles: { ...grantForm.roles, [role.code]: { ...entry, checked: e.target.checked } },
                          })
                        }
                      >
                        {role.name}
                      </Checkbox>
                      {role.isSystem && <Tag color="purple">{t('grants.builtin')}</Tag>}
                      {entry.checked && (
                        <DatePicker
                          id={`grant-role-${role.id}-expiry`}
                          size="small"
                          placeholder={t('grants.expiryPlaceholder')}
                          aria-label={t('grants.expiryLabel')}
                          value={entry.expiresAt ? dayjs(entry.expiresAt) : null}
                          onChange={(d) =>
                            setGrantForm({
                              ...grantForm,
                              roles: {
                                ...grantForm.roles,
                                [role.code]: { ...entry, expiresAt: d ? d.format('YYYY-MM-DD') : '' },
                              },
                            })
                          }
                        />
                      )}
                      {expired && <Tag color="red">{t('grants.expired')}</Tag>}
                    </div>
                  )
                })}
              </section>
              <section className="users-page__grants-section">
                <h3>{t('grants.permissions')}</h3>
                <p className="users-page__grants-hint">{t('grants.permissionsHint')}</p>
                {catalogGroups.map((group) => (
                  <div key={group.name} className="users-page__perm-group">
                    <div className="users-page__perm-group-name">{group.name}</div>
                    <div className="users-page__perm-options">
                      {group.items.map((perm) => (
                        <Checkbox
                          key={perm.code}
                          id={`grant-perm-${perm.code}`}
                          checked={Boolean(grantForm.permissions[perm.code])}
                          onChange={(e) =>
                            setGrantForm({
                              ...grantForm,
                              permissions: { ...grantForm.permissions, [perm.code]: e.target.checked },
                            })
                          }
                        >
                          {t('grants.permOption', { name: perm.name, code: perm.code })}
                        </Checkbox>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
              <section className="users-page__grants-section">
                <h3>{t('grants.groups')}</h3>
                <p className="users-page__grants-hint">{t('grants.groupsHint')}</p>
                {grantForm.groups.length === 0 ? (
                  <p className="users-page__grants-empty">{t('grants.groupsEmpty')}</p>
                ) : (
                  <div className="users-page__tags">
                    {grantForm.groups.map((g) => (
                      <Tag key={g.id}>{g.name}</Tag>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
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
        <p className="users-page__confirm-text">
          {t('deleteConfirm', { displayName: deleteTarget?.displayName, username: deleteTarget?.username })}
        </p>
        {deleteError && <Alert type="error" showIcon title={t('error.delete')} description={deleteError} />}
      </Modal>
    </div>
  )
}

// TagList renders a user's roles or groups; an empty list shows a dash so the
// column stays visually aligned.
function TagList({ items }: { items: Array<RoleBrief | GroupBrief> | undefined }) {
  const list = items ?? []
  if (list.length === 0) return <>-</>
  return (
    <div className="users-page__tags">
      {list.map((item) => (
        <Tag key={item.id}>{item.name}</Tag>
      ))}
    </div>
  )
}

// toDateInput renders a nullable expiry as a Y-M-D string for the picker.
function toDateInput(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// localMidnightUTC converts a Y-M-D picker value to a UTC RFC3339 instant of
// local midnight, matching the backend's server-side comparison.
function localMidnightUTC(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString()
}

function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
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
