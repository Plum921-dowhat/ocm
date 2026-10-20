import { useCallback, useEffect, useState } from 'react'
import { Alert, Breadcrumb, Button, Input, Modal, Select, DatePicker } from 'antd'
import { DeleteOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../auth/api'
import ExportButton from '../components/ExportButton'
import TimetableGrid from '../components/TimetableGrid'
import Field from '../ui/Field'
import { addDays, fmt, mondayOf } from '../utils/date'
import type { Classroom, OfferingView, Paged, SessionInput, SessionView, TimetableDay } from '../types/api'

// Cell modal state: which grid cell is open, with its existing session (if
// the cell is occupied).
interface CellModal {
  date: string
  periodIndex: number
  session?: SessionView
}

export default function TimetablePage() {
  const { t } = useTranslation('timetable')
  const { token, can } = useAuth()
  const navigate = useNavigate()
  const canManage = can('course:manage')

  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [offerings, setOfferings] = useState<OfferingView[]>([])
  const [classroomId, setClassroomId] = useState('')
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const [days, setDays] = useState<TimetableDay[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [modal, setModal] = useState<CellModal | null>(null)
  const [form, setForm] = useState({ offeringId: '', classroomId: '', date: '', periodStart: '', periodEnd: '', note: '' })
  const [modalError, setModalError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // Dropdowns need (near-)full lists; pull the maximum page and unwrap the
    // pagination envelope.
    Promise.all([
      apiFetch<Paged<Classroom>>('/api/classrooms?page_size=500', { token }),
      apiFetch<Paged<OfferingView>>('/api/offerings?page_size=500', { token }),
    ])
      .then(([cls, offs]) => {
        setClassrooms(Array.isArray(cls?.items) ? cls.items : [])
        setOfferings(Array.isArray(offs?.items) ? offs.items : [])
      })
      .catch((err: Error) => setError(err.message))
  }, [token])

  const from = fmt(weekStart)
  const to = fmt(addDays(weekStart, 6))

  const fetchTimetable = useCallback(async () => {
    if (!classroomId) return
    try {
      setLoading(true)
      setError('')
      const data = await apiFetch<TimetableDay[]>(`/api/timetable?classroom_id=${classroomId}&from=${from}&to=${to}`, { token })
      setDays(Array.isArray(data) ? data : [])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [classroomId, from, to, token])

  useEffect(() => {
    fetchTimetable()
  }, [fetchTimetable])

  const openCell = (date: string, periodIndex: number, session?: SessionView) => {
    setModal({ date, periodIndex, session })
    setForm({
      offeringId: session ? String(session.offeringId) : '',
      classroomId: String(classroomId),
      date,
      periodStart: String(session ? session.periodStart : periodIndex),
      periodEnd: String(session ? session.periodEnd : periodIndex),
      note: session ? session.note : '',
    })
    setModalError('')
  }

  const submit = async () => {
    if (!form.offeringId) {
      setModalError(t('validation.selectOffering'))
      return
    }
    const periodStart = Number(form.periodStart)
    const periodEnd = form.periodEnd ? Number(form.periodEnd) : periodStart
    if (!periodStart || periodStart < 1 || periodEnd < periodStart) {
      setModalError(t('validation.periodRange'))
      return
    }
    const body: SessionInput = {
      offeringId: Number(form.offeringId),
      classroomId: Number(form.classroomId),
      date: form.date,
      periodStart,
      periodEnd,
      note: form.note.trim(),
    }
    try {
      setSaving(true)
      setModalError('')
      if (modal?.session) {
        await apiFetch(`/api/sessions/${modal.session.id}`, { method: 'PUT', token, body })
      } else {
        await apiFetch('/api/sessions', { method: 'POST', token, body })
      }
      setModal(null)
      await fetchTimetable()
    } catch (err) {
      setModalError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!modal?.session) return
    try {
      setSaving(true)
      setModalError('')
      await apiFetch(`/api/sessions/${modal.session.id}`, { method: 'DELETE', token })
      setModal(null)
      await fetchTimetable()
    } catch (err) {
      setModalError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

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

      <div className="timetable__controls">
        <Field label={t('filter.classroom')} htmlFor="tt-classroom" className="timetable__select">
          <Select
            id="tt-classroom"
            value={classroomId}
            onChange={(value: string) => setClassroomId(value)}
            options={[
              { value: '', label: t('filter.selectClassroom') },
              ...classrooms.map((c) => ({
                value: String(c.id),
                label: c.building ? t('filter.classroomOption', { name: c.name, building: c.building }) : c.name,
              })),
            ]}
          />
        </Field>
        <div className="timetable__week">
          <Button
            type="text"
            size="small"
            icon={<LeftOutlined />}
            aria-label={t('weekNav.prev')}
            onClick={() => setWeekStart(addDays(weekStart, -7))}
          />
          <span className="timetable__week-label">
            {from} ~ {to}
          </span>
          <Button
            type="text"
            size="small"
            icon={<RightOutlined />}
            aria-label={t('weekNav.next')}
            onClick={() => setWeekStart(addDays(weekStart, 7))}
          />
        </div>
        <ExportButton
          path={`/api/timetable/export?classroom_id=${classroomId}&from=${from}&to=${to}`}
          fallbackName={t('export.filename')}
          label={t('export.label')}
          onError={setError}
          disabled={!classroomId}
        />
      </div>

      {!classroomId ? (
        <p>{t('empty.selectClassroom')}</p>
      ) : loading ? (
        <p>{t('empty.loading')}</p>
      ) : days.length === 0 ? (
        <p>{t('empty.none')}</p>
      ) : (
        <TimetableGrid days={days} interactive={canManage} onCellClick={openCell} />
      )}

      {/* Session add/edit modal */}
      <Modal
        open={Boolean(modal)}
        title={modal?.session ? t('modal.edit') : t('modal.create')}
        okText={t('modal.submit')}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={() => setModal(null)}
        onOk={submit}
        confirmLoading={saving}
        destroyOnHidden
      >
        <div className="courses-page__form">
          <Field label={t('form.offering')} htmlFor="s-offering">
            <Select
              id="s-offering"
              value={form.offeringId}
              onChange={(value: string) => setForm({ ...form, offeringId: value })}
              options={[
                { value: '', label: t('form.selectOffering') },
                ...offerings.map((o) => ({
                  value: String(o.id),
                  label: t('form.offeringOption', {
                    catalogName: o.catalogName,
                    teachingClassName: o.teachingClassName,
                    semester: o.semester,
                  }),
                })),
              ]}
            />
          </Field>
          <Field label={t('form.classroom')} htmlFor="s-classroom">
            <Select
              id="s-classroom"
              value={form.classroomId}
              onChange={(value: string) => setForm({ ...form, classroomId: value })}
              options={classrooms.map((c) => ({ value: String(c.id), label: c.name }))}
            />
          </Field>
          <Field label={t('form.date')} htmlFor="s-date">
            <DatePicker
              id="s-date"
              allowClear={false}
              value={form.date ? dayjs(form.date) : null}
              onChange={(d) => setForm({ ...form, date: d ? d.format('YYYY-MM-DD') : '' })}
            />
          </Field>
          <Field label={t('form.periodStart')} htmlFor="s-period-start">
            <Input
              id="s-period-start"
              type="number"
              min="1"
              value={form.periodStart}
              onChange={(e) => setForm({ ...form, periodStart: e.target.value })}
            />
          </Field>
          <Field label={t('form.periodEnd')} htmlFor="s-period-end">
            <Input
              id="s-period-end"
              type="number"
              min="1"
              value={form.periodEnd}
              onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
            />
          </Field>
          <Field label={t('form.note')} htmlFor="s-note">
            <Input
              id="s-note"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </Field>
          {modalError && (
            <Alert type="error" showIcon title={t('error.save')} description={modalError} />
          )}
        </div>
        {modal?.session && canManage && (
          <Button
            danger
            size="small"
            icon={<DeleteOutlined />}
            onClick={remove}
            disabled={saving}
            className="timetable__delete"
          >
            {t('modal.remove')}
          </Button>
        )}
      </Modal>
    </div>
  )
}
