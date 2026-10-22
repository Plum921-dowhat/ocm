import { useState } from 'react'
import { Alert, Breadcrumb, Select, Table, type TableColumnsType } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../auth/api'
import ExportButton from '../components/ExportButton'
import Field from '../ui/Field'
import type { OfferingSummary, OfferingView, Paged, SummaryRow } from '../types/api'
import { STATUS_KEYS, StatusTag, formatDateTime, type PickerOption } from './attendanceUi'

// L2 整学期考勤报表: pick one offering → per-student × per-checkin matrix
// with per-status subtotals, downloadable as a two-sheet xlsx.
const TOTAL_KEYS = ['present', 'late', 'absent', 'leave']

// One row of the matrix: fixed identity columns plus one dynamic cell per
// checkin (key `c<checkinId>`, value the record status) and the totals text.
type ReportRow = {
  id: string
  displayName: string
  studentNo: string
  adminClass: string
  totals: string
} & Record<string, string>

export default function AttendanceReportPage() {
  const { t } = useTranslation('attendance')
  const { token } = useAuth()
  const navigate = useNavigate()

  const [offerings, setOfferings] = useState<PickerOption[]>([])
  const [pickOffering, setPickOffering] = useState<PickerOption | null>(null)
  const [summary, setSummary] = useState<OfferingSummary | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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

  const handlePickOffering = (offeringId: string) => {
    const picked = offerings.find((o) => o.id === offeringId) ?? null
    setPickOffering(picked)
    setSummary(null)
    setError('')
    if (picked) loadSummary(picked.id)
  }

  const loadSummary = async (offeringId: string) => {
    try {
      setLoading(true)
      setError('')
      const data = await apiFetch<OfferingSummary>(`/api/checkins/summary?offering_id=${offeringId}`, { token })
      setSummary(data)
    } catch (err) {
      setError((err as Error).message)
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }

  const checkins = summary?.checkins ?? []
  // The API serialises an empty Go slice as null, so rows can arrive as null
  // even though the type says array. Normalise once here: the summary line and
  // the "everyone is outside the roster" hint used to dereference
  // summary.rows directly, which blanked the page for any offering without
  // students (the default state of a fresh install).
  const summaryRows = summary?.rows ?? []

  const buildRow = (r: SummaryRow): ReportRow => {
    const row: ReportRow = { id: String(r.userId), displayName: r.displayName, studentNo: r.studentNo, adminClass: r.adminClass, totals: '' }
    for (const c of checkins) {
      row[`c${c.id}`] = r.records[c.id] ?? ''
    }
    row.totals = TOTAL_KEYS.map((k) => r.totals[k] ?? 0).join(' / ')
    return row
  }
  const rows = summaryRows.map(buildRow)

  const columns: TableColumnsType<ReportRow> = [
    {
      title: t('report.field.name'),
      dataIndex: 'displayName',
      width: 140,
      render: (value: string) => value || '-',
    },
    {
      title: t('report.field.studentNo'),
      dataIndex: 'studentNo',
      width: 130,
      render: (value: string) => value || '-',
    },
    {
      title: t('report.field.adminClass'),
      dataIndex: 'adminClass',
      width: 160,
      render: (value: string) => value || '-',
    },
    ...checkins.map((c) => ({
      title: c.startsAt.slice(0, 10),
      dataIndex: `c${c.id}`,
      key: `c${c.id}`,
      width: 100,
      render: (value: string) => (value ? <StatusTag status={value} /> : <span className="attendance-report__empty">—</span>),
    })),
    { title: t('report.field.totals'), dataIndex: 'totals', width: 130 },
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
          {
            title: (
              <a
                href="/attendance"
                onClick={(e) => {
                  e.preventDefault()
                  navigate('/attendance')
                }}
              >
                {t('breadcrumb.attendance')}
              </a>
            ),
          },
          { title: t('breadcrumb.report') },
        ]}
      />
      <h1 className="courses-page__heading">{t('report.title')}</h1>
      <p className="courses-page__subtitle">{t('report.subtitle')}</p>

      {error && (
        <Alert type="error" showIcon title={t('report.error.load')} description={error} className="courses-page__notice" />
      )}

      <div className="courses-page__picker">
        <Field label={t('report.offering')} htmlFor="report-offering">
          <Select
            id="report-offering"
            showSearch
            optionFilterProp="label"
            placeholder={t('report.offeringPlaceholder')}
            value={pickOffering?.id}
            onChange={(value: string) => handlePickOffering(value)}
            onFocus={() => {
              if (offerings.length === 0) loadOfferings()
            }}
            options={offerings.map((o) => ({ value: o.id, label: o.text }))}
          />
        </Field>
      </div>

      {summary && (
        <>
          <p className="courses-page__subtitle">
            {summary.courseName} · {summary.teachingClassName} · {summary.semester} ·{' '}
            {t('report.summaryTeacher', { teacher: summary.teacher || '-' })} ·{' '}
            {t('report.summaryCheckins', { count: checkins.length })} ·{' '}
            {t('report.summaryStudents', { count: summaryRows.length })}
          </p>
          {checkins.length === 0 && (
            <Alert
              type="warning"
              showIcon
              title={t('report.warning.noCheckinsTitle')}
              description={t('report.warning.noCheckinsSubtitle')}
              className="courses-page__notice"
            />
          )}
          {summaryRows.every((r) => !r.inRoster) && (
            <Alert
              type="warning"
              showIcon
              title={t('report.warning.emptyRosterTitle')}
              description={t('report.warning.emptyRosterSubtitle')}
              className="courses-page__notice"
            />
          )}
        </>
      )}

      {summary && checkins.length > 0 && (
        <>
          <div className="ds-table-toolbar">
            <span className="ds-table-toolbar__title">{t('report.table.title')}</span>
            <span className="ds-table-toolbar__hint">{t('report.table.description')}</span>
            <ExportButton
              path={`/api/checkins/export?offering_id=${pickOffering?.id}`}
              fallbackName="attendance-report.xlsx"
              onError={setError}
            />
          </div>
          <Table<ReportRow>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={rows}
            loading={loading}
            pagination={false}
            scroll={{ x: 560 + checkins.length * 100 }}
            locale={{ emptyText: loading ? t('report.empty.loading') : t('report.empty.none') }}
          />
        </>
      )}
      {loading && <p>{t('report.empty.loading')}</p>}
      {!summary && !loading && !error && <p className="courses-page__subtitle">{t('report.noSelection')}</p>}
      {/* Legend for the matrix */}
      {summary && checkins.length > 0 && (
        <p className="courses-page__subtitle">
          {t('report.legend')}{' '}
          {STATUS_KEYS.map((value) => (
            <span key={value} className="attendance-report__legend">
              <StatusTag status={value} /> {t('status.' + value, { ns: 'common' })}
            </span>
          ))}{' '}
          {t('report.lastStarted', { time: formatDateTime(checkins[0]?.startsAt) })}
        </p>
      )}
    </div>
  )
}
