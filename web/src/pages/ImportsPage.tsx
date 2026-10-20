import { useEffect, useState } from 'react'
import { Alert, Breadcrumb, Button, Input, Select, Table, Tag, Upload, type TableColumnsType } from 'antd'
import { SearchOutlined, UploadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiUpload } from '../auth/api'
import { IMPORT_TYPES } from '../components/ImportPreviewTable'
import ListPagination from '../components/ListPagination'
import usePagedList from '../hooks/usePagedList'
import { formatDate } from '../i18n/formatters'
import type { ImportJob } from '../types/api'

const STATUS_COLOR: Record<string, string> = {
  pending: 'blue',
  processing: 'blue',
  preview: 'purple',
  succeeded: 'green',
  failed: 'red',
  cancelled: 'default',
}

// ImportsPage (/imports) is the regular single-file import: pick a type, upload
// an xlsx, then track the resulting jobs in the list. The 教务处 split flow
// lives on its own page (/imports/split), and each job's full preview lives on
// its own page (/imports/:id) — so the large preview tables are never crammed
// into a modal. This page only owns the upload form + the job list.
export default function ImportsPage() {
  const { t } = useTranslation('imports')
  const { token } = useAuth()
  const navigate = useNavigate()

  const list = usePagedList<ImportJob>({ path: '/api/imports', token })
  const { loading } = list

  const [importType, setImportType] = useState('sessions')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  // Poll while any job is still pending or processing. The poll refetches the
  // current page (a fresh job always lands on page 1, newest first).
  useEffect(() => {
    const hasActive = list.items.some((j) => j.status === 'pending' || j.status === 'processing')
    if (!hasActive) return undefined
    const timer = setInterval(list.reload, 3000)
    return () => clearInterval(timer)
  }, [list.items, list.reload])

  const typeLabel = (type: string) => (type ? t('types.' + type + '.label', { defaultValue: type }) : '-')

  const handleUpload = async () => {
    if (!selectedFile) return
    try {
      setUploading(true)
      setUploadError('')
      await apiUpload(`/api/imports/${importType}`, { file: selectedFile, token })
      setSelectedFile(null)
      list.reload()
    } catch (err) {
      setUploadError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const columns: TableColumnsType<ImportJob> = [
    {
      title: t('field.type'),
      dataIndex: 'type',
      width: 160,
      render: (value: string) => typeLabel(value),
    },
    {
      title: t('field.filename'),
      dataIndex: 'filename',
      ellipsis: true,
      render: (value: string) => value || t('unnamed'),
    },
    {
      title: t('field.status'),
      dataIndex: 'status',
      width: 120,
      render: (value: string) => (
        <Tag color={STATUS_COLOR[value] ?? 'default'}>{t('status.' + value, { defaultValue: value })}</Tag>
      ),
    },
    { title: t('field.totalRows'), dataIndex: 'totalRows', width: 100 },
    { title: t('field.succeededRows'), dataIndex: 'succeededRows', width: 100 },
    { title: t('field.failedRows'), dataIndex: 'failedRows', width: 100 },
    {
      title: t('field.createdAt'),
      dataIndex: 'createdAt',
      width: 170,
      render: (value: string) => formatDate(value),
    },
    {
      title: t('field.actions'),
      key: 'actions',
      width: 120,
      render: (_, job) =>
        job.status === 'pending' || job.status === 'processing' ? (
          <span className="imports-page__muted">-</span>
        ) : (
          <Button type="link" size="small" onClick={() => navigate(`/imports/${job.id}`)}>
            {job.status === 'preview' ? t('action.viewPreview') : t('action.viewDetail')}
          </Button>
        ),
    },
  ]

  const typeCfg = IMPORT_TYPES[importType]

  return (
    <div className="imports-page">
      <Breadcrumb
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
      {list.error && (
        <Alert
          type="error"
          showIcon
          title={t('error.load')}
          description={list.error}
          className="courses-page__notice"
        />
      )}

      <div className="imports-page__upload">
        <Select
          id="import-type"
          className="imports-page__type-select"
          aria-label={t('upload.typeLabel')}
          value={importType}
          onChange={setImportType}
          options={Object.keys(IMPORT_TYPES).map((value) => ({
            value,
            label: t('types.' + value + '.label'),
          }))}
        />
        <Upload
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          maxCount={1}
          fileList={
            selectedFile
              ? [{ uid: 'selected', name: selectedFile.name, status: 'done' as const }]
              : []
          }
          beforeUpload={(file) => {
            setSelectedFile(file)
            return false
          }}
          onRemove={() => setSelectedFile(null)}
        >
          <Button icon={<UploadOutlined />}>{t('upload.chooseFile')}</Button>
        </Upload>
        <Button
          type="primary"
          onClick={handleUpload}
          disabled={!selectedFile}
          loading={uploading}
        >
          {uploading ? t('upload.uploading') : t('upload.button')}
        </Button>
      </div>
      {uploadError && (
        <Alert
          type="error"
          showIcon
          title={t('upload.error')}
          description={uploadError}
          className="imports-page__upload-err"
        />
      )}

      <p className="imports-page__schema">
        <strong>{typeLabel(importType)}</strong>
        {t('schemaIntroTail')}
        <code>{typeCfg?.schema}</code>
      </p>
      <p className="imports-page__note">{t('types.' + importType + '.note')}</p>

      <div className="ds-table-toolbar">
        <span className="ds-table-toolbar__title">{t('table.title')}</span>
        <span className="ds-table-toolbar__hint">{t('table.description', { count: list.total })}</span>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder={t('table.searchPlaceholder')}
          value={list.q}
          onChange={(e) => list.setQ(e.target.value)}
          className="ds-table-toolbar__search"
        />
      </div>

      <Table<ImportJob>
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={list.items}
        loading={loading}
        pagination={false}
        scroll={{ x: 1080 }}
        locale={{ emptyText: list.q ? t('empty.search') : t('empty.none') }}
      />

      <ListPagination
        page={list.page}
        pageSize={list.pageSize}
        totalItems={list.total}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
      />
    </div>
  )
}
