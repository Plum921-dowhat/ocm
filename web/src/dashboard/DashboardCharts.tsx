import { Card, Col, Row } from 'antd'
import { Column, Line } from '@ant-design/charts'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../theme/ThemeContext'
import type { DailyCount, DashboardPeriodCount } from '../types/api'

// DashboardCharts renders the homepage's two chart panels as one band.
// It is lazy-loaded from DashboardPage so the G2/charts bundle stays out of
// the app's main chunk; each chart sizes to its holder container (fixed height
// in SCSS, width 100%). Empty prop arrays hide the panel, so the band degrades
// the same way the list sections do when the backend omits a field for a
// low-privilege user or an empty day.
interface DashboardChartsProps {
  periods: DashboardPeriodCount[]
  load: DailyCount[]
  loadAll: boolean
}

const SERIES_COLOR = '#2B5FF6'

export default function DashboardCharts({ periods, load, loadAll }: DashboardChartsProps) {
  const { t } = useTranslation('dashboard')
  const { colorScheme } = useTheme()
  const chartTheme = colorScheme === 'dark' ? 'classicDark' : 'classic'

  const lineGroup = loadAll ? t('charts.futureLoadAll') : t('charts.futureLoadMine')

  const barData = periods.map((p) => ({
    period: t('periodLabel.single', { period: p.period }),
    count: p.count,
  }))

  const lineData = load.map((d) => ({
    date: d.date,
    count: d.count,
  }))

  return (
    <Row className="dashboard__charts" gutter={[24, 24]}>
      {barData.length > 0 && (
        <Col xs={24} lg={12}>
          <Card className="dashboard__panel dashboard__chart-panel" title={t('charts.todayDistribution')} size="small">
            <div className="dashboard__chart-holder">
              <Column
                data={barData}
                xField="period"
                yField="count"
                height={240}
                theme={chartTheme}
                legend={false}
                style={{ fill: SERIES_COLOR }}
              />
            </div>
          </Card>
        </Col>
      )}
      {lineData.length > 0 && (
        <Col xs={24} lg={12}>
          <Card className="dashboard__panel dashboard__chart-panel" title={lineGroup} size="small">
            <div className="dashboard__chart-holder">
              <Line
                data={lineData}
                xField="date"
                yField="count"
                height={240}
                theme={chartTheme}
                legend={false}
                style={{ stroke: SERIES_COLOR }}
                point={{ size: 3, shape: 'circle' }}
                axis={{
                  x: {
                    // Dates are YYYY-MM-DD; the year never changes within the
                    // window, so MM-DD keeps 14 labels readable.
                    labelFormatter: (value: string) => String(value).slice(5),
                    labelAutoRotate: false,
                    labelAutoHide: true,
                  },
                }}
              />
            </div>
          </Card>
        </Col>
      )}
    </Row>
  )
}
