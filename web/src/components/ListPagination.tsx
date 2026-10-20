import { Pagination } from 'antd'
import { useTranslation } from 'react-i18next'

export interface ListPaginationProps {
  page: number
  pageSize: number
  totalItems: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  className?: string
}

// ListPagination renders the pager for a server-paginated list. The displayed
// page is clamped to the last existing page (a delete can leave page pointing
// past the end). Ant Design reports page and page size together, so the two
// callbacks stay separate here - usePagedList resets to page 1 when the page
// size changes and the two must not be conflated.
//
// This is the single pagination implementation for every list page: the
// Carbon version lived here too, so the migration touched one file.
export default function ListPagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  className,
}: ListPaginationProps) {
  const { t } = useTranslation()
  const lastPage = Math.max(1, Math.ceil(totalItems / pageSize))
  const shown = Math.min(page, lastPage)

  return (
    <Pagination
      className={className}
      current={shown}
      pageSize={pageSize}
      total={totalItems}
      pageSizeOptions={[100, 200, 500]}
      showSizeChanger
      showQuickJumper
      showTotal={(total) => t('pagination.total', { total })}
      onChange={(p, s) => {
        if (s !== pageSize) onPageSizeChange(s)
        else onPageChange(p)
      }}
    />
  )
}
