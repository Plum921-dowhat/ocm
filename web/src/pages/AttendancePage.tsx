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
  DatePicker
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../auth/api'
import ListPagination from '../components/ListPagination'
import usePagedList from '../hooks/usePagedList'
import Field from '../ui/Field'
import type { Checkin, OfferingView, Paged, SessionView } from '../types/api'
import { CheckinStatusTag, formatDateTime, type PickerOption } from './attendanceUi'

export default function AttendancePage() {
  const { t } = useTranslation('attendance')
  const { token, can } = useAuth()
  const navigate = useNavigate()
  const canManage = can('attendance:manage')

  const [statusFilter, setStatusFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const list = usePagedList<Checkin>({
    path: '/api/checkins',
    token,
    extraParams: { status: statusFilter, from, to },
  })
  const { loading } = list

  const [createOpen, setCreateOpen] = useState(false)
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)
  const [offerings, setOfferings] = useState<PickerOption[]>([])
  const [pickOffering, setPickOffering] = useState<PickerOption | null>(null)
  const [sessions, setSessions] = useState<PickerOption[]>([])
  const [pickSession, setPickSession] = useState<PickerOption | null>(null)
  const [form, setForm] = useState({ title: '', lateMinutes: '0', durationMinute: '' })

  const [closeError, setCloseError] = useState('')

  const loadOfferings = async () => {
    try {
      const data = await apiFetch<Paged<OfferingView>>('/api/offerings?page_size=500', { token })
      setOfferings(
        (Array.isArray(data?.items) ? data.items : []).map((o) => ({
          id: String(o.id),
          text: t('list.offeringOption', { catalogName: o.catalogName, teachingClassName: o.teachingClassName, semester: o.semester }),
        })),
      )
    } catch {
      setOfferings([])
    }
  }

  const openCreate = () => {
    setCreateOpen(true)
    setCreateError('')
    setForm({ title: '', lateMinutes: '0', durationMinute: '' })
    setPickOffering(null)
    setPickSession(null)
    setSessions([])
    loadOfferings()
  }

  const handlePickOffering = (value?: string) => {
    const next = offerings.find((o) => o.id === value) ?? null
    setPickOffering(next)
    setPickSession(null)
    setSessions([])
    if (next) loadSessions(next.id)
  }

  const loadSessions = async (offeringId: string) => {
    try {
      const data = await apiFetch<Paged<SessionView>>(`/api/sessions?offering_id=${offeringId}&page_size=500`, { token })
      setSessions(
        (Array.isArray(data?.items) ? data.items : []).map((s) => ({
          id: String(s.id),
          text: t('list.sessionOption', { date: s.date, start: s.periodStart, end: s.periodEnd, classroom: s.classroomName }),
        })),
      )
    } catch {
      setSessions([])
    }
  }

  const handleCreate = async () => {
    const late = parseInt(form.lateMinutes || '0', 10)
    const duration = parseInt(form.durationMinute || '0', 10)
    if (Number.isNaN(late) || late < 0) {
      setCreateError(t('list.validation.lateNonNeg'))
      return
    }
    if (Number.isNaN(duration) || duration < 0) {
      setCreateError(t('list.validation.durationNonNeg'))
      return
    }
    if (!pickOffering && !form.title.trim()) {
      setCreateError(t('list.validation.titleRequired'))
      return
    }
    try {
      setCreating(true)
      setCreateError('')
      const v = await apiFetch<Checkin>('/api/checkins', {
        method: 'POST',
        token,
        body: {
          offeringId: pickOffering ? Number(pickOffering.id) : 0,
          sessionId: pickSession ? Number(pickSession.id) : 0,
          title: form.title.trim(),
          lateMinutes: late,
          durationMinute: duration,
        },
      })
      setCreateOpen(false)
      navigate(`/attendance/${v.id}`)
    } catch (err) {
      setCreateError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const handleClose = async (c: Checkin) => {
    try {
      setCloseError('')
      await apiFetch(`/api/checkins/${c.id}/close`, { method: 'POST', token })
      list.reload()
    } catch (err) {
      setCloseError((err as Error).message)
    }
  }

  const countsText = (c: Checkin) =>
    `${c.counts.expected} / ${c.counts.present} / ${c.counts.late} / ${c.counts.absent} / ${c.counts.leave}`

  const columns: TableColumnsType<Checkin> = [
    { title: t('list.field.title'), dataIndex: 'title', width: 160 },
    {
      title: t('list.field.offering'),
      key: 'offering',
      width: 180,
      render: (_, c) => (c.courseName ? `${c.courseName} / ${c.teachingClassName}` : t('list.noOffering')),
    },
    {
      title: t('list.field.sessionText'),
      dataIndex: 'sessionText',
      width: 170,
      render: (value: string) => value || '-',
    },
    {
      title: t('list.field.status'),
      dataIndex: 'status',
      width: 100,
      render: (value: string) => <CheckinStatusTag status={value} />,
    },
    {
      title: t('list.field.counts'),
      key: 'counts',
      width: 150,
      render: (_, c) => countsText(c),
    },
    {
      title: t('list.field.startsAt'),
      dataIndex: 'startsAt',
      width: 150,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: t('list.field.actions'),
      key: 'actions',
      width: 160,
      fixed: 'right',
      render: (_, c) => (
        <div className="courses-page__actions">
          <Button type="text" size="small" onClick={() => navigate(`/attendance/${c.id}`)}>
            {t('list.action.detail')}
          </Button>
          {canManage && c.status === 'active' && (
            <Button type="text" size="small" onClick={() => handleClose(c)}>
              {t('list.action.close')}
            </Button>
          )}
        </div>
      ),
    },
  ]

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
          { title: t('breadcrumb.attendance') },
        ]}
      />
      <h1 className="courses-page__heading">{t('list.title')}</h1>
      <p className="courses-page__subtitle">{t('list.subtitle')}</p>

      {list.error && (
        <Alert
          type="error"
          showIcon
          title={t('list.error.load')}
          description={list.error}
          className="courses-page__notice"
        />
      )}
      {closeError && (
        <Alert
          type="error"
          showIcon
          title={t('list.error.close')}
          description={closeError}
          className="courses-page__notice"
        />
      )}

      <div className="ds-table-toolbar">
        <span className="ds-table-toolbar__title">{t('list.table.title')}</span>
        <span className="ds-table-toolbar__hint">{t('list.table.description', { count: list.total })}</span>
        <Input
          allowClear
          className="ds-table-toolbar__search"
          placeholder={t('list.searchPlaceholder')}
          value={list.q}
          onChange={(e) => list.setQ(e.target.value)}
        />
        <Select
          id="att-status"
          aria-label={t('list.filter.status')}
          style={{ width: 160 }}
          value={statusFilter}
          onChange={(value: string) => setStatusFilter(value)}
          options={[
            { value: '', label: t('list.filter.allStatuses') },
            { value: 'active', label: t('list.filter.active') },
            { value: 'closed', label: t('list.filter.closed') },
          ]}
        />
        <DatePicker
          id="att-from"
          aria-label={t('list.filter.from')}
          allowClear={false}
          style={{ width: 160 }}
          value={from ? dayjs(from) : null}
          onChange={(d) => setFrom(d ? d.format('YYYY-MM-DD') : '')}
        />
        <DatePicker
          id="att-to"
          aria-label={t('list.filter.to')}
          allowClear={false}
          style={{ width: 160 }}
          value={to ? dayjs(to) : null}
          onChange={(d) => setTo(d ? d.format('YYYY-MM-DD') : '')}
        />
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            {t('list.addButton')}
          </Button>
        )}
      </div>

      <Table<Checkin>
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={list.items}
        loading={loading}
        pagination={false}
        scroll={{ x: 1075 }}
        locale={{
          emptyText: list.q || statusFilter || from || to ? t('list.empty.search') : t('list.empty.none'),
        }}
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
        title={t('list.modal.create')}
        okText={t('list.modal.createSubmit')}
        cancelText={t('action.cancel', { ns: 'common' })}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        confirmLoading={creating}
        width={720}
        destroyOnHidden
      >
        <div className="courses-page__form">
          <Field
            label={t('list.form.offering')}
            htmlFor="att-offering"
            hint={t('list.form.offeringHelper')}
          >
            <Select
              id="att-offering"
              showSearch
              allowClear
              optionFilterProp="label"
              placeholder={t('list.form.offeringPlaceholder')}
              value={pickOffering?.id}
              onChange={handlePickOffering}
              options={offerings.map((o) => ({ value: o.id, label: o.text }))}
            />
          </Field>
          {pickOffering && (
            <Field
              label={t('list.form.session')}
              htmlFor="att-session"
              hint={t('list.form.sessionHelper')}
            >
              <Select
                id="att-session"
                showSearch
                allowClear
                optionFilterProp="label"
                placeholder={t('list.form.sessionPlaceholder')}
                value={pickSession?.id}
                onChange={(value?: string) => setPickSession(sessions.find((s) => s.id === value) ?? null)}
                options={sessions.map((s) => ({ value: s.id, label: s.text }))}
              />
            </Field>
          )}
          <Field label={t('list.form.title')} htmlFor="att-title">
            <Input
              id="att-title"
              placeholder={t('list.form.titlePlaceholder')}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <Field label={t('list.form.lateMinutes')} htmlFor="att-late">
            <Input
              id="att-late"
              type="number"
              value={form.lateMinutes}
              onChange={(e) => setForm({ ...form, lateMinutes: e.target.value })}
            />
          </Field>
          <Field label={t('list.form.duration')} htmlFor="att-duration">
            <Input
              id="att-duration"
              type="number"
              placeholder={t('list.form.durationPlaceholder')}
              value={form.durationMinute}
              onChange={(e) => setForm({ ...form, durationMinute: e.target.value })}
            />
          </Field>
          {createError && (
            <Alert type="error" showIcon title={t('list.error.create')} description={createError} />
          )}
        </div>
      </Modal>
    </div>
  )
}
