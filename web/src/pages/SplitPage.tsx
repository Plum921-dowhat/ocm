import { useRef, useState } from 'react'
import { Alert, Breadcrumb, Button, Input, DatePicker } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiUpload } from '../auth/api'
import SplitWizard from '../components/SplitWizard'
import Field from '../ui/Field'
import type { SplitResult } from '../types/api'

// SplitPage (/imports/split) is the 教务处课表拆分 entry: upload the aggregated
// schedule + semester + week-1 Monday, the backend splits it into 6 import jobs,
// and the inline SplitWizard guides the operator through them in dependency
// order (full page width — no modal — so the large preview tables are readable).
export default function SplitPage() {
  const { t } = useTranslation('imports')
  const { token } = useAuth()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  const [splitFile, setSplitFile] = useState<File | null>(null)
  const [splitSemester, setSplitSemester] = useState('')
  const [splitWeek1, setSplitWeek1] = useState('')
  const [splitting, setSplitting] = useState(false)
  const [splitError, setSplitError] = useState('')
  // SplitWizard session: holds the 6 jobs (dependency order) + stats/warnings
  // returned by jwc_split. Null = show the split form; set = show the wizard.
  const [wizard, setWizard] = useState<SplitResult | null>(null)

  const handleSplit = async () => {
    if (!splitFile || !splitSemester || !splitWeek1) return
    try {
      setSplitting(true)
      setSplitError('')
      setWizard(null)
      const data = await apiUpload<SplitResult>('/api/imports/jwc_split', {
        file: splitFile,
        token,
        fields: { semester: splitSemester, week1_monday: splitWeek1 },
      })
      setSplitFile(null)
      if (fileRef.current) fileRef.current.value = ''
      setWizard({ jobs: data.jobs, stats: data.stats, warnings: data.warnings })
    } catch (err) {
      setSplitError((err as Error).message)
    } finally {
      setSplitting(false)
    }
  }

  return (
    <div className="imports-page">
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
                href="/imports"
                onClick={(e) => {
                  e.preventDefault()
                  navigate('/imports')
                }}
              >
                {t('breadcrumb.current')}
              </a>
            ),
          },
          { title: t('split.heading') },
        ]}
      />
      <h1 className="courses-page__heading">{t('split.heading')}</h1>
      <p className="courses-page__subtitle">{t('split.subtitle')}</p>

      {wizard ? (
        <SplitWizard
          jobs={wizard.jobs}
          stats={wizard.stats}
          warnings={wizard.warnings}
          token={token}
          onExit={() => setWizard(null)}
          onViewJobs={() => navigate('/imports')}
        />
      ) : (
        <>
          <div className="imports-page__upload">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setSplitFile(e.target.files?.[0] || null)}
            />
            <Field label={t('split.semester')} htmlFor="jwc-semester" className="imports-page__split-input">
              <Input
                id="jwc-semester"
                size="small"
                placeholder="2024-2025-2"
                value={splitSemester}
                onChange={(e) => setSplitSemester(e.target.value)}
              />
            </Field>
            <Field label={t('split.week1')} htmlFor="jwc-week1" className="imports-page__split-input">
              <DatePicker
                id="jwc-week1"
                size="small"
                allowClear={false}
                value={splitWeek1 ? dayjs(splitWeek1) : null}
                onChange={(d) => setSplitWeek1(d ? d.format('YYYY-MM-DD') : '')}
              />
            </Field>
            <Button
              type="primary"
              icon={<UploadOutlined />}
              size="small"
              onClick={handleSplit}
              disabled={!splitFile || !splitSemester || !splitWeek1 || splitting}
            >
              {splitting ? t('split.splitting') : t('split.button')}
            </Button>
          </div>
          {splitError && (
            <Alert
              type="error"
              showIcon
              title={t('split.error')}
              description={splitError}
              className="imports-page__upload-err"
            />
          )}
        </>
      )}
    </div>
  )
}
