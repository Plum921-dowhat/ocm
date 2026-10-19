import { lazy, Suspense, type ReactNode } from 'react'
import { Alert, Breadcrumb, Button, Card, Col, Row, Skeleton, Tag } from 'antd'
import {
  ApartmentOutlined,
  ArrowRightOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ScheduleOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { openAiChat } from '../ai/chatInstance'
import useDashboardSummary from '../hooks/useDashboardSummary'
import { formatDateTime } from '../i18n/formatters'
import type { BookingView, RepairView } from '../types/api'
import type { Permission } from '../types/api'

// The charts band is code-split: the G2/charts bundle loads only when the
// homepage actually renders charts, keeping every other route's chunk lean.
const DashboardCharts = lazy(() => import('../dashboard/DashboardCharts'))

// Status tag colours match the bookings / repairs pages so every page reads
// the same semantics the same way.
const BOOKING_STATUS_COLOR: Record<string, string> = {
  pending: 'blue',
  approved: 'green',
  rejected: 'red',
  cancelled: 'default',
}

const REPAIR_STATUS_COLOR: Record<string, string> = {
  open: 'red',
  processing: 'blue',
  completed: 'default',
  confirmed: 'green',
}

// Each quick link carries a key into dashboard.quickLinks.* for its title
// and description; the action (href or openChat) and permission gate stay.
interface QuickLink {
  key: string
  title: string
  description: string
  href?: string
  openChat?: boolean
  perm?: Permission
  adminOnly?: boolean
}

// KPI tile descriptor (built from the permission-gated summary fields).
interface Kpi {
  key: string
  icon: ReactNode
  label: string
  value: number
  unit: string
  href: string
  alert?: boolean
}

// Panel is the shared frame for every dashboard section: a Card with a
// heading, an optional trailing "view all" link and a padded body.
function Panel({ title, viewAll, children }: { title: string; viewAll?: { to: string; label: string }; children: ReactNode }) {
  const navigate = useNavigate()
  return (
    <Card
      className="dashboard__panel"
      size="small"
      title={title}
      extra={
        viewAll ? (
          <a
            href={viewAll.to}
            className="dashboard__panel-link"
            onClick={(e) => {
              e.preventDefault()
              navigate(viewAll.to)
            }}
          >
            {viewAll.label}
          </a>
        ) : undefined
      }
    >
      {children}
    </Card>
  )
}

function EmptyRow({ text }: { text: string }) {
  return <p className="dashboard__empty">{text}</p>
}

// Same frame as the real chart panels, shown while the split charts chunk
// downloads - the band reserves its height instead of popping in.
function ChartPanelSkeleton() {
  return (
    <Card className="dashboard__panel dashboard__chart-panel" size="small">
      <Skeleton active paragraph={{ rows: 4 }} />
    </Card>
  )
}

// periodLabel renders "N节" / "N-M节" for a session or booking.
function usePeriodLabel() {
  const { t } = useTranslation('dashboard')
  return (it: { periodStart: number; periodEnd: number } | null | undefined) => {
    if (!it) return ''
    if (it.periodStart === it.periodEnd) return t('periodLabel.single', { period: it.periodStart })
    return t('periodLabel.range', { start: it.periodStart, end: it.periodEnd })
  }
}

export default function DashboardPage() {
  const { t } = useTranslation('dashboard')
  const { user, token, can } = useAuth()
  const navigate = useNavigate()
  const { date, data, loading, error, reload } = useDashboardSummary(token)
  const periodLabel = usePeriodLabel()

  const go = (path: string) => (e: { preventDefault: () => void }) => {
    e.preventDefault()
    navigate(path)
  }

  const weekdays = t('weekdays', { returnObjects: true }) as string[]
  const weekday = weekdays[new Date(`${date}T00:00:00`).getDay()]
  const month = Number(date.slice(5, 7))
  const day = Number(date.slice(8, 10))
  const dateLabel = t('dateLabel', { month, day })

  const quickLinkDefs: Array<Pick<QuickLink, 'key' | 'href' | 'openChat' | 'perm' | 'adminOnly'>> = [
    { key: 'aiAssistant', openChat: true, perm: 'ai:chat' },
    { key: 'userManagement', href: '/users', perm: 'user:read' },
    { key: 'roleManagement', href: '/roles', perm: 'role:manage' },
    { key: 'parameters', href: '/settings', adminOnly: true },
    { key: 'auditLogs', href: '/logs', perm: 'log:read' },
  ]
  const quickLinks: QuickLink[] = quickLinkDefs.map((l) => ({
    ...l,
    title: t(`quickLinks.${l.key}.title`),
    description: t(`quickLinks.${l.key}.description`),
  }))

  // KPI row: built from the fields the backend actually returned - each entry
  // is permission-gated server side, so the row collapses naturally for
  // low-privilege users instead of showing forbidden modules.
  const kpis: Kpi[] = []
  if (data?.todaySessions)
    kpis.push({ key: 'sessions', icon: <CalendarOutlined />, label: t('kpi.todaySessions'), value: data.todaySessions.total, unit: t('unit.session'), href: '/timetable' })
  if (data?.classroomTotal !== undefined)
    kpis.push({ key: 'classrooms', icon: <ApartmentOutlined />, label: t('kpi.classroomTotal'), value: data.classroomTotal, unit: t('unit.classroom'), href: '/classrooms' })
  if (data?.pendingBookings)
    kpis.push({ key: 'pending', icon: <CheckCircleOutlined />, label: t('kpi.pendingBookings'), value: data.pendingBookings.total, unit: t('unit.item'), href: '/bookings', alert: data.pendingBookings.total > 0 })
  if (data?.openRepairs)
    kpis.push({ key: 'repairs', icon: <WarningOutlined />, label: t('kpi.openRepairs'), value: data.openRepairs.total, unit: t('unit.item'), href: '/repairs', alert: data.openRepairs.total > 0 })
  if (data?.myBookings)
    kpis.push({ key: 'mine', icon: <ScheduleOutlined />, label: t('kpi.myBookings'), value: data.myBookings.length, unit: t('unit.item'), href: '/bookings' })

  const sessions = data?.todaySessions?.items ?? []
  const pending = data?.pendingBookings?.items ?? []
  const repairs = data?.openRepairs?.items ?? []
  const mine: BookingView[] = data?.myBookings ?? []
  const logs = data?.recentLogs ?? []

  const hasCharts = (data?.sessionPeriods?.length || 0) + (data?.bookingLoad?.length || 0) > 0

  return (
    <div className="dashboard">
      <Breadcrumb
        items={[
          {
            title: (
              <a href="/" onClick={go('/')}>
                {t('breadcrumb.home')}
              </a>
            ),
          },
          { title: t('breadcrumb.overview') },
        ]}
      />
      <h1 className="dashboard__heading">{t('title')}</h1>
      <p className="dashboard__greeting">
        {t('greeting', { name: user?.displayName, date: dateLabel, weekday })}
      </p>

      {error && (
        <Alert
          type="error"
          showIcon
          message={t('error.title')}
          description={error}
          className="dashboard__error"
          action={
            <Button size="small" onClick={reload}>
              {t('error.retry')}
            </Button>
          }
        />
      )}

      {/* KPI row */}
      {(loading || kpis.length > 0) && (
        <div className="dashboard__kpis">
          {loading
            ? Array.from({ length: 4 }, (_, i) => (
                <Card key={i} className="dashboard__kpi">
                  <Skeleton active paragraph={{ rows: 2 }} title={false} />
                </Card>
              ))
            : kpis.map(({ key, icon, label, value, unit, href, alert }) => (
                <Card
                  key={key}
                  hoverable
                  className={`dashboard__kpi${alert ? ' dashboard__kpi--alert' : ''}`}
                  onClick={() => navigate(href)}
                >
                  <div className="dashboard__kpi-head">
                    <span className="dashboard__kpi-label">{label}</span>
                    <span className="dashboard__kpi-icon">{icon}</span>
                  </div>
                  <p className="dashboard__kpi-value">
                    {value}
                    <span className="dashboard__kpi-unit">{unit}</span>
                  </p>
                </Card>
              ))}
        </div>
      )}

      {/* Charts band: same omitempty semantics as the sections - a chart with
          no server data (permission or an empty day) collapses its column */}
      {!loading && hasCharts && (
        <Suspense
          fallback={
            <Row className="dashboard__charts" gutter={[24, 24]}>
              {(data?.sessionPeriods?.length || 0) > 0 && (
                <Col xs={24} lg={12}>
                  <ChartPanelSkeleton />
                </Col>
              )}
              {(data?.bookingLoad?.length || 0) > 0 && (
                <Col xs={24} lg={12}>
                  <ChartPanelSkeleton />
                </Col>
              )}
            </Row>
          }
        >
          <DashboardCharts
            periods={data?.sessionPeriods ?? []}
            load={data?.bookingLoad ?? []}
            loadAll={can('booking:approve')}
          />
        </Suspense>
      )}

      {/* Main band: today's sessions + to-do center */}
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={15}>
          {loading ? (
            <Card className="dashboard__panel" size="small">
              <Skeleton active paragraph={{ rows: 3 }} />
            </Card>
          ) : data?.todaySessions ? (
            <Panel title={t('panel.todaySessions')} viewAll={{ to: '/timetable', label: t('viewAll.fullTimetable') }}>
              {sessions.length === 0 ? (
                <EmptyRow text={t('empty.noSessions')} />
              ) : (
                <ul className="dashboard__sessions">
                  {sessions.map((s) => (
                    <li key={s.id} className="dashboard__session">
                      <Tag>{periodLabel(s)}</Tag>
                      <div className="dashboard__session-main">
                        <span className="dashboard__session-course" title={s.courseName}>{s.courseName}</span>
                        <span className="dashboard__session-meta">
                          {s.classroomName}
                          {s.teacher ? ` · ${s.teacher}` : ''}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {data.todaySessions.total > sessions.length && (
                <p className="dashboard__more">{t('more', { total: data.todaySessions.total, shown: sessions.length })}</p>
              )}
            </Panel>
          ) : null}
        </Col>

        <Col xs={24} lg={9}>
          {loading ? (
            <Card className="dashboard__panel" size="small">
              <Skeleton active paragraph={{ rows: 3 }} />
            </Card>
          ) : (
            <div className="dashboard__todos">
              {data?.pendingBookings && (
                <Panel title={t('panel.pendingBookings')} viewAll={{ to: '/bookings', label: t('viewAll.allBookings') }}>
                  {pending.length === 0 ? (
                    <EmptyRow text={t('empty.noPendingBookings')} />
                  ) : (
                    <ul className="dashboard__list">
                      {pending.map((b) => (
                        <li key={b.id} className="dashboard__list-row">
                          <div className="dashboard__list-main">
                            <span className="dashboard__list-title">
                              {b.classroomName} · {b.date} {periodLabel(b)}
                            </span>
                            <span className="dashboard__list-meta">
                              {b.displayName || b.username}
                              {b.purpose ? ` · ${b.purpose}` : ''}
                            </span>
                          </div>
                          <Tag color={BOOKING_STATUS_COLOR[b.status] ?? 'default'}>{t('bookingStatus.pending')}</Tag>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              )}
              {data?.openRepairs && (
                <Panel title={t('panel.openRepairs')} viewAll={{ to: '/repairs', label: t('viewAll.allTickets') }}>
                  {repairs.length === 0 ? (
                    <EmptyRow text={t('empty.noOpenRepairs')} />
                  ) : (
                    <ul className="dashboard__list">
                      {repairs.map((rp: RepairView) => (
                        <li key={rp.id} className="dashboard__list-row">
                          <div className="dashboard__list-main">
                            <span className="dashboard__list-title" title={rp.description}>
                              {rp.classroomName} · {rp.description}
                            </span>
                            <span className="dashboard__list-meta">{rp.creatorName}</span>
                          </div>
                          <Tag color={REPAIR_STATUS_COLOR[rp.status] ?? 'default'}>
                            {t(`repairStatus.${rp.status}`, { defaultValue: rp.status })}
                          </Tag>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              )}
              {data?.myBookings && mine.length > 0 && (
                <Panel title={t('panel.myRecentBookings')} viewAll={{ to: '/bookings', label: t('viewAll.myBookings') }}>
                  <ul className="dashboard__list">
                    {mine.map((b) => (
                      <li key={b.id} className="dashboard__list-row">
                        <div className="dashboard__list-main">
                          <span className="dashboard__list-title">
                            {b.classroomName} · {b.date} {periodLabel(b)}
                          </span>
                          <span className="dashboard__list-meta">{b.purpose}</span>
                        </div>
                        <Tag color={BOOKING_STATUS_COLOR[b.status] ?? 'default'}>{t('bookingStatus.approved')}</Tag>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
            </div>
          )}
        </Col>
      </Row>

      {/* Bottom band: recent activity + quick start */}
      <Row gutter={[24, 24]}>
        {!loading && data?.recentLogs && (
          <Col xs={24} lg={15}>
            <Panel title={t('panel.recentActivity')} viewAll={{ to: '/logs', label: t('viewAll.allLogs') }}>
              {logs.length === 0 ? (
                <EmptyRow text={t('empty.noLogs')} />
              ) : (
                <ul className="dashboard__logs">
                  {logs.map((l) => (
                    <li key={l.id} className="dashboard__log">
                      <span className="dashboard__log-time">{formatDateTime(l.createdAt)}</span>
                      <span className="dashboard__log-actor">{l.actorName || t('systemActor')}</span>
                      <span className="dashboard__log-text">
                        {l.summary || `${l.method} ${l.path}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </Col>
        )}

        {!loading && (
          <Col xs={24} lg={9}>
            <div className="dashboard__quicklinks">
              <h2 className="dashboard__section">{t('quickStart')}</h2>
              <div className="dashboard__quickgrid">
                {quickLinks
                  .filter((l) => (!l.adminOnly || can('*')) && (!l.perm || can(l.perm)))
                  .map(({ title, description, href, openChat }) => (
                    <Card
                      key={title}
                      hoverable
                      className="dashboard__quicklink"
                      onClick={(e) => {
                        if (openChat) {
                          e.preventDefault()
                          openAiChat()
                        } else if (href) {
                          navigate(href)
                        }
                      }}
                    >
                      <div className="dashboard__quicklink-title">
                        {title}
                        <ArrowRightOutlined />
                      </div>
                      <p className="dashboard__quicklink-desc">{description}</p>
                    </Card>
                  ))}
              </div>
            </div>
          </Col>
        )}
      </Row>
    </div>
  )
}
