import { useEffect, useState } from 'react'
import { Alert, Button, Input, Modal, Select, DatePicker } from 'antd'
import { CalendarOutlined, DeleteOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../auth/api'
import Field from '../ui/Field'
import TimetablePickerModal, { type TimetablePick } from './TimetablePickerModal'
import type { Classroom, OfferingView, SessionInput, SessionView } from '../types/api'

export interface SessionFormModalProps {
  open: boolean
  /** Session being edited, or null for create mode. */
  target: SessionView | null
  /** Preselected offering for create mode (e.g. from an L2 expanded row). Not locked - the user may change it. */
  defaultOfferingId?: string
  /**
   * Create-mode prefill from a clicked timetable cell: the grid already knows
   * the date/period/classroom the user aimed at, so the form opens on those
   * values instead of empty inputs. Ignored when `target` is set (edit mode
   * reads everything from the session).
   */
  defaults?: SessionFormDefaults
  offerings: OfferingView[]
  classrooms: Classroom[]
  /**
   * Reports the mutated offering plus the pre-edit offering when an edit moved
   * the session to a different offering, so callers can refresh every affected
   * cache (expanded-row caches and the sessions tab list).
   */
  onSuccess: (offeringId: number, prevOfferingId?: number) => void
  onClose: () => void
  /**
   * When provided, edit mode shows a delete action for the target session.
   * Errors thrown here are surfaced inline; the dialog stays open.
   */
  onDelete?: (target: SessionView) => void | Promise<void>
}

/** Create-mode prefill coming from a timetable grid cell. */
export interface SessionFormDefaults {
  classroomId?: string
  date?: string
  periodStart?: string
  periodEnd?: string
}

// Form state keeps ids/numbers as strings while editing; converted on submit.
interface SessionForm {
  offeringId: string
  classroomId: string
  date: string
  periodStart: string
  periodEnd: string
  note: string
}

const emptyForm: SessionForm = { offeringId: '', classroomId: '', date: '', periodStart: '', periodEnd: '', note: '' }

// SessionFormModal is the shared create/edit dialog for course sessions (L3),
// used by both the sessions tab and the offerings table's expanded rows. The
// frontend validates only presence and period ordering; period legality and
// classroom conflicts are enforced by the backend (400/409), whose message is
// shown inline while keeping the modal open - same layering as TimetablePage.
export default function SessionFormModal({
  open,
  target,
  defaultOfferingId,
  defaults,
  offerings,
  classrooms,
  onSuccess,
  onClose,
  onDelete,
}: SessionFormModalProps) {
  const { t } = useTranslation('courses')
  const { token } = useAuth()
  const [form, setForm] = useState<SessionForm>(emptyForm)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  // Unwrap the prefill into scalars: callers build `defaults` inline, so the
  // object identity changes on every render and would retrigger the reset
  // effect (wiping whatever the user is typing).
  const defaultClassroomId = defaults?.classroomId
  const defaultDate = defaults?.date
  const defaultPeriodStart = defaults?.periodStart
  const defaultPeriodEnd = defaults?.periodEnd
  // Timetable picker layered on top of this dialog: picking a free cell
  // backfills classroom/date/periods here for review before submitting.
  // While it is open this form's Modal is closed: two stacked modals keep two
  // focus traps alive, and the lower one yanks focus back on every focus move
  // into the picker (a native <select> dropdown then closes instantly). Form
  // state lives here, not in the Modal children, so closing the Modal loses
  // nothing.
  const [pickerOpen, setPickerOpen] = useState(false)

  // (Re)initialize from the edit target / default offering each time the
  // dialog opens, mirroring how the page-level modals reset their forms.
  useEffect(() => {
    if (!open) return
    setForm(
      target
        ? {
            offeringId: String(target.offeringId),
            classroomId: String(target.classroomId),
            date: target.date,
            periodStart: String(target.periodStart),
            periodEnd: String(target.periodEnd),
            note: target.note,
          }
        : {
            ...emptyForm,
            offeringId: defaultOfferingId ?? '',
            classroomId: defaultClassroomId ?? '',
            date: defaultDate ?? '',
            periodStart: defaultPeriodStart ?? '',
            periodEnd: defaultPeriodEnd ?? '',
          },
    )
    setError('')
  }, [open, target, defaultOfferingId, defaultClassroomId, defaultDate, defaultPeriodStart, defaultPeriodEnd])

  const submit = async () => {
    if (!form.offeringId) {
      setError(t('sessionForm.selectOffering'))
      return
    }
    if (!form.classroomId) {
      setError(t('sessionForm.selectClassroom'))
      return
    }
    if (!form.date) {
      setError(t('sessionForm.dateRequired'))
      return
    }
    const periodStart = Number(form.periodStart)
    const periodEnd = form.periodEnd ? Number(form.periodEnd) : periodStart
    if (!periodStart || periodStart < 1 || periodEnd < periodStart) {
      setError(t('sessionForm.periodRange'))
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
      setError('')
      if (target) {
        await apiFetch(`/api/sessions/${target.id}`, { method: 'PUT', token, body })
      } else {
        await apiFetch('/api/sessions', { method: 'POST', token, body })
      }
      const offeringId = Number(form.offeringId)
      onSuccess(offeringId, target && target.offeringId !== offeringId ? target.offeringId : undefined)
      onClose()
    } catch (err) {
      // 409 classroom conflict / 400 invalid period: keep the dialog open and
      // surface the backend message.
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // Delete lives in this dialog only when the caller passes onDelete (the
  // timetable page provides it so a clicked session can be removed in place).
  // The caller owns the request; failures surface inline and keep the dialog
  // open, same as submit.
  const handleDelete = async () => {
    if (!target || !onDelete) return
    try {
      setSaving(true)
      setError('')
      await onDelete(target)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // Backfill a selection from the timetable picker: the classroom and the
  // full period range (which may differ from the session's current length)
  // come from the dragged cells. Everything stays editable below - the pick
  // is only a proposal until the form is submitted.
  const applyPick = ({ classroomId, date, periodStart, periodEnd }: TimetablePick) => {
    setForm((f) => ({ ...f, classroomId, date, periodStart: String(periodStart), periodEnd: String(periodEnd) }))
    setPickerOpen(false)
  }

  return (
    <>
      {/* open && !pickerOpen: see the pickerOpen comment above. */}
      <Modal
        open={open && !pickerOpen}
        title={target ? t('sessionModal.edit', { date: target.date }) : t('sessionModal.create')}
        okText={t('modal.editSubmit')}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={onClose}
        onOk={submit}
        confirmLoading={saving}
        destroyOnHidden
      >
        <div className="courses-page__form">
          <Field label={t('sessionForm.offering')} htmlFor="session-form-offering">
            <Select
              id="session-form-offering"
              placeholder={t('sessionForm.selectOffering')}
              value={form.offeringId || undefined}
              onChange={(value: string) => setForm({ ...form, offeringId: value })}
              options={offerings.map((o) => ({
                value: String(o.id),
                label: [o.catalogName, o.teachingClassName, o.teacher].filter(Boolean).join(' / '),
              }))}
            />
          </Field>
          <Field label={t('sessionForm.classroom')} htmlFor="session-form-classroom">
            <Select
              id="session-form-classroom"
              placeholder={t('sessionForm.selectClassroom')}
              value={form.classroomId || undefined}
              onChange={(value: string) => setForm({ ...form, classroomId: value })}
              options={classrooms.map((c) => ({ value: String(c.id), label: c.name }))}
            />
          </Field>
          <Button
            size="small"
            icon={<CalendarOutlined />}
            className="session-form__pick"
            onClick={() => setPickerOpen(true)}
            disabled={classrooms.length === 0}
          >
            {t('sessionForm.pickFromTimetable')}
          </Button>
          <Field label={t('sessionForm.date')} htmlFor="session-form-date">
            <DatePicker
              id="session-form-date"
              allowClear={false}
              value={form.date ? dayjs(form.date) : null}
              onChange={(d) => setForm({ ...form, date: d ? d.format('YYYY-MM-DD') : '' })}
            />
          </Field>
          <Field label={t('sessionForm.periodStart')} htmlFor="session-form-period-start">
            <Input
              id="session-form-period-start"
              type="number"
              min={1}
              value={form.periodStart}
              onChange={(e) => setForm({ ...form, periodStart: e.target.value })}
            />
          </Field>
          <Field label={t('sessionForm.periodEnd')} htmlFor="session-form-period-end" hint={t('sessionForm.periodHint')}>
            <Input
              id="session-form-period-end"
              type="number"
              min={1}
              value={form.periodEnd}
              onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
            />
          </Field>
          <Field label={t('sessionForm.note')} htmlFor="session-form-note">
            <Input
              id="session-form-note"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </Field>
          {error && <Alert type="error" showIcon title={t('error.save')} description={error} />}
        </div>
        {target && onDelete && (
          <Button
            danger
            size="small"
            icon={<DeleteOutlined />}
            onClick={handleDelete}
            disabled={saving}
            className="session-form__delete"
          >
            {t('sessionModal.remove')}
          </Button>
        )}
      </Modal>
      <TimetablePickerModal
        open={pickerOpen}
        classrooms={classrooms}
        initialClassroomId={form.classroomId}
        initialDate={form.date}
        targetSession={target}
        onClose={() => setPickerOpen(false)}
        onPick={applyPick}
      />
    </>
  )
}
