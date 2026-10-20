import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import { formatDate } from '../i18n/formatters'

// Shared attendance UI helpers: status labels/colors and the record-status
// Tag used by the list, detail and report pages.

// Record-status enum values, in display order. Labels come from common.status
// so every page reads attendance statuses the same way.
export const STATUS_KEYS = ['present', 'late', 'absent', 'leave'] as const
export type RecordStatus = (typeof STATUS_KEYS)[number]

// Picker option shape shared by the attendance pages' offering/session
// pickers: id is the stringified entity id (options key by string).
export interface PickerOption {
  id: string
  text: string
}

// Ant Design Tag colors per record status: present positive, absent red,
// leave neutral. 'late' uses purple to stay distinguishable from the gray
// leave tag (Ant Design presets have no distinct "warning yellow" label that
// reads well next to red/green).
const STATUS_COLOR: Record<RecordStatus, string> = {
  present: 'green',
  late: 'purple',
  absent: 'red',
  leave: 'default',
}

export function StatusTag({ status }: { status: string }) {
  const { t } = useTranslation('common')
  return <Tag color={STATUS_COLOR[status as RecordStatus] ?? 'default'}>{t(`status.${status}`, { defaultValue: status })}</Tag>
}

export function CheckinStatusTag({ status }: { status: string }) {
  const { t } = useTranslation('attendance')
  return <Tag color={status === 'active' ? 'blue' : 'default'}>{t(`checkinStatus.${status}`, { defaultValue: status })}</Tag>
}

// formatDateTime keeps the year (attendance records span time, so the year
// matters); it is i18n/formatDate with the year always on.
export function formatDateTime(value: string | number | Date | null | undefined): string {
  return formatDate(value)
}
