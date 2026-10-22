import { useState } from 'react'
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
import type { AdminClass, AdminClassInput, Paged, StudentProfileInput, StudentProfileView, User } from '../types/api'

const emptyForm = { grade: '', name: '', note: '' }

// ComboBox option for the student picker: id is the stringified user id.
interface StudentOption {
  id: string
  text: string
}

// Edit-member form state (studentNo/note editable, userId immutable).
interface MemberEditForm {
  userId: number
  studentNo: string
  note: string
}

export default function AdminClassesPage() {
  const { t } = useTranslation('adminClasses')
  const { token, can } = useAuth()
  const navigate = useNavigate()
  const canManage = can('admin_class:manage')
  // Roster (学生档案) is gated by the attendance permissions: teachers may
  // curate members even without admin-class manage rights.
  const canRoster = can('attendance:read')
  const canRosterManage = can('attendance:manage')

  const list = usePagedList<AdminClass>({ path: '/api/admin-classes', token })
  const { loading } = list
  // Export errors are separate from the list fetch (the hook owns its error).
  const [exportError, setExportError] = useState('')
  const error = list.error || exportError

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState(emptyForm)
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  const [editTarget, setEditTarget] = useState<AdminClass | null>(null)
  const [editForm, setEditForm] = useState(emptyForm)
  const [editError, setEditError] = useState('')
  const [editing, setEditing] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<AdminClass | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Roster modal (成员) state.
  const [membersTarget, setMembersTarget] = useState<AdminClass | null>(null)
  const [members, setMembers] = useState<StudentProfileView[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [membersError, setMembersError] = useState('')
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([])
  const [pickStudent, setPickStudent] = useState<StudentOption | null>(null)
  const [pickNo, setPickNo] = useState('')
  const [addError, setAddError] = useState('')
  const [adding, setAdding] = useState(false)
  const [editMember, setEditMember] = useState<MemberEditForm | null>(null)
  const [editMemberError, setEditMemberError] = useState('')
  const [savingMember, setSavingMember] = useState(false)
  const [removeMember, setRemoveMember] = useState<StudentProfileView | null>(null)
  const [removeError, setRemoveError] = useState('')
  const [removing, setRemoving] = useState(false)

  const loadMembers = async (id: number) => {
    try {
      setMembersLoading(true)
      setMembersError('')
      const data = await apiFetch<StudentProfileView[]>(`/api/admin-classes/${id}/students`, { token })
      setMembers(Array.isArray(data) ? data : [])
    } catch (err) {
      setMembersError((err as Error).message)
    } finally {
      setMembersLoading(false)
    }
  }

  const openMembers = (c: AdminClass) => {
    setMembersTarget(c)
    setMembers([])
    setMembersError('')
    setPickStudent(null)
    setPickNo('')
    setAddError('')
    setStudentOptions([])
    loadMembers(c.id)
  }

  // ComboBox search: query users and keep only student accounts. The backend
  // validates the type again on add.
  const searchStudents = async (q: string) => {
    try {
      const data = await apiFetch<Paged<User>>(`/api/users?q=${encodeURIComponent(q)}&page_size=50`, { token })
      setStudentOptions(
        ((data && data.items) || [])
          .filter((u) => u.type === 'student')
          .map((u) => ({ id: String(u.id), text: t('picker.userOption', { name: u.displayName, username: u.username }) })),
      )
    } catch {
      setStudentOptions([])
    }
  }

  const handleAddMember = async () => {
    if (!pickStudent || !membersTarget) {
      setAddError(t('validation.selectStudent'))
      return
    }
    try {
      setAdding(true)
      setAddError('')
      const body: StudentProfileInput = {
        userId: Number(pickStudent.id),
        studentNo: pickNo.trim(),
        note: '',
      }
      await apiFetch(`/api/admin-classes/${membersTarget.id}/students`, {
        method: 'POST',
        token,
        body,
      })
      setPickStudent(null)
      setPickNo('')
      setStudentOptions([])
      await loadMembers(membersTarget.id)
    } catch (err) {
      setAddError((err as Error).message)
    } finally {
      setAdding(false)
    }
  }

  const openEditMember = (m: StudentProfileView) => {
    setEditMember({ userId: m.userId, studentNo: m.studentNo, note: m.note })
    setEditMemberError('')
  }

  const handleSaveMember = async () => {
    if (!editMember || !membersTarget) return
    try {
      setSavingMember(true)
      setEditMemberError('')
      const body: StudentProfileInput = {
        userId: editMember.userId,
        studentNo: editMember.studentNo.trim(),
        note: editMember.note.trim(),
      }
      await apiFetch(`/api/admin-classes/${membersTarget.id}/students/${editMember.userId}`, {
        method: 'PUT',
        token,
        body,
      })
      setEditMember(null)
      await loadMembers(membersTarget.id)
    } catch (err) {
      setEditMemberError((err as Error).message)
    } finally {
      setSavingMember(false)
    }
  }

  const openRemoveMember = (m: StudentProfileView) => {
    setRemoveMember(m)
    setRemoveError('')
  }

  const handleRemoveMember = async () => {
    if (!removeMember || !membersTarget) return
    try {
      setRemoving(true)
      setRemoveError('')
      await apiFetch(`/api/admin-classes/${membersTarget.id}/students/${removeMember.userId}`, {
        method: 'DELETE',
        token,
      })
      setRemoveMember(null)
      await loadMembers(membersTarget.id)
    } catch (err) {
      setRemoveError((err as Error).message)
    } finally {
      setRemoving(false)
    }
  }

  const validate = (form: typeof emptyForm) => {
    if (!form.grade.trim()) return t('validation.gradeRequired')
    if (!/^20\d{2}$/.test(form.grade.trim())) return t('validation.gradeFormat')
    if (!form.name.trim()) return t('validation.nameRequired')
    return ''
  }

  const buildBody = (form: typeof emptyForm): AdminClassInput => ({
    grade: form.grade.trim(),
    name: form.name.trim(),
    note: form.note.trim(),
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
      await apiFetch('/api/admin-classes', { method: 'POST', token, body: buildBody(createForm) })
      setCreateOpen(false)
      setCreateForm(emptyForm)
      list.reload()
    } catch (err) {
      setCreateError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const openEdit = (c: AdminClass) => {
    setEditTarget(c)
    setEditForm({ grade: c.grade, name: c.name, note: c.note })
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
      await apiFetch(`/api/admin-classes/${editTarget.id}`, { method: 'PUT', token, body: buildBody(editForm) })
      setEditTarget(null)
      list.reload()
    } catch (err) {
      setEditError((err as Error).message)
    } finally {
      setEditing(false)
    }
  }

  const openDelete = (c: AdminClass) => {
    setDeleteTarget(c)
    setDeleteError('')
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      setDeleting(true)
      setDeleteError('')
      await apiFetch(`/api/admin-classes/${deleteTarget.id}`, { method: 'DELETE', token })
      setDeleteTarget(null)
      list.reload()
    } catch (err) {
      setDeleteError((err as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  const columns: TableColumnsType<AdminClass> = [
    { title: t('field.id'), dataIndex: 'id', width: 72 },
    {
      title: t('field.grade'),
      dataIndex: 'grade',
      width: 110,
      render: (value: string) => value || '-',
    },
    {
      title: t('field.name'),
      dataIndex: 'name',
      width: 180,
      render: (value: string) => value || '-',
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

  const canAdmin = canManage || canRoster
  if (canAdmin) {
    columns.push({
      title: t('field.actions'),
      key: 'actions',
      width: 120,
      render: (_, c) => (
        <div className="admin-classes-page__actions">
          {canManage && (
            <>
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
            </>
          )}
          {canRoster && (
            <Button type="text" size="small" onClick={() => openMembers(c)}>
              {t('field.members')}
            </Button>
          )}
        </div>
      ),
    })
  }

  const memberColumns: TableColumnsType<StudentProfileView> = [
    { title: t('memberTable.name'), dataIndex: 'displayName' },
    { title: t('memberTable.username'), dataIndex: 'username' },
    {
      title: t('memberTable.studentNo'),
      dataIndex: 'studentNo',
      render: (value: string) => value || '-',
    },
  ]

  if (canRosterManage) {
    memberColumns.push({
      title: t('memberTable.actions'),
      key: 'actions',
      width: 140,
      render: (_, m) => (
        <div className="admin-classes-page__actions">
          <Button type="text" size="small" onClick={() => openEditMember(m)}>
            {t('memberTable.edit')}
          </Button>
          <Button type="text" size="small" onClick={() => openRemoveMember(m)}>
            {t('memberTable.remove')}
          </Button>
        </div>
      ),
    })
  }

  return (
    <div className="admin-classes-page">
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
      <h1 className="admin-classes-page__heading">{t('title')}</h1>
      <p className="admin-classes-page__subtitle">{t('subtitle')}</p>

      {error && (
        <Alert
          type="error"
          showIcon
          title={t('error.load')}
          description={error}
          className="admin-classes-page__notice"
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
          path="/api/admin-classes/export"
          fallbackName="admin-classes.xlsx"
          onError={setExportError}
        />
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            {t('addButton')}
          </Button>
        )}
      </div>

      <Table<AdminClass>
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={list.items}
        loading={loading}
        pagination={false}
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
        <div className="admin-classes-page__form">
          <Field label={t('form.grade')} htmlFor="ac-grade">
            <Input
              id="ac-grade"
              placeholder={t('placeholder.grade')}
              value={createForm.grade}
              onChange={(e) => setCreateForm({ ...createForm, grade: e.target.value })}
            />
          </Field>
          <Field label={t('form.name')} htmlFor="ac-name">
            <Input
              id="ac-name"
              placeholder={t('placeholder.name')}
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
            />
          </Field>
          <Field label={t('form.note')} htmlFor="ac-note">
            <Input
              id="ac-note"
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
        <div className="admin-classes-page__form">
          <Field label={t('form.grade')} htmlFor="ac-edit-grade">
            <Input
              id="ac-edit-grade"
              value={editForm.grade}
              onChange={(e) => setEditForm({ ...editForm, grade: e.target.value })}
            />
          </Field>
          <Field label={t('form.name')} htmlFor="ac-edit-name">
            <Input
              id="ac-edit-name"
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            />
          </Field>
          <Field label={t('form.note')} htmlFor="ac-edit-note">
            <Input
              id="ac-edit-note"
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
        <p className="admin-classes-page__confirm-text">
          {t('deleteConfirm', { name: deleteTarget?.name })}
        </p>
        {deleteError && <Alert type="error" showIcon title={t('error.delete')} description={deleteError} />}
      </Modal>

      {/* Members (学生档案): attendance-gated roster of one admin class. */}
      <Modal
        open={Boolean(membersTarget)}
        title={t('modal.members', { name: membersTarget?.name ?? '' })}
        okText={t('modal.membersSubmit')}
        cancelText={null}
        onCancel={() => {
          setMembersTarget(null)
          setEditMember(null)
          setRemoveMember(null)
        }}
        onOk={() => setMembersTarget(null)}
        width={720}
        destroyOnHidden
      >
        <div className="admin-classes-page__form">
          <p className="admin-classes-page__subtitle">{t('membersSubtitle')}</p>
          {canRosterManage && (
            <div className="admin-classes-page__member-add">
              <Field label={t('memberAdd.title')} htmlFor="member-pick">
                <Select
                  id="member-pick"
                  showSearch
                  allowClear
                  filterOption={false}
                  placeholder={t('memberAdd.placeholder')}
                  value={pickStudent?.id}
                  options={studentOptions.map((o) => ({ value: o.id, label: o.text }))}
                  onSearch={searchStudents}
                  onChange={(value?: string) => {
                    setPickStudent(studentOptions.find((o) => o.id === value) ?? null)
                    if (!value) searchStudents('')
                  }}
                />
              </Field>
              <Field label={t('memberAdd.studentNoLabel')} htmlFor="member-no">
                <Input
                  id="member-no"
                  placeholder={t('placeholder.studentNo')}
                  value={pickNo}
                  onChange={(e) => setPickNo(e.target.value)}
                />
              </Field>
              <Button onClick={handleAddMember} disabled={adding || !pickStudent}>
                {adding ? t('memberAdd.buttonLoading') : t('memberAdd.button')}
              </Button>
              {addError && <Alert type="error" showIcon title={t('error.addMember')} description={addError} />}
            </div>
          )}
          {membersError && <Alert type="error" showIcon title={t('error.load')} description={membersError} />}
          {membersLoading ? (
            <p>{t('empty.loading')}</p>
          ) : members.length === 0 ? (
            <p>
              {t('empty.members')}
              {canRosterManage ? t('empty.membersHint') : ''}
            </p>
          ) : (
            <Table<StudentProfileView>
              rowKey="userId"
              size="small"
              pagination={false}
              columns={memberColumns}
              dataSource={members}
              title={() => (
                <span className="admin-classes-page__members-title">
                  {t('memberTable.description', { count: members.length })}
                </span>
              )}
            />
          )}
        </div>
      </Modal>

      {/* Edit member metadata */}
      <Modal
        open={Boolean(editMember)}
        title={t('modal.editMember')}
        okText={t('modal.editMemberSubmit')}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={() => setEditMember(null)}
        onOk={handleSaveMember}
        confirmLoading={savingMember}
        destroyOnHidden
      >
        <div className="admin-classes-page__form">
          <Field label={t('memberEditForm.studentNo')} htmlFor="member-edit-no">
            <Input
              id="member-edit-no"
              value={editMember?.studentNo ?? ''}
              onChange={(e) => setEditMember(editMember ? { ...editMember, studentNo: e.target.value } : null)}
            />
          </Field>
          <Field label={t('memberEditForm.note')} htmlFor="member-edit-note">
            <Input
              id="member-edit-note"
              value={editMember?.note ?? ''}
              onChange={(e) => setEditMember(editMember ? { ...editMember, note: e.target.value } : null)}
            />
          </Field>
          {editMemberError && (
            <Alert type="error" showIcon title={t('error.saveMember')} description={editMemberError} />
          )}
        </div>
      </Modal>

      {/* Remove member */}
      <Modal
        open={Boolean(removeMember)}
        title={t('modal.removeMember')}
        okText={t('modal.removeMemberSubmit')}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={() => setRemoveMember(null)}
        onOk={handleRemoveMember}
        confirmLoading={removing}
        okButtonProps={{ danger: true }}
        destroyOnHidden
      >
        <p className="admin-classes-page__confirm-text">
          {t('removeMemberConfirm', { name: removeMember?.displayName })}
        </p>
        {removeError && <Alert type="error" showIcon title={t('error.removeMember')} description={removeError} />}
      </Modal>
    </div>
  )
}
