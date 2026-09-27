import { useEffect, useState } from 'react'
import { InlineNotification } from '@carbon/react'
import type { TFunction } from 'i18next'
import ListPagination from './ListPagination'
import { apiFetch } from '../auth/api'
import i18n from '../i18n/index'
import type { ImportJob, ImportRowError } from '../types/api'

// IMPORT_TYPES describes each business-table import: the xlsx header contract
// (order-independent, matched by name - kept literal as a backend contract),
// and the preview column keys used to render the dry-run rows. The column keys
// mirror the toPreviewMap() keys produced by each backend importer and double
// as i18n keys under imports.columns.<type>.<key>. Shared by ImportsPage and
// the SplitWizard so the contract lives in one place.
export const IMPORT_TYPES: Record<string, { schema: string; columns: string[] }> = {
  sessions: {
    schema: 'date, period_start, period_end, classroom, course, teaching_class, semester, note',
    columns: ['date', 'periodStart', 'periodEnd', 'classroom', 'course', 'teachingClass', 'semester', 'note'],
  },
  classrooms: {
    schema: 'name, building, capacity, type, floor, campus, status, description',
    columns: ['name', 'building', 'capacity', 'type', 'floor', 'campus', 'status', 'description'],
  },
  admin_classes: {
    schema: 'grade, name, note',
    columns: ['grade', 'name', 'note'],
  },
  teaching_classes: {
    schema: 'name, note, admin_grade, admin_name',
    columns: ['name', 'note', 'admin_classes'],
  },
  catalog: {
    schema: 'name, code, credits, total_hours, category, exam_type, description',
    columns: ['name', 'code', 'credits', 'totalHours', 'category', 'examType', 'description'],
  },
  offerings: {
    schema: 'course, teaching_class, semester, teacher, course_seq, teacher_id, teacher_title, college, max_students, requirement, weekly_hours, note',
    columns: ['course', 'teachingClass', 'semester', 'teacher', 'courseSeq', 'teacherId', 'teacherTitle', 'college', 'maxStudents', 'requirement', 'weeklyHours', 'note'],
  },
  regimes: {
    schema: 'regime_name, effective_month, effective_day, period_index, start_time, end_time',
    columns: ['name', 'effectiveMonth', 'effectiveDay', 'periods'],
  },
  bookings: {
    schema: 'classroom, username, date, period_start, period_end, status, purpose',
    columns: ['classroom', 'username', 'date', 'periodStart', 'periodEnd', 'status', 'purpose'],
  },
}

// A regime period inside a preview cell (importer toPreviewMap).
interface RegimePeriod {
  periodIndex: number
  startTime: string
  endTime: string
}

// formatCell renders a preview cell value. Arrays (teaching-class members,
// regime periods) are joined into a readable string; other values pass through.
export function formatCell(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return ''
    // Regime periods are objects {periodIndex, startTime, endTime}; teaching
    // class members are plain label strings. Detect by element type.
    const sep = (i18n.language || 'zh-CN').startsWith('zh') ? '，' : ', '
    if (typeof value[0] === 'object' && value[0] !== null) {
      return (value as RegimePeriod[])
        .map((p) => `${p.periodIndex}(${p.startTime}-${p.endTime})`)
        .join(sep)
    }
    return (value as string[]).join(sep)
  }
  if (value === null || value === undefined) return ''
  return String(value)
}

export interface ImportPreviewTableProps {
  job: ImportJob | null | undefined
  token?: string | null
  t: TFunction
}

// jobKey derives the preview "version" of a job: any change to identity,
// status or row counts (reanalyze bumps startedAt/succeededRows, commit
// changes status) produces a new key, so stale rows are never rendered
// across a reanalyze of the same job id.
const jobKey = (j: ImportJob | null | undefined) =>
  j ? `${j.id}:${j.status}:${j.startedAt ?? ''}:${j.succeededRows ?? ''}` : ''

// ImportPreviewTable renders the dry-run rows for one job, fetching pages from
// the server (GET /api/imports/{id}/rows) so a multi-thousand-row preview is
// not shipped in full. `job` is the job metadata (status / counts) and carries
// neither rows nor the per-row error report; rows are fetched page-by-page
// below, and the error list is fetched on demand from
// GET /api/imports/{id}/errors (it can be several MB for a sessions job whose
// rows all fail, so it is not piggybacked on the polled job meta). `t` is the
// 'imports'-namespace translator from the host.
export default function ImportPreviewTable({ job, token, t }: ImportPreviewTableProps) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [rowsJobKey, setRowsJobKey] = useState('') // rows 所属 job 版本键：与当前 key 不一致时不渲染旧数据
  const [fetchFailed, setFetchFailed] = useState(false)
  const [errors, setErrors] = useState<ImportRowError[]>([])
  const [errorsLoaded, setErrorsLoaded] = useState(false)

  // 合成列：行号在最前（与错误报告「第 N 行」同一坐标系——均为源 xlsx 的
  // Excel 行号，表头为第 1 行），六个拆分产物类型额外渲染拆分器透传的源表
  // 行号（教务处原始文件 Excel 行号，手工上传缺失/0 显示空）。旧任务的预览行
  // 没有这些键，渲染为空，自然降级。列头走 columns.common.*，不进 IMPORT_TYPES
  // 的按类型契约。key 必须与后端 toPreviewMap 输出的键名一致
  // （rowNum/sourceRow，无下划线），否则取值恒为 undefined、单元格全空。
  const SOURCE_ROW_TYPES = ['sessions', 'classrooms', 'catalog', 'admin_classes', 'teaching_classes', 'offerings']
  const showSourceRow = !!job?.type && SOURCE_ROW_TYPES.includes(job.type)
  const columns = [
    { key: 'rowNum', header: t('columns.common.rowNum', { defaultValue: '行号' }) },
    ...(showSourceRow ? [{ key: 'sourceRow', header: t('columns.common.sourceRow', { defaultValue: '源表行号' }) }] : []),
    ...(job && IMPORT_TYPES[job.type]?.columns ? IMPORT_TYPES[job.type]!.columns : [])
      .map((key) => ({ key, header: t(`columns.${job?.type}.${key}`, { defaultValue: key }) })),
  ]

  useEffect(() => {
    if (!job?.id) return undefined
    let cancelled = false
    setFetchFailed(false) // 每次发起请求前重置失败态
    if (job.status === 'processing') {
      // 重分析期间清掉旧预览与旧错误，避免展示已被重新处理覆盖的数据。
      setRows([])
      setTotal(0)
      setErrors([])
    }
    setLoading(true)
    ;(async () => {
      try {
        const data = await apiFetch<{ rows?: Array<Record<string, unknown>>; total?: number }>(
          `/api/imports/${job.id}/rows?page=${page}&pageSize=${pageSize}`,
          { token },
        )
        if (cancelled) return
        const nextRows = Array.isArray(data?.rows) ? data.rows : []
        const nextTotal = data?.total ?? 0
        setRows(nextRows)
        setTotal(nextTotal)
        setFetchFailed(false)
        // 仅在成功后盖章：发起请求时的 key 与返回数据严格对应；失败不盖章，
        // rowsJobKey 保持旧值并展示明确的错误通知而非“无数据”。
        setRowsJobKey(jobKey(job))
        // If the current page is out of range (e.g. switched to a smaller job
        // while on page > 1, or a reanalyze shrank the preview), jump back to
        // page 1 so the operator isn't staring at an empty table.
        if (page > 1 && nextTotal > 0 && (page - 1) * pageSize >= nextTotal) {
          setPage(1)
        }
      } catch {
        if (!cancelled) {
          setRows([])
          setTotal(0)
          setFetchFailed(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // Re-fetch when the job's preview "version" (identity/status/startedAt/
    // succeededRows via jobKey) changes, or on page change. Polled meta during
    // processing keeps these primitives stable, so polling does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobKey(job), page, pageSize])

  // Fetch the per-row error report on demand. error_report can be several MB
  // for a sessions job whose rows all fail, so the polled job meta no longer
  // carries it; fetch it here, refetched only when the preview "version"
  // (jobKey, same primitives as the rows effect) changes - never on each
  // meta poll.
  useEffect(() => {
    if (!job?.id) return undefined
    if (job.status === 'processing') {
      // 重分析期间 error_report 仍是旧值，清空并短路；转出 processing 后
      // 本 effect 因依赖变化重新执行，正常拉取新报告。
      setErrors([])
      setErrorsLoaded(false)
      return undefined
    }
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiFetch<{ errors?: ImportRowError[] }>(`/api/imports/${job.id}/errors`, { token })
        if (cancelled) return
        setErrors(Array.isArray(data?.errors) ? data.errors : [])
      } catch {
        if (!cancelled) setErrors([])
      } finally {
        if (!cancelled) setErrorsLoaded(true)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobKey(job)])

  const lastPage = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, lastPage)

  const rowsAreCurrent = rowsJobKey === jobKey(job)
  const emptyTitle = !fetchFailed
    ? job?.status === 'processing'
      ? t('modal.loadingPreview')
      : (job?.failedRows ?? 0) > 0 && (job?.succeededRows ?? 0) === 0
        ? t('modal.emptyPreviewAllFailed')
        : t('modal.emptyPreview')
    : ''

  return (
    <>
      {fetchFailed ? (
        <InlineNotification
          kind="error"
          title={t('modal.previewFetchFailed')}
          lowContrast
          hideCloseButton
          className="imports-page__upload-err"
        />
      ) : !rowsAreCurrent || (loading && rows.length === 0) ? (
        <p className="imports-page__summary">{t('modal.loadingPreview')}</p>
      ) : rows.length > 0 ? (
        <div className="imports-page__rows">
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key}>{c.header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.key}>
                      {/* 合成行号列：sourceRow 为 0（手工上传/无溯源信息）显示空；
                          其余列走通用格式化。 */}
                      {c.key === 'rowNum'
                        ? String(r.rowNum ?? '')
                        : c.key === 'sourceRow'
                          ? (r.sourceRow ? String(r.sourceRow) : '')
                          : formatCell(r[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <InlineNotification
          kind="info"
          title={emptyTitle}
          lowContrast
          hideCloseButton
          className="imports-page__upload-err"
        />
      )}

      {total > 0 && (
        <ListPagination
          page={safePage}
          pageSize={pageSize}
          totalItems={total}
          onPageChange={(p) => setPage(p)}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
        />
      )}

      <ul className="imports-page__errors">
        {errors.map((e, i) => (
          <li key={i}>
            {e.row > 0 ? t('modal.errorRow', { row: e.row }) : ''}
            {e.error}
          </li>
        ))}
        {errorsLoaded && errors.length === 0 && <li>{t('modal.noErrors')}</li>}
      </ul>
    </>
  )
}
