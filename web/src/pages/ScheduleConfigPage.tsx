import { useState } from 'react'
import { Alert, Breadcrumb, Button, Card, Input, Modal, Select } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../auth/api'
import ExportButton from '../components/ExportButton'
import ListPagination from '../components/ListPagination'
import usePagedList from '../hooks/usePagedList'
import Field from '../ui/Field'
import type { PeriodInput, Regime, RegimeInput } from '../types/api'

// Regime form: the day field is a text input, so it holds a string while
// editing (converted on submit).
interface RegimeForm {
  name: string
  effectiveMonth: number
  effectiveDay: string
}

const emptyRegime: RegimeForm = { name: '', effectiveMonth: 5, effectiveDay: '1' }

// One editable period row in the periods modal: periodIndex stays a string
// while the number input is being edited (converted on submit).
interface PeriodRow {
  periodIndex: string
  startTime: string
  endTime: string
}

export default function ScheduleConfigPage() {
  const { t } = useTranslation('scheduleConfig')
  const { token, can } = useAuth()
  const navigate = useNavigate()
  const canManage = can('course:manage')

  const months = t('months', { returnObjects: true }) as string[]

  const list = usePagedList<Regime>({ path: '/api/schedule/regimes', token })
  const { loading } = list
  // Export errors are separate from the list fetch (the hook owns its error).
  const [exportError, setExportError] = useState('')
  const error = list.error || exportError

  const [regimeOpen, setRegimeOpen] = useState(false)
  const [regimeForm, setRegimeForm] = useState<RegimeForm>(emptyRegime)
  const [regimeEditId, setRegimeEditId] = useState<number | null>(null)
  const [regimeError, setRegimeError] = useState('')
  const [regimeSaving, setRegimeSaving] = useState(false)

  const [periodsTarget, setPeriodsTarget] = useState<Regime | null>(null) // regime being edited
  const [periodRows, setPeriodRows] = useState<PeriodRow[]>([])
  const [periodsError, setPeriodsError] = useState('')
  const [periodsSaving, setPeriodsSaving] = useState(false)

  const [delTarget, setDelTarget] = useState<Regime | null>(null)
  const [delError, setDelError] = useState('')
  const [deleting, setDeleting] = useState(false)

  const openCreateRegime = () => {
    setRegimeForm(emptyRegime)
    setRegimeEditId(null)
    setRegimeError('')
    setRegimeOpen(true)
  }

  const openEditRegime = (r: Regime) => {
    setRegimeForm({ name: r.name, effectiveMonth: r.effectiveMonth, effectiveDay: String(r.effectiveDay) })
    setRegimeEditId(r.id)
    setRegimeError('')
    setRegimeOpen(true)
  }

  const submitRegime = async () => {
    if (!regimeForm.name.trim()) {
      setRegimeError(t('validation.nameRequired'))
      return
    }
    const body: RegimeInput = {
      name: regimeForm.name.trim(),
      effectiveMonth: Number(regimeForm.effectiveMonth),
      effectiveDay: Number(regimeForm.effectiveDay),
    }
    try {
      setRegimeSaving(true)
      setRegimeError('')
      if (regimeEditId) {
        await apiFetch(`/api/schedule/regimes/${regimeEditId}`, { method: 'PUT', token, body })
      } else {
        await apiFetch('/api/schedule/regimes', { method: 'POST', token, body })
      }
      setRegimeOpen(false)
      list.reload()
    } catch (err) {
      setRegimeError((err as Error).message)
    } finally {
      setRegimeSaving(false)
    }
  }

  const openEditPeriods = (r: Regime) => {
    setPeriodsTarget(r)
    setPeriodRows(
      r.periods && r.periods.length
        ? r.periods.map((p) => ({ periodIndex: String(p.periodIndex), startTime: p.startTime, endTime: p.endTime }))
        : [{ periodIndex: '1', startTime: '08:00', endTime: '08:45' }],
    )
    setPeriodsError('')
  }

  const submitPeriods = async () => {
    if (!periodsTarget) return
    try {
      setPeriodsSaving(true)
      setPeriodsError('')
      const periods: PeriodInput[] = periodRows.map((p) => ({
        periodIndex: Number(p.periodIndex),
        startTime: p.startTime,
        endTime: p.endTime,
      }))
      await apiFetch(`/api/schedule/regimes/${periodsTarget.id}/periods`, {
        method: 'PUT',
        token,
        body: { periods },
      })
      setPeriodsTarget(null)
      list.reload()
    } catch (err) {
      setPeriodsError((err as Error).message)
    } finally {
      setPeriodsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!delTarget) return
    try {
      setDeleting(true)
      setDelError('')
      await apiFetch(`/api/schedule/regimes/${delTarget.id}`, { method: 'DELETE', token })
      setDelTarget(null)
      list.reload()
    } catch (err) {
      setDelError((err as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  const updateRow = (i: number, field: keyof PeriodRow, value: string) => {
    // Explicit per-field mapping keeps the row type concrete (a computed
    // [field] key would widen the object to a Partial).
    setPeriodRows((rows) =>
      rows.map((row, j) => {
        if (j !== i) return row
        if (field === 'periodIndex') return { ...row, periodIndex: value }
        if (field === 'startTime') return { ...row, startTime: value }
        return { ...row, endTime: value }
      }),
    )
  }

  return (
    <div className="courses-page">
      <div>
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
          <Alert
            type="error"
            showIcon
            title={t('error.load')}
            description={error}
            className="courses-page__notice"
          />
        )}
        <div className="courses-page__toolbar">
          {canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateRegime}>
              {t('addButton')}
            </Button>
          )}
          <ExportButton path="/api/schedule/regimes/export" fallbackName="regimes.xlsx" onError={setExportError} />
        </div>
      </div>

      <div>
        {loading ? (
          <p>{t('empty.loading')}</p>
        ) : list.items.length === 0 ? (
          <p>{t('empty.none')}</p>
        ) : (
          list.items.map((r) => (
            <Card key={r.id} size="small" className="schedule-regime">
              <div className="schedule-regime__head">
                <div>
                  <strong>{r.name}</strong>
                  <span className="schedule-regime__date">
                    {' '}
                    {t('effective', { month: r.effectiveMonth, day: r.effectiveDay })}
                  </span>
                </div>
                {canManage && (
                  <div className="schedule-regime__actions">
                    <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEditRegime(r)}>
                      {t('action.edit')}
                    </Button>
                    <Button type="text" size="small" onClick={() => openEditPeriods(r)}>
                      {t('action.editPeriods')}
                    </Button>
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined />}
                      aria-label={t('action.delete', { ns: 'common' })}
                      onClick={() => setDelTarget(r)}
                    />
                  </div>
                )}
              </div>
              {r.periods && r.periods.length > 0 ? (
                <table className="schedule-regime__periods">
                  <thead>
                    <tr>
                      <th>{t('periodForm.period')}</th>
                      <th>{t('periodForm.start')}</th>
                      <th>{t('periodForm.end')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.periods.map((p) => (
                      <tr key={p.id || p.periodIndex}>
                        <td>{t('periodLabel.single', { period: p.periodIndex })}</td>
                        <td>{p.startTime}</td>
                        <td>{p.endTime}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="schedule-regime__empty">{t('empty.noPeriods')}</p>
              )}
            </Card>
          ))
        )}
        <ListPagination
          page={list.page}
          pageSize={list.pageSize}
          totalItems={list.total}
          onPageChange={list.setPage}
          onPageSizeChange={list.setPageSize}
        />
      </div>

      {/* Regime create/edit modal */}
      <Modal
        open={regimeOpen}
        title={regimeEditId ? t('modal.regimeEdit') : t('modal.regimeCreate')}
        okText={t('modal.regimeSubmit')}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={() => setRegimeOpen(false)}
        onOk={submitRegime}
        confirmLoading={regimeSaving}
        destroyOnHidden
      >
        <div className="courses-page__form">
          <Field label={t('regimeForm.name')} htmlFor="regime-name">
            <Input
              id="regime-name"
              placeholder={t('regimeForm.namePlaceholder')}
              value={regimeForm.name}
              onChange={(e) => setRegimeForm({ ...regimeForm, name: e.target.value })}
            />
          </Field>
          <Field label={t('regimeForm.month')} htmlFor="regime-month">
            <Select
              id="regime-month"
              value={String(regimeForm.effectiveMonth)}
              onChange={(value) => setRegimeForm({ ...regimeForm, effectiveMonth: Number(value) })}
              options={months.map((m, i) => ({ value: String(i + 1), label: m }))}
            />
          </Field>
          <Field label={t('regimeForm.day')} htmlFor="regime-day">
            <Input
              id="regime-day"
              type="number"
              min={1}
              max={31}
              value={regimeForm.effectiveDay}
              onChange={(e) => setRegimeForm({ ...regimeForm, effectiveDay: e.target.value })}
            />
          </Field>
          {regimeError && (
            <Alert type="error" showIcon title={t('error.save')} description={regimeError} />
          )}
        </div>
      </Modal>

      {/* Periods edit modal */}
      <Modal
        open={Boolean(periodsTarget)}
        title={t('modal.periodsTitle', { name: periodsTarget?.name ?? '' })}
        okText={t('modal.periodsSubmit')}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={() => setPeriodsTarget(null)}
        onOk={submitPeriods}
        confirmLoading={periodsSaving}
        destroyOnHidden
        width={720}
      >
        <div className="courses-page__form">
          <p className="schedule-periods__hint">{t('periodsHint')}</p>
          {periodRows.map((row, i) => (
            <div key={i} className="schedule-periods__row">
              <Field label={t('periodForm.period')} htmlFor={`pi-${i}`}>
                <Input
                  id={`pi-${i}`}
                  type="number"
                  min={1}
                  value={row.periodIndex}
                  onChange={(e) => updateRow(i, 'periodIndex', e.target.value)}
                />
              </Field>
              <Field label={t('periodForm.start')} htmlFor={`st-${i}`}>
                <Input
                  id={`st-${i}`}
                  type="time"
                  value={row.startTime}
                  onChange={(e) => updateRow(i, 'startTime', e.target.value)}
                />
              </Field>
              <Field label={t('periodForm.end')} htmlFor={`et-${i}`}>
                <Input
                  id={`et-${i}`}
                  type="time"
                  value={row.endTime}
                  onChange={(e) => updateRow(i, 'endTime', e.target.value)}
                />
              </Field>
              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                aria-label={t('periodForm.removePeriod')}
                onClick={() => setPeriodRows(periodRows.filter((_, j) => j !== i))}
              />
            </div>
          ))}
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            onClick={() =>
              setPeriodRows([
                ...periodRows,
                { periodIndex: String(periodRows.length + 1), startTime: '08:00', endTime: '08:45' },
              ])
            }
          >
            {t('periodForm.addPeriod')}
          </Button>
          {periodsError && (
            <Alert type="error" showIcon title={t('error.save')} description={periodsError} />
          )}
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
          {t('deleteConfirm', { name: delTarget?.name })}
        </p>
        {delError && (
          <Alert type="error" showIcon title={t('error.delete')} description={delError} />
        )}
      </Modal>
    </div>
  )
}
