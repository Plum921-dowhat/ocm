import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Breadcrumb,
  Button,
  Input,
  Modal,
  Select,
  Table,
  Tabs,
  type TableColumnsType,
} from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../auth/api'
import ExportButton from '../components/ExportButton'
import ListPagination from '../components/ListPagination'
import SessionsMiniTable, { type SessionsCacheEntry } from '../components/SessionsMiniTable'
import SessionsPanel from '../components/SessionsPanel'
import usePagedList from '../hooks/usePagedList'
import Field from '../ui/Field'
import type {
  CatalogCourse,
  CatalogInput,
  Classroom,
  OfferingInput,
  OfferingView,
  Paged,
  SessionView,
  TeachingClassView,
} from '../types/api'

// Form state keeps ids/numbers as strings while editing; converted on submit.
interface OfferingForm {
  catalogId: string
  teachingClassId: string
  teacher: string
  semester: string
  note: string
}

const emptyOffering: OfferingForm = { catalogId: '', teachingClassId: '', teacher: '', semester: '', note: '' }
const emptyCatalog = { name: '', code: '', description: '' }

// Delete target: which tab's row (discriminated for URL + confirm text).
type DeleteTarget =
  | { kind: 'offering'; row: OfferingView }
  | { kind: 'catalog'; row: CatalogCourse }

export default function CourseManagementPage() {
  const { t, i18n } = useTranslation('courses')
  const { token, can } = useAuth()
  const navigate = useNavigate()
  const canManage = can('course:manage')

  const offerings = usePagedList<OfferingView>({ path: '/api/offerings', token })
  const catalogList = usePagedList<CatalogCourse>({ path: '/api/courses', token })
  // Dropdown options for the offering modal need (near-)full lists; pull the
  // maximum page. optionsKey re-triggers the fetch after catalog mutations.
  const [catalogOptions, setCatalogOptions] = useState<CatalogCourse[]>([])
  const [teachingClasses, setTeachingClasses] = useState<TeachingClassView[]>([])
  // Dropdown options for the session modal and the sessions tab (near-full lists).
  const [offeringOptions, setOfferingOptions] = useState<OfferingView[]>([])
  const [classroomOptions, setClassroomOptions] = useState<Classroom[]>([])
  const [optionsKey, setOptionsKey] = useState(0)
  // L3 sessions: per-offering cache backing the offerings table's expanded rows.
  const [sessionsCache, setSessionsCache] = useState<Record<string, SessionsCacheEntry>>({})
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  // Controlled tabs so an expanded row's "view all" link can jump to the
  // sessions tab with the offering filter pre-applied.
  const [tabKey, setTabKey] = useState('offerings')
  const [pendingSessionsFilter, setPendingSessionsFilter] = useState<string | null>(null)
  // Export errors are separate from the list fetches (the hooks own theirs).
  const [exportError, setExportError] = useState('')
  const error = offerings.error || catalogList.error || exportError

  // offering modals
  const [offCreateOpen, setOffCreateOpen] = useState(false)
  const [offForm, setOffForm] = useState<OfferingForm>(emptyOffering)
  const [offError, setOffError] = useState('')
  const [offSaving, setOffSaving] = useState(false)
  const [offEditTarget, setOffEditTarget] = useState<OfferingView | null>(null)

  // catalog modals
  const [catCreateOpen, setCatCreateOpen] = useState(false)
  const [catForm, setCatForm] = useState(emptyCatalog)
  const [catError, setCatError] = useState('')
  const [catSaving, setCatSaving] = useState(false)
  const [catEditTarget, setCatEditTarget] = useState<CatalogCourse | null>(null)

  // delete (shared)
  const [delTarget, setDelTarget] = useState<DeleteTarget | null>(null)
  const [delError, setDelError] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetch<Paged<CatalogCourse>>('/api/courses?page_size=500', { token }),
      apiFetch<Paged<TeachingClassView>>('/api/teaching-classes?page_size=500', { token }),
      apiFetch<Paged<OfferingView>>('/api/offerings?page_size=500', { token }),
      apiFetch<Paged<Classroom>>('/api/classrooms?page_size=500', { token }),
    ])
      .then(([cats, tcs, offs, cls]) => {
        if (cancelled) return
        setCatalogOptions(Array.isArray(cats?.items) ? cats.items : [])
        setTeachingClasses(Array.isArray(tcs?.items) ? tcs.items : [])
        setOfferingOptions(Array.isArray(offs?.items) ? offs.items : [])
        setClassroomOptions(Array.isArray(cls?.items) ? cls.items : [])
      })
      .catch(() => {
        if (!cancelled) {
          setCatalogOptions([])
          setTeachingClasses([])
          setOfferingOptions([])
          setClassroomOptions([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [token, optionsKey])

  // ---- offering handlers ----
  const submitOffering = async () => {
    if (!offForm.catalogId || !offForm.teachingClassId || !offForm.teacher.trim() || !offForm.semester.trim()) {
      setOffError(t('validation.offeringRequired'))
      return
    }
    // OfferingInput is a whole-object replace: keep the untouched fields of
    // the edit target (or zeros on create) so they are not reset.
    const base: OfferingInput = offEditTarget
      ? {
          catalogId: offEditTarget.catalogId,
          college: offEditTarget.college,
          courseSeq: offEditTarget.courseSeq,
          maxStudents: offEditTarget.maxStudents,
          note: offEditTarget.note,
          requirement: offEditTarget.requirement,
          semester: offEditTarget.semester,
          teacher: offEditTarget.teacher,
          teacherId: offEditTarget.teacherId,
          teacherTitle: offEditTarget.teacherTitle,
          teachingClassId: offEditTarget.teachingClassId,
          weeklyHours: offEditTarget.weeklyHours,
        }
      : {
          catalogId: 0,
          college: '',
          courseSeq: '',
          maxStudents: 0,
          note: '',
          requirement: '',
          semester: '',
          teacher: '',
          teacherId: '',
          teacherTitle: '',
          teachingClassId: 0,
          weeklyHours: 0,
        }
    const body: OfferingInput = {
      ...base,
      catalogId: Number(offForm.catalogId),
      teachingClassId: Number(offForm.teachingClassId),
      teacher: offForm.teacher.trim(),
      semester: offForm.semester.trim(),
      note: offForm.note.trim(),
    }
    try {
      setOffSaving(true)
      setOffError('')
      if (offEditTarget) {
        await apiFetch(`/api/offerings/${offEditTarget.id}`, { method: 'PUT', token, body })
      } else {
        await apiFetch('/api/offerings', { method: 'POST', token, body })
      }
      setOffCreateOpen(false)
      setOffEditTarget(null)
      offerings.reload()
    } catch (err) {
      setOffError((err as Error).message)
    } finally {
      setOffSaving(false)
    }
  }

  const openEditOffering = (o: OfferingView) => {
    setOffEditTarget(o)
    setOffForm({
      catalogId: String(o.catalogId),
      teachingClassId: String(o.teachingClassId),
      teacher: o.teacher,
      semester: o.semester,
      note: o.note,
    })
    setOffError('')
    setOffCreateOpen(true)
  }

  // ---- catalog handlers ----
  const submitCatalog = async () => {
    if (!catForm.name.trim()) {
      setCatError(t('validation.catalogNameRequired'))
      return
    }
    // CatalogInput is a whole-object replace: keep the edit target's other
    // fields (category/credits/examType/totalHours) intact.
    const body: CatalogInput = catEditTarget
      ? {
          category: catEditTarget.category,
          code: catEditTarget.code,
          credits: catEditTarget.credits,
          description: catEditTarget.description,
          examType: catEditTarget.examType,
          name: catEditTarget.name,
          totalHours: catEditTarget.totalHours,
        }
      : { category: '', code: '', credits: 0, description: '', examType: '', name: '', totalHours: 0 }
    body.name = catForm.name.trim()
    body.code = catForm.code.trim()
    body.description = catForm.description.trim()
    try {
      setCatSaving(true)
      setCatError('')
      if (catEditTarget) {
        await apiFetch(`/api/courses/${catEditTarget.id}`, { method: 'PUT', token, body })
      } else {
        await apiFetch('/api/courses', { method: 'POST', token, body })
      }
      setCatCreateOpen(false)
      setCatEditTarget(null)
      catalogList.reload()
      setOptionsKey((k) => k + 1) // keep the modal's course dropdown in sync
    } catch (err) {
      setCatError((err as Error).message)
    } finally {
      setCatSaving(false)
    }
  }

  const openEditCatalog = (c: CatalogCourse) => {
    setCatEditTarget(c)
    setCatForm({ name: c.name, code: c.code, description: c.description })
    setCatError('')
    setCatCreateOpen(true)
  }

  // ---- delete ----
  const handleDelete = async () => {
    if (!delTarget) return
    const url = delTarget.kind === 'offering' ? `/api/offerings/${delTarget.row.id}` : `/api/courses/${delTarget.row.id}`
    try {
      setDeleting(true)
      setDelError('')
      await apiFetch(url, { method: 'DELETE', token })
      const kind = delTarget.kind
      setDelTarget(null)
      if (kind === 'offering') {
        offerings.reload()
      } else {
        catalogList.reload()
        setOptionsKey((k) => k + 1)
      }
    } catch (err) {
      setDelError((err as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  // ---- L3 sessions: expanded rows + cache ----

  // Fetch one offering's sessions into the cache (page_size=500 covers a
  // semester's ~60-90 sessions). Existing data stays visible while reloading.
  const loadSessions = useCallback(
    async (offeringId: string) => {
      setSessionsCache((prev) => ({
        ...prev,
        [offeringId]: { data: prev[offeringId]?.data ?? [], loading: true, error: '' },
      }))
      try {
        const data = await apiFetch<Paged<SessionView>>(`/api/sessions?offering_id=${offeringId}&page_size=500`, { token })
        setSessionsCache((prev) => ({
          ...prev,
          [offeringId]: { data: Array.isArray(data?.items) ? data.items : [], loading: false, error: '' },
        }))
      } catch (err) {
        setSessionsCache((prev) => ({
          ...prev,
          [offeringId]: { data: [], loading: false, error: (err as Error).message },
        }))
      }
    },
    [token],
  )

  // Toggling an un-cached row kicks off its lazy fetch; cached rows re-expand
  // without another request. Multiple rows may be expanded at once.
  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    if (!sessionsCache[id]) void loadSessions(id)
  }

  // Session mutations (from the expanded rows or the sessions tab) refresh the
  // cache of every affected offering, keeping the two views in sync.
  const refreshSessionsCache = (offeringId?: number, prevOfferingId?: number) => {
    for (const id of [offeringId, prevOfferingId]) {
      if (id && sessionsCache[String(id)]) void loadSessions(String(id))
    }
  }

  // A new page/search/page-size means new rows: drop expansions but keep the
  // cache so paging back re-expands without another request.
  useEffect(() => {
    setExpandedIds(new Set())
  }, [offerings.page, offerings.q, offerings.pageSize])

  // "View all" from an expanded row: switch to the sessions tab pre-filtered.
  const viewAllSessions = (offeringId: number) => {
    setPendingSessionsFilter(String(offeringId))
    setTabKey('sessions')
  }

  // classNames column joins admin-class names with a locale-appropriate
  // separator (zh: "、", en: ", ") via Intl.ListFormat narrow style.
  const listFmt = new Intl.ListFormat(i18n.language, { style: 'narrow' })

  const actionButtons = (
    onEdit: () => void,
    onDelete: () => void,
  ) => (
    <div className="courses-page__actions">
      <Button
        type="text"
        size="small"
        aria-label={t('action.edit', { ns: 'common' })}
        icon={<EditOutlined />}
        onClick={onEdit}
      />
      <Button
        type="text"
        size="small"
        danger
        aria-label={t('action.delete', { ns: 'common' })}
        icon={<DeleteOutlined />}
        onClick={onDelete}
      />
    </div>
  )

  const catalogColumns: TableColumnsType<CatalogCourse> = [
    { title: t('catalogField.id'), dataIndex: 'id', width: 72 },
    { title: t('catalogField.name'), dataIndex: 'name', width: 200 },
    { title: t('catalogField.code'), dataIndex: 'code', width: 140 },
    {
      title: t('catalogField.description'),
      dataIndex: 'description',
      ellipsis: true,
      render: (value: string) => value || '-',
    },
  ]

  if (canManage) {
    catalogColumns.push({
      title: t('field.actions'),
      key: 'actions',
      width: 108,
      render: (_, c) =>
        actionButtons(
          () => openEditCatalog(c),
          () => setDelTarget({ kind: 'catalog', row: c }),
        ),
    })
  }

  const offeringColumns: TableColumnsType<OfferingView> = [
    { title: t('offeringField.id'), dataIndex: 'id', width: 72 },
    { title: t('offeringField.catalogName'), dataIndex: 'catalogName', width: 180, render: (v: string) => v || '-' },
    { title: t('offeringField.catalogCode'), dataIndex: 'catalogCode', width: 110, render: (v: string) => v || '-' },
    {
      title: t('offeringField.teachingClassName'),
      dataIndex: 'teachingClassName',
      width: 160,
      render: (v: string) => v || '-',
    },
    {
      title: t('offeringField.classNames'),
      dataIndex: 'classNames',
      width: 180,
      render: (value: string[]) => (Array.isArray(value) && value.length ? listFmt.format(value) : '-'),
    },
    { title: t('offeringField.teacher'), dataIndex: 'teacher', width: 110, render: (v: string) => v || '-' },
    { title: t('offeringField.semester'), dataIndex: 'semester', width: 110, render: (v: string) => v || '-' },
  ]

  if (canManage) {
    offeringColumns.push({
      title: t('field.actions'),
      key: 'actions',
      width: 108,
      render: (_, o) =>
        actionButtons(
          () => openEditOffering(o),
          () => setDelTarget({ kind: 'offering', row: o }),
        ),
    })
  }

  const tabItems = [
    {
      key: 'offerings',
      label: t('tabs.offerings'),
      children: (
        <>
          <div className="ds-table-toolbar">
            <span className="ds-table-toolbar__title">{t('table.offering.title')}</span>
            <span className="ds-table-toolbar__hint">{t('table.offering.description', { count: offerings.total })}</span>
            <Input
              allowClear
              className="ds-table-toolbar__search"
              placeholder={t('searchPlaceholder')}
              value={offerings.q}
              onChange={(e) => offerings.setQ(e.target.value)}
            />
            <ExportButton path="/api/offerings/export" fallbackName="offerings.xlsx" onError={setExportError} />
            {canManage && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setOffForm(emptyOffering)
                  setOffEditTarget(null)
                  setOffError('')
                  setOffCreateOpen(true)
                }}
              >
                {t('addButton.offering')}
              </Button>
            )}
          </div>
          <Table<OfferingView>
            // String keys everywhere: expandedRowKeys holds ids as strings
            // (Set<string>), and Ant Design only matches a row against
            // expandedRowKeys with an identity comparison - a numeric row key
            // against "2" silently never expands.
            rowKey={(record) => String(record.id)}
            size="middle"
            columns={offeringColumns}
            dataSource={offerings.items}
            loading={offerings.loading}
            pagination={false}
            // Column widths sum to 1030 plus the ~48px expand column. 1080 is
            // the smallest min-width that still shows the Actions column on a
            // 1440-wide screen (content area ~1144) without horizontal scroll;
            // narrower screens scroll rather than clip.
            scroll={{ x: 1080 }}
            locale={{ emptyText: offerings.q ? t('empty.noResults', { ns: 'common' }) : t('empty.noData', { ns: 'common' }) }}
            expandable={{
              expandedRowKeys: Array.from(expandedIds),
              onExpand: (expanded, record) => {
                const id = String(record.id)
                if (expanded !== expandedIds.has(id)) toggleExpand(id)
              },
              expandedRowRender: (record) => (
                <SessionsMiniTable
                  offering={record}
                  entry={sessionsCache[String(record.id)] ?? { data: [], loading: false, error: '' }}
                  canManage={canManage}
                  offerings={offeringOptions}
                  classrooms={classroomOptions}
                  onMutated={refreshSessionsCache}
                  onReload={(oid) => void loadSessions(String(oid))}
                  onViewAll={viewAllSessions}
                />
              ),
            }}
          />
          <ListPagination
            page={offerings.page}
            pageSize={offerings.pageSize}
            totalItems={offerings.total}
            onPageChange={offerings.setPage}
            onPageSizeChange={offerings.setPageSize}
          />
        </>
      ),
    },
    {
      key: 'catalog',
      label: t('tabs.catalog'),
      children: (
        <>
          <div className="ds-table-toolbar">
            <span className="ds-table-toolbar__title">{t('table.catalog.title')}</span>
            <span className="ds-table-toolbar__hint">{t('table.catalog.description', { count: catalogList.total })}</span>
            <Input
              allowClear
              className="ds-table-toolbar__search"
              placeholder={t('searchPlaceholder')}
              value={catalogList.q}
              onChange={(e) => catalogList.setQ(e.target.value)}
            />
            <ExportButton path="/api/courses/export" fallbackName="catalog.xlsx" onError={setExportError} />
            {canManage && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setCatForm(emptyCatalog)
                  setCatEditTarget(null)
                  setCatError('')
                  setCatCreateOpen(true)
                }}
              >
                {t('addButton.catalog')}
              </Button>
            )}
          </div>
          <Table<CatalogCourse>
            rowKey="id"
            size="middle"
            columns={catalogColumns}
            dataSource={catalogList.items}
            loading={catalogList.loading}
            pagination={false}
            scroll={{ x: 800 }}
            locale={{
              emptyText: catalogList.q
                ? t('empty.noResults', { ns: 'common' })
                : t('empty.noData', { ns: 'common' }),
            }}
          />
          <ListPagination
            page={catalogList.page}
            pageSize={catalogList.pageSize}
            totalItems={catalogList.total}
            onPageChange={catalogList.setPage}
            onPageSizeChange={catalogList.setPageSize}
          />
        </>
      ),
    },
    {
      key: 'sessions',
      label: t('tabs.sessions'),
      children: (
        <SessionsPanel
          active={tabKey === 'sessions'}
          filterOfferingId={pendingSessionsFilter}
          onFilterConsumed={() => setPendingSessionsFilter(null)}
          onMutated={refreshSessionsCache}
          offerings={offeringOptions}
          classrooms={classroomOptions}
        />
      ),
    },
  ]

  return (
    <div className="courses-page">
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
      <h1 className="courses-page__heading">{t('title')}</h1>
      <p className="courses-page__subtitle">{t('subtitle')}</p>
      {error && (
        <Alert type="error" showIcon title={t('error.load')} description={error} className="courses-page__notice" />
      )}

      <Tabs activeKey={tabKey} onChange={setTabKey} items={tabItems} />

      {/* Offering create/edit modal */}
      <Modal
        open={offCreateOpen}
        title={offEditTarget ? t('modal.edit', { name: offEditTarget.catalogName }) : t('modal.offeringCreate')}
        okText={t('modal.editSubmit')}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={() => {
          setOffCreateOpen(false)
          setOffEditTarget(null)
        }}
        onOk={submitOffering}
        confirmLoading={offSaving}
        destroyOnHidden
      >
        <div className="courses-page__form">
          <Field label={t('offeringForm.catalog')} htmlFor="off-catalog">
            <Select
              id="off-catalog"
              placeholder={t('offeringForm.selectCatalog')}
              value={offForm.catalogId || undefined}
              onChange={(catalogId: string) => setOffForm({ ...offForm, catalogId })}
              optionFilterProp="label"
              showSearch
              options={catalogOptions.map((c) => ({
                value: String(c.id),
                label: c.code ? t('offeringForm.courseOption', { name: c.name, code: c.code }) : c.name,
              }))}
            />
          </Field>
          <Field label={t('offeringForm.teachingClass')} htmlFor="off-teaching-class">
            <Select
              id="off-teaching-class"
              placeholder={t('offeringForm.selectTeachingClass')}
              value={offForm.teachingClassId || undefined}
              onChange={(teachingClassId: string) => setOffForm({ ...offForm, teachingClassId })}
              optionFilterProp="label"
              showSearch
              options={teachingClasses.map((tc) => ({ value: String(tc.id), label: tc.name }))}
            />
          </Field>
          <Field label={t('offeringForm.teacher')} htmlFor="off-teacher">
            <Input
              id="off-teacher"
              value={offForm.teacher}
              onChange={(e) => setOffForm({ ...offForm, teacher: e.target.value })}
            />
          </Field>
          <Field label={t('offeringForm.semester')} htmlFor="off-semester">
            <Input
              id="off-semester"
              placeholder={t('offeringForm.semesterPlaceholder')}
              value={offForm.semester}
              onChange={(e) => setOffForm({ ...offForm, semester: e.target.value })}
            />
          </Field>
          <Field label={t('offeringForm.note')} htmlFor="off-note">
            <Input
              id="off-note"
              value={offForm.note}
              onChange={(e) => setOffForm({ ...offForm, note: e.target.value })}
            />
          </Field>
          {offError && <Alert type="error" showIcon title={t('error.save')} description={offError} />}
        </div>
      </Modal>

      {/* Catalog create/edit modal */}
      <Modal
        open={catCreateOpen}
        title={catEditTarget ? t('modal.edit', { name: catEditTarget.name }) : t('modal.catalogCreate')}
        okText={t('modal.editSubmit')}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={() => {
          setCatCreateOpen(false)
          setCatEditTarget(null)
        }}
        onOk={submitCatalog}
        confirmLoading={catSaving}
        destroyOnHidden
      >
        <div className="courses-page__form">
          <Field label={t('catalogForm.name')} htmlFor="cat-name">
            <Input
              id="cat-name"
              value={catForm.name}
              onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
            />
          </Field>
          <Field label={t('catalogForm.code')} htmlFor="cat-code">
            <Input
              id="cat-code"
              placeholder={t('catalogForm.codePlaceholder')}
              value={catForm.code}
              onChange={(e) => setCatForm({ ...catForm, code: e.target.value })}
            />
          </Field>
          <Field label={t('catalogForm.description')} htmlFor="cat-desc">
            <Input
              id="cat-desc"
              value={catForm.description}
              onChange={(e) => setCatForm({ ...catForm, description: e.target.value })}
            />
          </Field>
          {catError && <Alert type="error" showIcon title={t('error.save')} description={catError} />}
        </div>
      </Modal>

      {/* Delete modal */}
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
          {t(`deleteConfirm.${delTarget?.kind ?? 'offering'}`, {
            name: delTarget?.kind === 'offering' ? delTarget.row.catalogName : delTarget?.kind === 'catalog' ? delTarget.row.name : '',
          })}
        </p>
        {delError && <Alert type="error" showIcon title={t('error.delete')} description={delError} />}
      </Modal>
    </div>
  )
}
