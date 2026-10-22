import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Breadcrumb,
  Button,
  Checkbox,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Table,
  Tag,
  type TableColumnsType,
  DatePicker
} from 'antd'
import { CheckOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch, apiDownload } from '../auth/api'
import ListPagination from '../components/ListPagination'
import usePagedList from '../hooks/usePagedList'
import Field from '../ui/Field'
import type { Classroom, ObservationInput, ObservationView, OfferingView, Paged, Period, Regime } from '../types/api'

const STATUS_COLOR: Record<string, string> = { draft: 'default', submitted: 'green' }

// ---------------------------------------------------------------------------
// Local types for the Python-derived template schema (schema.json) served by
// GET /api/observations/templates. The docx renderer is not wired yet, so Go
// is not the source of truth — these stay hand-mirrored here. NOTE: backend
// schema uses snake_case keys (score_groups / line_indexes), NOT camelCase.
// ---------------------------------------------------------------------------

interface RatingOption {
  value: string
  label: string
}

interface ScoreGroup {
  key: string
  line_indexes?: number[]
}

interface Indicator {
  key: string
  title: string
  lines?: string[]
  score_groups?: ScoreGroup[]
}

interface HeaderExtra {
  key: string
  label: string
  options?: string[]
}

interface CommentField {
  key: string
  label: string
  placeholder?: string
  max_length?: number
}

interface ExtraField {
  key: string
  label: string
  options?: string[]
  detail_key?: string
  detail_placeholder?: string
  detail_limit?: { max_length?: number }
  detail_required_when?: string
}

interface StudentFeedbackSchema {
  columns?: string[]
  questions?: Array<{ key: string; title: string; options?: RatingOption[] }>
}

interface TemplateEntry {
  value: string
  label: string
  indicators?: Indicator[]
  header_extras?: HeaderExtra[]
  header_extra_section_title?: string
  score_label?: string
  content_label?: string
  content_limit?: { max_length?: number }
  comment_fields?: CommentField[]
  extras?: ExtraField[]
  extra_section_title?: string
  post_content_comment_fields?: CommentField[]
  post_content_comment_title?: string
  student_feedback?: StudentFeedbackSchema
}

interface TemplateSchema {
  templates?: TemplateEntry[]
  rating_options?: RatingOption[]
}

// indicatorScoreGroups mirrors the backend: an explicit score_groups list wins,
// otherwise a single group keyed by the indicator key.
function indicatorScoreGroups(ind: Indicator): Array<{ key: string; lines: string[] }> {
  if (ind.score_groups && ind.score_groups.length) {
    return ind.score_groups.map((g) => ({
      key: g.key,
      lines: (g.line_indexes || []).map((i) => ind.lines?.[i]).filter((l): l is string => Boolean(l)),
    }))
  }
  return [{ key: ind.key, lines: ind.lines || [] }]
}

function fmtScore(v: number | null | undefined): string {
  if (v === null || v === undefined || (v as unknown) === '') return '—'
  return String(v)
}

// Form meta: ids/dates stay strings while editing (converted on submit).
interface MetaState {
  templateType: string
  courseId: string
  classroomId: string
  observeDate: string
  sections: number[]
  isAnonymous: boolean
}

const emptyMeta: MetaState = { templateType: '', courseId: '', classroomId: '', observeDate: '', sections: [], isAnonymous: false }

// Dynamic form data written into the observation's opaque formData JSON. The
// shape is driven by the selected template's schema (see TemplateEntry).
interface FormDataState {
  indicatorScores: Record<string, string>
  totalScore: string
  contentOutline: string
  comments: Record<string, string>
  extraValues: Record<string, string>
  extraDetails: Record<string, string>
  studentFeedback: Record<string, Record<string, string>>
}

const emptyFormData: FormDataState = {
  indicatorScores: {},
  totalScore: '',
  contentOutline: '',
  comments: {},
  extraValues: {},
  extraDetails: {},
  studentFeedback: {},
}

// The wire payload: the generated ObservationInput keeps formData opaque
// (Record<string, never>), so refine it with the page's dynamic shape.
type ObservationPayload = Omit<ObservationInput, 'formData'> & {
  formData: {
    indicatorScores: Record<string, string>
    totalScore: number | null
    contentOutline: string
    comments: Record<string, string>
    extraValues: Record<string, string>
    extraDetails: Record<string, string>
    studentFeedback: Record<string, Record<string, string>>
  }
}

export default function ObservationsPage() {
  const { t, i18n } = useTranslation('observations')
  const { token, user: currentUser, can } = useAuth()
  const navigate = useNavigate()
  const canWrite = can('observation:write')
  const canManage = can('observation:manage')

  // Static reference data: form schema, course offerings, classrooms, periods.
  const [schema, setSchema] = useState<TemplateSchema | null>(null)
  const [offerings, setOfferings] = useState<OfferingView[]>([])
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  const [schemaError, setSchemaError] = useState('')

  const [filterStatus, setFilterStatus] = useState('')
  const [filterTemplate, setFilterTemplate] = useState('')

  const list = usePagedList<ObservationView>({
    path: '/api/observations',
    token,
    extraParams: { status: filterStatus, template_type: filterTemplate },
  })
  const { loading } = list
  const [actionError, setActionError] = useState('')
  const error = list.error || actionError || schemaError

  // Form modal state.
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [meta, setMeta] = useState<MetaState>(emptyMeta)
  const [formData, setFormData] = useState<FormDataState>(emptyFormData)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [actingId, setActingId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ObservationView | null>(null)

  useEffect(() => {
    Promise.all([
      apiFetch<TemplateSchema>('/api/observations/templates', { token }),
      apiFetch<Paged<OfferingView>>('/api/offerings?page_size=500', { token }),
      apiFetch<Paged<Classroom>>('/api/classrooms?page_size=500', { token }),
    ])
      .then(([sch, off, clr]) => {
        setSchema(sch)
        setOfferings(Array.isArray(off?.items) ? off.items : [])
        setClassrooms(Array.isArray(clr?.items) ? clr.items : [])
      })
      .catch((err: Error) => setSchemaError(err.message))
  }, [token])

  useEffect(() => {
    if (!meta.observeDate) {
      setPeriods([])
      return
    }
    let cancelled = false
    apiFetch<Regime>(`/api/schedule/active?date=${meta.observeDate}`, { token })
      .then((regime) => {
        if (cancelled) return
        setPeriods((regime?.periods || []).slice().sort((a, b) => a.periodIndex - b.periodIndex))
      })
      .catch(() => {
        if (!cancelled) setPeriods([])
      })
    return () => {
      cancelled = true
    }
  }, [meta.observeDate, token])

  const selectedTemplate = useMemo(() => {
    if (!schema || !meta.templateType) return null
    return schema.templates?.find((tpl) => tpl.value === meta.templateType) || null
  }, [schema, meta.templateType])

  const templateLabel = (value: string) => t('templateType.' + value, { defaultValue: value || '' })

  const sectionsLabel = (sections: number[]) => {
    if (!sections || !sections.length) return '—'
    const sorted = sections.slice().sort((a, b) => a - b)
    const listFmt = new Intl.ListFormat(i18n.language || 'zh-CN', { style: 'narrow' })
    return t('sectionsLabel', { sections: listFmt.format(sorted.map(String)) })
  }

  const openCreate = () => {
    setEditId(null)
    setMeta(emptyMeta)
    setFormData(emptyFormData)
    setFormError('')
    setFormOpen(true)
  }

  const openEdit = async (row: ObservationView) => {
    try {
      setFormError('')
      setActionError('')
      const v = await apiFetch<ObservationView>(`/api/observations/${row.id}`, { token })
      const fd = (v.formData ?? {}) as Partial<FormDataState>
      setEditId(row.id)
      setMeta({
        templateType: v.templateType || '',
        courseId: v.courseId ? String(v.courseId) : '',
        classroomId: v.classroomId ? String(v.classroomId) : '',
        observeDate: v.observeDate || '',
        sections: Array.isArray(v.sections) ? v.sections : [],
        isAnonymous: Boolean(v.isAnonymous),
      })
      setFormData({
        indicatorScores: fd.indicatorScores || {},
        totalScore: v.totalScore != null ? String(v.totalScore) : '',
        contentOutline: fd.contentOutline || v.content || '',
        comments: fd.comments || {},
        extraValues: fd.extraValues || {},
        extraDetails: fd.extraDetails || {},
        studentFeedback: fd.studentFeedback || {},
      })
      setFormOpen(true)
    } catch (err) {
      setActionError((err as Error).message)
    }
  }

  const buildPayload = (): ObservationPayload => ({
    templateType: meta.templateType,
    courseId: Number(meta.courseId),
    // Undefined drops the key on JSON.stringify — the Go side decodes the
    // missing/null key as a nil pointer either way.
    classroomId: meta.classroomId ? Number(meta.classroomId) : undefined,
    observeDate: meta.observeDate,
    sections: meta.sections.map(Number).sort((a, b) => a - b),
    isAnonymous: meta.isAnonymous,
    formData: {
      indicatorScores: formData.indicatorScores,
      totalScore: formData.totalScore === '' || formData.totalScore === null ? null : Number(formData.totalScore),
      contentOutline: formData.contentOutline,
      comments: formData.comments,
      extraValues: formData.extraValues,
      extraDetails: formData.extraDetails,
      studentFeedback: formData.studentFeedback,
    },
  })

  const handleSave = async () => {
    if (!meta.templateType) return setFormError(t('validation.templateRequired'))
    if (!meta.courseId) return setFormError(t('validation.courseRequired'))
    if (!meta.classroomId) return setFormError(t('validation.classroomRequired'))
    if (!meta.observeDate) return setFormError(t('validation.dateRequired'))
    try {
      setSaving(true)
      setFormError('')
      const payload = buildPayload()
      if (editId) {
        await apiFetch(`/api/observations/${editId}`, { method: 'PUT', token, body: payload })
      } else {
        await apiFetch('/api/observations', { method: 'POST', token, body: payload })
      }
      setFormOpen(false)
      list.reload()
    } catch (err) {
      setFormError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const submitObservation = async (row: ObservationView) => {
    try {
      setActingId(row.id)
      setActionError('')
      await apiFetch(`/api/observations/${row.id}/submit`, { method: 'POST', token })
      list.reload()
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setActingId(null)
    }
  }

  const exportObservation = async (row: ObservationView) => {
    try {
      setActingId(row.id)
      setActionError('')
      await apiDownload(`/api/observations/${row.id}/export`, {
        token,
        method: 'POST',
        fallbackName: `observation-${row.id}.docx`,
      })
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setActingId(null)
    }
  }

  const deleteObservation = async () => {
    const id = deleteTarget?.id
    if (!id) return
    try {
      setActingId(id)
      setActionError('')
      await apiFetch(`/api/observations/${id}`, { method: 'DELETE', token })
      setDeleteTarget(null)
      list.reload()
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setActingId(null)
    }
  }

  const setIndicatorScore = (key: string, val: string) =>
    setFormData((f) => ({ ...f, indicatorScores: { ...f.indicatorScores, [key]: val } }))
  const setComment = (key: string, val: string) =>
    setFormData((f) => ({ ...f, comments: { ...f.comments, [key]: val } }))
  const setExtraValue = (key: string, val: string) =>
    setFormData((f) => ({ ...f, extraValues: { ...f.extraValues, [key]: val } }))
  const setExtraDetail = (key: string, val: string) =>
    setFormData((f) => ({ ...f, extraDetails: { ...f.extraDetails, [key]: val } }))
  const setStudentAnswer = (qKey: string, student: string, val: string) =>
    setFormData((f) => ({
      ...f,
      studentFeedback: { ...f.studentFeedback, [qKey]: { ...(f.studentFeedback[qKey] || {}), [student]: val } },
    }))

  const toggleSection = (idx: number, checked: boolean) =>
    setMeta((m) => ({
      ...m,
      sections: checked ? [...m.sections, idx].sort((a, b) => a - b) : m.sections.filter((s) => s !== idx),
    }))

  const ratingOptions = schema?.rating_options || []

  const columns: TableColumnsType<ObservationView> = [
    { title: t('field.courseName'), dataIndex: 'courseName', width: 140 },
    { title: t('field.teacher'), dataIndex: 'teacher', width: 90 },
    { title: t('field.teachingClassName'), dataIndex: 'teachingClassName', width: 130 },
    { title: t('field.observeDate'), dataIndex: 'observeDate', width: 100 },
    {
      title: t('field.sections'),
      dataIndex: 'sections',
      width: 110,
      render: (value: number[]) => sectionsLabel(value),
    },
    {
      title: t('field.templateType'),
      dataIndex: 'templateType',
      width: 100,
      render: (value: string) => templateLabel(value),
    },
    {
      title: t('field.totalScore'),
      dataIndex: 'totalScore',
      width: 70,
      render: (value: number | null | undefined) => fmtScore(value),
    },
    {
      title: t('field.status'),
      dataIndex: 'status',
      width: 90,
      render: (value: string) => (
        <Tag color={STATUS_COLOR[value] ?? 'default'}>
          {t('status.' + value, { ns: 'common', defaultValue: value })}
        </Tag>
      ),
    },
    {
      title: t('field.actions'),
      key: 'actions',
      width: 300,
      fixed: 'right',
      render: (_, o) => {
        const isDraft = o.status === 'draft'
        const own = Number(currentUser?.id) === o.observerId
        const canEdit = isDraft && (canManage || own)
        const canSubmit = isDraft && (canManage || own)
        const canDelete = isDraft && (canManage || own)
        const canExport = o.status === 'submitted' && (canManage || own)
        if (!canEdit && !canSubmit && !canExport && !canDelete) {
          return <span className="observations-page__muted">—</span>
        }
        return (
          <div className="observations-page__actions">
            {canEdit && (
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={() => openEdit(o)}
                disabled={actingId === o.id}
              >
                {t('action.edit', { ns: 'common' })}
              </Button>
            )}
            {canSubmit && (
              <Button
                type="text"
                size="small"
                icon={<CheckOutlined />}
                onClick={() => submitObservation(o)}
                disabled={actingId === o.id}
              >
                {t('action.submit', { ns: 'common' })}
              </Button>
            )}
            {canExport && (
              <Button
                type="text"
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => exportObservation(o)}
                disabled={actingId === o.id}
              >
                {t('action.export', { ns: 'common' })}
              </Button>
            )}
            {canDelete && (
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => setDeleteTarget(o)}
                disabled={actingId === o.id}
              >
                {t('action.delete', { ns: 'common' })}
              </Button>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div className="observations-page">
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
      <h1 className="observations-page__heading">{t('title')}</h1>
      <p className="observations-page__subtitle">{t('subtitle')}</p>

      {error && (
        <Alert
          type="error"
          showIcon
          title={t('error.action')}
          description={error}
          className="observations-page__notice"
        />
      )}

      <div className="bookings-page__filters">
        <Field label={t('filter.status')} htmlFor="f-status" className="bookings-page__filter">
          <Select
            id="f-status"
            value={filterStatus}
            onChange={(value: string) => setFilterStatus(value)}
            options={[
              { value: '', label: t('filter.allStatuses') },
              { value: 'draft', label: t('status.draft', { ns: 'common' }) },
              { value: 'submitted', label: t('status.submitted', { ns: 'common' }) },
            ]}
          />
        </Field>
        <Field label={t('filter.template')} htmlFor="f-template" className="bookings-page__filter">
          <Select
            id="f-template"
            value={filterTemplate}
            onChange={(value: string) => setFilterTemplate(value)}
            options={[
              { value: '', label: t('filter.allTemplates') },
              ...(schema?.templates || []).map((tpl) => ({ value: tpl.value, label: tpl.label })),
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
        {canWrite && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            {t('table.addButton')}
          </Button>
        )}
      </div>

      <Table<ObservationView>
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={list.items}
        loading={loading}
        pagination={false}
        scroll={{ x: 1135 }}
        locale={{ emptyText: list.q ? t('empty.search') : t('empty.none') }}
      />

      <ListPagination
        page={list.page}
        pageSize={list.pageSize}
        totalItems={list.total}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
      />

      {/* Create / edit form */}
      <Modal
        open={formOpen}
        width={900}
        title={editId ? t('modal.editHeading') : t('modal.createHeading')}
        okText={t('action.save', { ns: 'common' })}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={() => setFormOpen(false)}
        onOk={handleSave}
        confirmLoading={saving}
        destroyOnHidden
        className="observations-page__form-modal"
      >
        <div className="observations-page__form">
          {/* 基础信息 */}
          <div className="observations-page__section">
            <h3 className="observations-page__section-title">{t('section.basic')}</h3>
            <Field label={t('form.templateType')} htmlFor="o-template">
              <Select
                id="o-template"
                value={meta.templateType}
                onChange={(value: string) => {
                  setMeta({ ...meta, templateType: value })
                  setFormData(emptyFormData)
                }}
                options={[
                  { value: '', label: t('form.templatePlaceholder') },
                  ...(schema?.templates || []).map((tpl) => ({ value: tpl.value, label: tpl.label })),
                ]}
              />
            </Field>
            <Field label={t('form.course')} htmlFor="o-course">
              <Select
                id="o-course"
                value={meta.courseId}
                onChange={(value: string) => setMeta({ ...meta, courseId: value })}
                options={[
                  { value: '', label: t('form.coursePlaceholder') },
                  ...offerings.map((o) => ({
                    value: String(o.id),
                    label: t('courseOption', {
                      catalogName: o.catalogName,
                      teachingClass: o.teachingClassName,
                      teacher: o.teacher,
                    }),
                  })),
                ]}
              />
            </Field>
            <Field label={t('form.classroom')} htmlFor="o-classroom">
              <Select
                id="o-classroom"
                value={meta.classroomId}
                onChange={(value: string) => setMeta({ ...meta, classroomId: value })}
                options={[
                  { value: '', label: t('form.classroomPlaceholder') },
                  ...classrooms.map((c) => ({
                    value: String(c.id),
                    label: c.building ? `${c.building} ${c.name}` : c.name,
                  })),
                ]}
              />
            </Field>
            <Field label={t('form.observeDate')} htmlFor="o-date">
              <DatePicker
                id="o-date"
                allowClear={false}
                value={meta.observeDate ? dayjs(meta.observeDate) : null}
                onChange={(d) => setMeta({ ...meta, observeDate: d ? d.format('YYYY-MM-DD') : '' })}
              />
            </Field>
            {periods.length > 0 && (
              <fieldset className="observations-page__sections">
                <legend className="observations-page__legend">{t('form.sectionsLegend')}</legend>
                {periods.map((p) => (
                  <Checkbox
                    key={p.periodIndex}
                    id={`o-sec-${p.periodIndex}`}
                    checked={meta.sections.includes(p.periodIndex)}
                    onChange={(e) => toggleSection(p.periodIndex, e.target.checked)}
                  >
                    {t('periodOption', { index: p.periodIndex, start: p.startTime, end: p.endTime })}
                  </Checkbox>
                ))}
              </fieldset>
            )}
            <Checkbox
              id="o-anon"
              checked={meta.isAnonymous}
              onChange={(e) => setMeta({ ...meta, isAnonymous: e.target.checked })}
            >
              {t('form.anonymous')}
            </Checkbox>
          </div>

          {selectedTemplate && (
            <>
              {/* 评分指标 */}
              {selectedTemplate.indicators && selectedTemplate.indicators.length > 0 && (
                <div className="observations-page__section">
                  <h3 className="observations-page__section-title">{t('section.indicators')}</h3>
                  {selectedTemplate.indicators.map((ind) =>
                    indicatorScoreGroups(ind).map((g) => (
                      <div key={g.key} className="observations-page__indicator">
                        <div className="observations-page__indicator-head">
                          <span className="observations-page__indicator-title">{ind.title}</span>
                        </div>
                        {g.lines.map((line, i) => (
                          <p key={i} className="observations-page__indicator-line">
                            {line}
                          </p>
                        ))}
                        <Field label={t('form.ratingLegend')}>
                          <Radio.Group
                            value={formData.indicatorScores[g.key] || ''}
                            onChange={(e) => setIndicatorScore(g.key, String(e.target.value))}
                            options={ratingOptions.map((r) => ({ value: r.value, label: r.label }))}
                          />
                        </Field>
                      </div>
                    )),
                  )}
                </div>
              )}

              {/* header extras（radio，如年龄层次/班级规模） */}
              {selectedTemplate.header_extras && selectedTemplate.header_extras.length > 0 && (
                <div className="observations-page__section">
                  <h3 className="observations-page__section-title">{selectedTemplate.header_extra_section_title || t('sectionFallback.headerExtra')}</h3>
                  {selectedTemplate.header_extras.map((ex) => (
                    <Field key={ex.key} label={ex.label}>
                      <Radio.Group
                        value={formData.extraValues[ex.key] || ''}
                        onChange={(e) => setExtraValue(ex.key, String(e.target.value))}
                        options={(ex.options || []).map((opt) => ({ value: opt, label: opt }))}
                      />
                    </Field>
                  ))}
                </div>
              )}

              {/* 总分 + 授课内容 */}
              <div className="observations-page__section">
                <h3 className="observations-page__section-title">{t('section.conclusion')}</h3>
                <Field label={selectedTemplate.score_label || t('form.scoreLabelFallback')} htmlFor="o-score">
                  <InputNumber
                    id="o-score"
                    min={0}
                    max={100}
                    value={formData.totalScore === '' ? null : Number(formData.totalScore)}
                    onChange={(value) =>
                      setFormData((f) => ({ ...f, totalScore: value == null ? '' : String(value) }))
                    }
                  />
                </Field>
                <Field
                  label={selectedTemplate.content_label || t('form.contentLabelFallback')}
                  htmlFor="o-content"
                >
                  <Input.TextArea
                    id="o-content"
                    placeholder={t('form.contentPlaceholder', { label: selectedTemplate.content_label || t('form.contentLabelFallback'), max: selectedTemplate.content_limit?.max_length || '' })}
                    value={formData.contentOutline}
                    onChange={(e) => setFormData((f) => ({ ...f, contentOutline: e.target.value }))}
                    maxLength={selectedTemplate.content_limit?.max_length || undefined}
                    rows={4}
                  />
                </Field>
              </div>

              {/* 评语 */}
              {selectedTemplate.comment_fields && selectedTemplate.comment_fields.length > 0 && (
                <div className="observations-page__section">
                  <h3 className="observations-page__section-title">{t('section.comments')}</h3>
                  {selectedTemplate.comment_fields.map((cf) => (
                    <Field key={cf.key} label={cf.label} htmlFor={`c-${cf.key}`}>
                      <Input.TextArea
                        id={`c-${cf.key}`}
                        placeholder={cf.placeholder}
                        value={formData.comments[cf.key] || ''}
                        onChange={(e) => setComment(cf.key, e.target.value)}
                        maxLength={cf.max_length || undefined}
                        rows={3}
                      />
                    </Field>
                  ))}
                </div>
              )}

              {/* extras（radio_with_detail） */}
              {selectedTemplate.extras && selectedTemplate.extras.length > 0 && (
                <div className="observations-page__section">
                  <h3 className="observations-page__section-title">{selectedTemplate.extra_section_title || t('sectionFallback.extra')}</h3>
                  {selectedTemplate.extras.map((ex) => {
                    const detailVisible =
                      ex.detail_required_when === undefined ||
                      formData.extraValues[ex.key] === ex.detail_required_when ||
                      formData.extraValues[ex.key] === ''
                    return (
                      <div key={ex.key} className="observations-page__extra">
                        <Field label={ex.label}>
                          <Radio.Group
                            value={formData.extraValues[ex.key] || ''}
                            onChange={(e) => setExtraValue(ex.key, String(e.target.value))}
                            options={(ex.options || []).map((opt) => ({ value: opt, label: opt }))}
                          />
                        </Field>
                        {ex.detail_key && detailVisible && (
                          <Field
                            label={t('form.extraDetailLabel', { label: ex.label })}
                            htmlFor={`exd-${ex.detail_key}`}
                          >
                            <Input.TextArea
                              id={`exd-${ex.detail_key}`}
                              placeholder={ex.detail_placeholder}
                              value={formData.extraDetails[ex.detail_key] || ''}
                              onChange={(e) => setExtraDetail(ex.detail_key ?? '', e.target.value)}
                              maxLength={ex.detail_limit?.max_length || undefined}
                              rows={3}
                            />
                          </Field>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* post_content_comment_fields（教室条件/听课笔记） */}
              {selectedTemplate.post_content_comment_fields && selectedTemplate.post_content_comment_fields.length > 0 && (
                <div className="observations-page__section">
                  <h3 className="observations-page__section-title">
                    {selectedTemplate.post_content_comment_title || t('sectionFallback.postContent')}
                  </h3>
                  {selectedTemplate.post_content_comment_fields.map((cf) => (
                    <Field key={cf.key} label={cf.label} htmlFor={`pc-${cf.key}`}>
                      <Input.TextArea
                        id={`pc-${cf.key}`}
                        placeholder={cf.placeholder}
                        value={formData.comments[cf.key] || ''}
                        onChange={(e) => setComment(cf.key, e.target.value)}
                        maxLength={cf.max_length || undefined}
                        rows={3}
                      />
                    </Field>
                  ))}
                </div>
              )}

              {/* 学生反馈矩阵 */}
              {selectedTemplate.student_feedback && (
                <div className="observations-page__section">
                  <h3 className="observations-page__section-title">{t('section.studentFeedback')}</h3>
                  <div className="observations-page__matrix">
                    <table className="observations-page__matrix-table">
                      <thead>
                        <tr>
                          <th>{t('form.studentFeedbackHeader')}</th>
                          {(selectedTemplate.student_feedback.columns || []).map((col) => (
                            <th key={col}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(selectedTemplate.student_feedback.questions || []).map((q) => (
                          <tr key={q.key}>
                            <td className="observations-page__matrix-question">{q.title}</td>
                            {(selectedTemplate.student_feedback?.columns || []).map((col) => (
                              <td key={col}>
                                <Select
                                  id={`sf-${q.key}-${col}`}
                                  value={formData.studentFeedback[q.key]?.[col] || ''}
                                  onChange={(value: string) => setStudentAnswer(q.key, col, value)}
                                  options={[
                                    { value: '', label: t('form.dash') },
                                    ...(q.options || []).map((opt) => ({ value: opt.value, label: opt.label })),
                                  ]}
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {formError && (
            <Alert type="error" showIcon title={t('error.save')} description={formError} />
          )}
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={Boolean(deleteTarget)}
        title={t('modal.deleteHeading')}
        okText={t('modal.deleteSubmit')}
        cancelText={t('action.back', { ns: 'common' })}
        onCancel={() => setDeleteTarget(null)}
        onOk={deleteObservation}
        confirmLoading={actingId === deleteTarget?.id}
        okButtonProps={{ danger: true }}
        destroyOnHidden
      >
        <p className="observations-page__confirm-text">
          {t('modal.deleteConfirm', { course: deleteTarget?.courseName, date: deleteTarget?.observeDate })}
        </p>
      </Modal>
    </div>
  )
}
