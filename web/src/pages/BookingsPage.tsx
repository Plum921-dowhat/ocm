import { useEffect, useState } from 'react'
import {
  Alert,
  Breadcrumb,
  Button,
  DatePicker,
  Input,
  Modal,
  Select,
  Table,
  Tag,
  type TableColumnsType,
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../auth/api'
import ExportButton from '../components/ExportButton'
import ListPagination from '../components/ListPagination'
import usePagedList from '../hooks/usePagedList'
import Field from '../ui/Field'
import { formatDate } from '../i18n/formatters'
import { ApiError, type BookingInput, type BookingView, type Classroom, type Paged, type Period, type Regime, type SessionView } from '../types/api'

const STATUS_COLOR: Record<string, string> = {
  pending: 'blue',
  approved: 'green',
  rejected: 'red',
  cancelled: 'default',
}

// Booking status enum values shown in the status filter dropdown.
const STATUS_FILTER_KEYS = ['pending', 'approved', 'rejected', 'cancelled']

function pad(n: number) {
  return String(n).padStart(2, '0')
}

// fmt produces an ISO YYYY-MM-DD string for the filter state; display
// formatting is handled separately.
function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

interface BookingForm {
  classroomId: string
  date: string
  periodStart: string
  periodEnd: string
  purpose: string
}

const emptyForm: BookingForm = { classroomId: '', date: '', periodStart: '', periodEnd: '', purpose: '' }

export default function BookingsPage() {
  const { t, i18n } = useTranslation('bookings')
  const { token, user: currentUser, can } = useAuth()
  const navigate = useNavigate()
  const canApprove = can('booking:approve')

  const periodLabel = (b?: BookingView | null) => {
    if (!b) return ''
    if (b.periodStart === b.periodEnd) return t('periodLabel.single', { period: b.periodStart })
    return t('periodLabel.range', { start: b.periodStart, end: b.periodEnd })
  }

  const [classrooms, setClassrooms] = useState<Classroom[]>([])

  const [filterClassroom, setFilterClassroom] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const today = new Date()
  const [from, setFrom] = useState(fmt(today))
  const [to, setTo] = useState(fmt(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30)))

  const list = usePagedList<BookingView>({
    path: '/api/bookings',
    token,
    extraParams: { classroom_id: filterClassroom, status: filterStatus, from, to },
  })
  const { loading } = list
  // Action/export errors are separate from the list fetch (the hook owns its error).
  const [actionError, setActionError] = useState('')
  const error = list.error || actionError

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<BookingForm>(emptyForm)
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)
  const [periods, setPeriods] = useState<Period[]>([])
  const [busy, setBusy] = useState<number[]>([])

  const [cancelTarget, setCancelTarget] = useState<BookingView | null>(null)
  const [actingId, setActingId] = useState<number | null>(null)

  useEffect(() => {
    apiFetch<Paged<Classroom>>('/api/classrooms?page_size=500', { token })
      .then((data) => setClassrooms(Array.isArray(data?.items) ? data.items : []))
      .catch((err: Error) => setActionError(err.message))
  }, [token])

  // When the create modal's classroom or date changes, load the active regime
  // (for period options) and the day's sessions + bookings (for a busy hint).
  useEffect(() => {
    const cid = createForm.classroomId
    const d = createForm.date
    if (!cid || !d) {
      setPeriods([])
      setBusy([])
      return
    }
    let cancelled = false
    Promise.all([
      apiFetch<Regime>(`/api/schedule/active?date=${d}`, { token }),
      apiFetch<Paged<SessionView>>(`/api/sessions?classroom_id=${cid}&from=${d}&to=${d}&page_size=500`, { token }),
      apiFetch<Paged<BookingView>>(`/api/bookings?classroom_id=${cid}&from=${d}&to=${d}&page_size=500`, { token }),
    ])
      .then(([regime, sessData, booksData]) => {
        if (cancelled) return
        const ps = (regime?.periods || []).slice().sort((a, b) => a.periodIndex - b.periodIndex)
        setPeriods(ps)
        const sess = Array.isArray(sessData?.items) ? sessData.items : []
        const books = Array.isArray(booksData?.items) ? booksData.items : []
        const busySet = new Set<number>()
        sess.forEach((s) => {
          for (let i = s.periodStart; i <= s.periodEnd; i++) busySet.add(i)
        })
        books.forEach((b) => {
          if (b.status === 'pending' || b.status === 'approved') {
            for (let i = b.periodStart; i <= b.periodEnd; i++) busySet.add(i)
          }
        })
        setBusy(Array.from(busySet).sort((a, b) => a - b))
        setCreateError('')
        setCreateForm((f) => {
          const first = ps[0]?.periodIndex
          const keepStart = f.periodStart && ps.some((p) => p.periodIndex === Number(f.periodStart))
          const keepEnd = f.periodEnd && ps.some((p) => p.periodIndex === Number(f.periodEnd))
          return {
            ...f,
            periodStart: keepStart ? f.periodStart : first ? String(first) : '',
            periodEnd: keepEnd ? f.periodEnd : first ? String(first) : '',
          }
        })
      })
      .catch((err: ApiError) => {
        if (cancelled) return
        setPeriods([])
        setBusy([])
        setCreateError(err instanceof ApiError && err.status === 404 ? t('validation.noSchedule') : err.message)
      })
    return () => {
      cancelled = true
    }
  }, [createForm.classroomId, createForm.date, token, t])

  const openCreate = () => {
    setCreateForm(emptyForm)
    setCreateError('')
    setPeriods([])
    setBusy([])
    setCreateOpen(true)
  }

  const handleCreate = async () => {
    if (!createForm.classroomId) return setCreateError(t('validation.selectClassroom'))
    if (!createForm.date) return setCreateError(t('validation.selectDate'))
    if (!createForm.periodStart || !createForm.periodEnd) return setCreateError(t('validation.selectPeriod'))
    if (Number(createForm.periodStart) > Number(createForm.periodEnd)) return setCreateError(t('validation.periodOrder'))
    if (!createForm.purpose.trim()) return setCreateError(t('validation.purposeRequired'))
    try {
      setCreating(true)
      setCreateError('')
      const body: BookingInput = {
        classroomId: Number(createForm.classroomId),
        date: createForm.date,
        periodStart: Number(createForm.periodStart),
        periodEnd: Number(createForm.periodEnd),
        purpose: createForm.purpose.trim(),
      }
      await apiFetch('/api/bookings', { method: 'POST', token, body })
      setCreateOpen(false)
      list.reload()
    } catch (err) {
      setCreateError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const cancelBooking = async () => {
    const id = cancelTarget?.id
    if (!id) return
    try {
      setActingId(id)
      setActionError('')
      await apiFetch(`/api/bookings/${id}/cancel`, { method: 'POST', token })
      setCancelTarget(null)
      list.reload()
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setActingId(null)
    }
  }

  const reviewBooking = async (id: number, decision: 'approve' | 'reject') => {
    try {
      setActingId(id)
      setActionError('')
      await apiFetch(`/api/bookings/${id}/review`, { method: 'POST', token, body: { decision } })
      list.reload()
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setActingId(null)
    }
  }

  // The busy-periods hint joins numbers with a locale-appropriate separator
  // (zh: "1、2、3", en: "1, 2, 3") via Intl.ListFormat narrow style.
  const busyText =
    busy.length > 0
      ? t('form.busyPrefix') + new Intl.ListFormat(i18n.language, { style: 'narrow' }).format(busy.map(String))
      : t('form.busyNone')

  // The export endpoint mirrors the list filters, so the downloaded file
  // reflects the currently-viewed (filtered) set of bookings.
  const exportParams = new URLSearchParams()
  if (filterClassroom) exportParams.set('classroom_id', filterClassroom)
  if (filterStatus) exportParams.set('status', filterStatus)
  if (from) exportParams.set('from', from)
  if (to) exportParams.set('to', to)

  const columns: TableColumnsType<BookingView> = [
    { title: t('field.classroom'), dataIndex: 'classroomName', width: 160 },
    { title: t('field.date'), dataIndex: 'date', width: 120 },
    {
      title: t('field.period'),
      key: 'period',
      width: 120,
      render: (_, b) => periodLabel(b),
    },
    { title: t('field.purpose'), dataIndex: 'purpose', ellipsis: true },
    {
      title: t('field.status'),
      dataIndex: 'status',
      width: 110,
      render: (value: string) => (
        <Tag color={STATUS_COLOR[value] ?? 'default'}>
          {t('status.' + value, { ns: 'common', defaultValue: value })}
        </Tag>
      ),
    },
    { title: t('field.bookedBy'), dataIndex: 'displayName', width: 130 },
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
      render: (_, b) => {
        const canCancel =
          (b.status === 'pending' || b.status === 'approved') &&
          (canApprove || Number(currentUser?.id) === b.userId)
        const canReview = canApprove && b.status === 'pending'
        if (!canCancel && !canReview) return <span className="bookings-page__muted">—</span>
        return (
          <div className="bookings-page__actions">
            {canCancel && (
              <Button size="small" disabled={actingId === b.id} onClick={() => setCancelTarget(b)}>
                {t('action.cancel')}
              </Button>
            )}
            {canReview && (
              <>
                <Button size="small" disabled={actingId === b.id} onClick={() => reviewBooking(b.id, 'approve')}>
                  {t('action.approve')}
                </Button>
                <Button size="small" danger disabled={actingId === b.id} onClick={() => reviewBooking(b.id, 'reject')}>
                  {t('action.reject')}
                </Button>
              </>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div className="bookings-page">
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
      <h1 className="bookings-page__heading">{t('title')}</h1>
      <p className="bookings-page__subtitle">{t('subtitle')}</p>

      {error && (
        <Alert type="error" showIcon title={t('error.action')} description={error} className="bookings-page__notice" />
      )}

      <div className="bookings-page__filters">
        <Field label={t('filter.classroom')} htmlFor="f-classroom" className="bookings-page__filter">
          <Select
            id="f-classroom"
            value={filterClassroom}
            onChange={(value: string) => setFilterClassroom(value)}
            options={[
              { value: '', label: t('filter.allClassrooms') },
              ...classrooms.map((c) => ({ value: String(c.id), label: c.name })),
            ]}
          />
        </Field>
        <Field label={t('filter.status')} htmlFor="f-status" className="bookings-page__filter">
          <Select
            id="f-status"
            value={filterStatus}
            onChange={(value: string) => setFilterStatus(value)}
            options={[
              { value: '', label: t('filter.allStatuses') },
              ...STATUS_FILTER_KEYS.map((k) => ({ value: k, label: t('status.' + k, { ns: 'common' }) })),
            ]}
          />
        </Field>
        <Field label={t('filter.from')} htmlFor="f-from" className="bookings-page__filter">
          <DatePicker
            id="f-from"
            allowClear={false}
            value={from ? dayjs(from) : null}
            onChange={(d) => setFrom(d ? d.format('YYYY-MM-DD') : '')}
          />
        </Field>
        <Field label={t('filter.to')} htmlFor="f-to" className="bookings-page__filter">
          <DatePicker
            id="f-to"
            allowClear={false}
            value={to ? dayjs(to) : null}
            onChange={(d) => setTo(d ? d.format('YYYY-MM-DD') : '')}
          />
        </Field>
      </div>

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
          path={`/api/bookings/export?${exportParams.toString()}`}
          fallbackName="bookings.xlsx"
          onError={setActionError}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          {t('addButton')}
        </Button>
      </div>

      <Table<BookingView>
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={list.items}
        loading={loading}
        pagination={false}
        scroll={{ x: 990 }}
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
        title={t('form.create')}
        okText={t('form.createSubmit')}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        confirmLoading={creating}
        destroyOnHidden
      >
        <div className="bookings-page__form">
          <Field label={t('form.classroom')} htmlFor="c-classroom">
            <Select
              id="c-classroom"
              placeholder={t('form.selectClassroom')}
              value={createForm.classroomId || undefined}
              onChange={(value: string) => setCreateForm({ ...createForm, classroomId: value })}
              options={classrooms
                .filter((c) => c.status === 'available')
                .map((c) => ({ value: String(c.id), label: c.name }))}
            />
          </Field>
          <Field label={t('form.date')} htmlFor="c-date">
            <DatePicker
              id="c-date"
              allowClear={false}
              value={createForm.date ? dayjs(createForm.date) : null}
              onChange={(d) => setCreateForm({ ...createForm, date: d ? d.format('YYYY-MM-DD') : '' })}
            />
          </Field>
          {periods.length > 0 && (
            <>
              <Field label={t('form.periodStart')} htmlFor="c-start">
                <Select
                  id="c-start"
                  value={createForm.periodStart}
                  onChange={(start: string) =>
                    setCreateForm((f) => ({
                      ...f,
                      periodStart: start,
                      periodEnd: Number(start) > Number(f.periodEnd) ? start : f.periodEnd,
                    }))
                  }
                  options={periods.map((p) => ({
                    value: String(p.periodIndex),
                    label: t('periodOption', { period: p.periodIndex, start: p.startTime, end: p.endTime }),
                  }))}
                />
              </Field>
              <Field label={t('form.periodEnd')} htmlFor="c-end">
                <Select
                  id="c-end"
                  value={createForm.periodEnd}
                  onChange={(periodEnd: string) => setCreateForm((f) => ({ ...f, periodEnd }))}
                  options={periods.map((p) => ({
                    value: String(p.periodIndex),
                    label: t('periodOption', { period: p.periodIndex, start: p.startTime, end: p.endTime }),
                  }))}
                />
              </Field>
              <p className="bookings-page__busy">{busyText}</p>
            </>
          )}
          <Field label={t('form.purpose')} htmlFor="c-purpose">
            <Input
              id="c-purpose"
              placeholder={t('form.purposePlaceholder')}
              value={createForm.purpose}
              onChange={(e) => setCreateForm({ ...createForm, purpose: e.target.value })}
            />
          </Field>
          {createError && <Alert type="error" showIcon title={t('error.submit')} description={createError} />}
        </div>
      </Modal>

      {/* Cancel confirm */}
      <Modal
        open={Boolean(cancelTarget)}
        title={t('cancelModal.title')}
        okText={t('cancelModal.submit')}
        cancelText={t('cancelModal.secondary')}
        onCancel={() => setCancelTarget(null)}
        onOk={cancelBooking}
        confirmLoading={actingId === cancelTarget?.id}
        okButtonProps={{ danger: true }}
        destroyOnHidden
      >
        <p className="bookings-page__confirm-text">
          {t('cancelModal.confirm', {
            classroom: cancelTarget?.classroomName,
            date: cancelTarget?.date,
            period: periodLabel(cancelTarget),
          })}
        </p>
      </Modal>
    </div>
  )
}
