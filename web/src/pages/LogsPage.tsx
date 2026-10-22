import { useEffect, useState } from 'react'
import {
  Alert,
  Breadcrumb,
  Button,
  Input,
  InputNumber,
  Switch,
  Table,
  Tag,
  type TableColumnsType,
  DatePicker
} from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../auth/api'
import Field from '../ui/Field'
import ListPagination from '../components/ListPagination'
import usePagedList from '../hooks/usePagedList'
import { formatDate } from '../i18n/formatters'
import type { LogRetentionSettings, LogView } from '../types/api'

// statusClass groups HTTP status codes by class: the audit log records the
// outcome of every mutating request, so a 4xx shows an attempted (rejected)
// change, a 5xx a server-side failure.
function statusClass(code: number) {
  return Math.floor(code / 100)
}

// Ant Design tag colours, one per status class. 4xx gets gold (an attempted
// but rejected change) instead of Carbon's silently-ignored 'yellow'.
const STATUS_COLOR: Record<number, string> = {
  2: 'green',
  3: 'blue',
  4: 'gold',
  5: 'red',
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const DEFAULT_SETTINGS: LogRetentionSettings = { retentionEnabled: true, retentionDays: 180 }

export default function LogsPage() {
  const { t } = useTranslation('logs')
  const { token, can } = useAuth()
  const navigate = useNavigate()
  const canManage = can('log:manage')

  // Date filters default to the last 30 days, the same window convention as
  // the bookings page.
  const today = new Date()
  const [from, setFrom] = useState(fmt(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30)))
  const [to, setTo] = useState(fmt(today))

  const list = usePagedList<LogView>({
    path: '/api/logs',
    token,
    extraParams: { from, to },
  })
  // Settings fetch/save errors are separate from the list fetch (the hook owns its error).
  const [actionError, setActionError] = useState('')
  const error = list.error || actionError

  const [settings, setSettings] = useState<LogRetentionSettings>(DEFAULT_SETTINGS)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveNotice, setSaveNotice] = useState('')

  useEffect(() => {
    apiFetch<LogRetentionSettings>('/api/logs/settings', { token })
      .then((data) => {
        setSettings({
          retentionEnabled: Boolean(data?.retentionEnabled),
          retentionDays: Number.isFinite(Number(data?.retentionDays)) ? Number(data.retentionDays) : 180,
        })
        setSettingsLoaded(true)
      })
      .catch((err: Error) => setActionError(err.message))
  }, [token])

  const saveSettings = () => {
    setSaving(true)
    setSaveNotice('')
    const body: LogRetentionSettings = {
      retentionEnabled: settings.retentionEnabled,
      retentionDays: settings.retentionDays,
    }
    apiFetch('/api/logs/settings', { method: 'PUT', token, body })
      .then(() => {
        setSaveNotice(t('settings.savedNotice'))
        list.reload()
      })
      .catch((err: Error) => setActionError(err.message))
      .finally(() => setSaving(false))
  }

  const columns: TableColumnsType<LogView> = [
    {
      title: t('field.createdAt'),
      dataIndex: 'createdAt',
      width: 176,
      render: (value: string) => formatDate(value),
    },
    {
      title: t('field.actorName'),
      dataIndex: 'actorName',
      width: 140,
      render: (value: string) => value || '-',
    },
    {
      title: t('field.summary'),
      dataIndex: 'summary',
      ellipsis: true,
      render: (_: unknown, log) => log.summary || `${log.method ?? ''} ${log.path ?? ''}`.trim() || '-',
    },
    {
      title: t('field.request'),
      key: 'request',
      width: 240,
      ellipsis: true,
      render: (_: unknown, log) => `${log.method ?? ''} ${log.path ?? ''}`.trim() || '-',
    },
    {
      title: t('field.statusCode'),
      dataIndex: 'statusCode',
      width: 120,
      render: (code: number | null) => {
        if (code == null) return '-'
        const cls = statusClass(code)
        return (
          <Tag color={STATUS_COLOR[cls] ?? 'default'}>
            {t('result.' + cls, { defaultValue: '' })} {code}
          </Tag>
        )
      },
    },
    {
      title: t('field.clientIp'),
      dataIndex: 'clientIp',
      width: 140,
      render: (value: string) => value || '-',
    },
  ]

  return (
    <div className="logs-page">
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
      <h1 className="logs-page__heading">{t('title')}</h1>
      <p className="logs-page__subtitle">{t('subtitle')}</p>

      {error && <Alert type="error" showIcon title={t('error.load')} description={error} />}
      {saveNotice && <Alert type="success" showIcon title={saveNotice} />}

      <div className="logs-page__filters">
        <Field label={t('filter.from')} htmlFor="logs-from">
          <DatePicker
            id="logs-from"
            allowClear={false}
            value={from ? dayjs(from) : null}
            onChange={(d) => setFrom(d ? d.format('YYYY-MM-DD') : '')}
          />
        </Field>
        <Field label={t('filter.to')} htmlFor="logs-to">
          <DatePicker
            id="logs-to"
            allowClear={false}
            value={to ? dayjs(to) : null}
            onChange={(d) => setTo(d ? d.format('YYYY-MM-DD') : '')}
          />
        </Field>
        <Button
          onClick={() => {
            setFrom(fmt(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30)))
            setTo(fmt(today))
          }}
        >
          {t('filter.clear')}
        </Button>
      </div>

      <div className="ds-table-toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder={t('searchPlaceholder')}
          value={list.q}
          onChange={(e) => list.setQ(e.target.value)}
          className="ds-table-toolbar__search"
        />
      </div>

      <Table<LogView>
        className="logs-page__table"
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={list.items}
        loading={list.loading}
        pagination={false}
        scroll={{ x: 1040 }}
        locale={{
          emptyText: list.q || from || to ? t('empty.search') : t('empty.none'),
        }}
      />

      <ListPagination
        page={list.page}
        pageSize={list.pageSize}
        totalItems={list.total}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
      />

      <section className="logs-page__settings">
        <h2 className="logs-page__settings-heading">{t('settings.heading')}</h2>
        <p className="logs-page__settings-hint">
          {t('settings.hint')}{canManage ? '' : t('settings.adminOnlySuffix')}
        </p>
        <div className="logs-page__settings-row">
          <span className="logs-page__settings-label">{t('settings.retentionEnabledLabel')}</span>
          <Switch
            id="retentionEnabled"
            aria-label={t('settings.retentionEnabledLabel')}
            checked={settings.retentionEnabled}
            disabled={!canManage || !settingsLoaded}
            onChange={(checked) => setSettings({ ...settings, retentionEnabled: checked })}
          />
        </div>
        <Field label={t('settings.retentionDaysLabel')} htmlFor="retentionDays">
          <InputNumber
            id="retentionDays"
            min={1}
            max={3650}
            value={settings.retentionDays}
            disabled={!canManage || !settingsLoaded || !settings.retentionEnabled}
            onChange={(value) => setSettings({ ...settings, retentionDays: Number(value) })}
            style={{ width: 200 }}
          />
        </Field>
        {canManage && (
          <Button
            type="primary"
            disabled={saving || settings.retentionDays < 1 || settings.retentionDays > 3650}
            onClick={saveSettings}
          >
            {t('settings.saveButton')}
          </Button>
        )}
      </section>
    </div>
  )
}
