import { useCallback, useEffect, useState } from 'react'
import { Alert, Breadcrumb, Button, Select } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../auth/api'
import ExportButton from '../components/ExportButton'
import SessionFormModal from '../components/SessionFormModal'
import TimetableGrid from '../components/TimetableGrid'
import Field from '../ui/Field'
import { addDays, fmt, mondayOf } from '../utils/date'
import type { Classroom, OfferingView, Paged, SessionView, TimetableDay } from '../types/api'

// Cell target: which grid cell the session dialog is for, with its existing
// session (if the cell is occupied). A free cell creates a session prefilled
// with the clicked date/period/classroom; an occupied cell edits that session.
interface CellTarget {
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

  // One dialog for both create and edit: the shared SessionFormModal carries
  // the timetable picker ("pick from timetable"), which is the whole point of
  // editing a session here - the grid click already knows the date/period, and
  // the picker covers moving it to another slot/classroom.
  const [cell, setCell] = useState<CellTarget | null>(null)

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
    setCell({ date, periodIndex, session })
  }

  // Passed to the dialog only for managers: the delete action renders when
  // both the target session and this callback exist.
  const removeSession = async (session: SessionView) => {
    await apiFetch(`/api/sessions/${session.id}`, { method: 'DELETE', token })
    await fetchTimetable()
  }

  return (
    <div className="courses-page">
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

      <SessionFormModal
        open={Boolean(cell)}
        target={cell?.session ?? null}
        defaults={{
          classroomId,
          date: cell?.date,
          periodStart: cell ? String(cell.periodIndex) : undefined,
          periodEnd: cell ? String(cell.periodIndex) : undefined,
        }}
        offerings={offerings}
        classrooms={classrooms}
        onSuccess={() => {
          void fetchTimetable()
        }}
        onClose={() => setCell(null)}
        onDelete={canManage ? removeSession : undefined}
      />
    </div>
  )
}
