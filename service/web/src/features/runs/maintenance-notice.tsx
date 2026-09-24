import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { CalendarCheck2, CalendarClock, OctagonX } from 'lucide-react'
import { opsApi, type MaintenanceStatus } from '@/api/ops'
import { useCan } from '@/features/auth/auth'
import { cn, formatDateTime, formatRelative } from '@/lib/utils'
import { t } from '@/i18n'
import { rich } from '@/i18n/rich'

export const maintenanceStatusQuery = {
  queryKey: ['maintenance', 'status'],
  queryFn: opsApi.maintenance.status,
  refetchInterval: 60_000,
  staleTime: 20_000,
}

/** Whether an apply requested now is rejected (active freeze). */
export function applyBlockedByFreeze(s: MaintenanceStatus | undefined) {
  return !!s?.activeFreeze
}

/** One-line description of what happens with an apply requested now (for dialogs and toasts). */
export function applyTimingText(s: MaintenanceStatus | undefined): string | null {
  if (!s) return null
  if (s.activeFreeze) return t('runs.maintenanceNotice.freezeTiming', { reason: s.activeFreeze.reason, to: formatDateTime(s.activeFreeze.to) })
  if (s.allowedNow) return null
  return s.nextStart
    ? s.nextWindow
      ? t('runs.maintenanceNotice.scheduledWindow', { start: formatDateTime(s.nextStart), window: s.nextWindow.name })
      : t('runs.maintenanceNotice.scheduledAt', { start: formatDateTime(s.nextStart) })
    : t('runs.maintenanceNotice.scheduledNext')
}

/**
 * Shown before an apply: active freeze, open window, or when the apply would start.
 * Nothing when neither windows nor freezes restrict applies.
 */
export function MaintenanceNotice({ className, compact }: { className?: string; compact?: boolean }) {
  const q = useQuery(maintenanceStatusQuery)
  const isAdmin = useCan('Admin')
  const s = q.data
  if (!s) return null
  const link = isAdmin && !compact && (
    <Link to="/admin/wartungsfenster" className="font-medium underline underline-offset-2">{t('runs.maintenanceNotice.manageMaintenanceWindows')}</Link>
  )
  if (s.activeFreeze)
    return (
      <div role="alert" className={cn('flex gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-900 dark:text-rose-200', className)}>
        <OctagonX className="size-4 shrink-0" />
        <span>
          {rich(t('runs.maintenanceNotice.freezeActive', { to: formatDateTime(s.activeFreeze.to), rel: formatRelative(s.activeFreeze.to) }), {
            title: <span className="font-medium">{t('runs.maintenanceNotice.freezeTitle', { reason: s.activeFreeze.reason })}</span>,
          })}{' '}
          {link}
        </span>
      </div>
    )
  if (!s.restricted) return null
  if (s.allowedNow && s.currentWindow)
    return (
      <div className={cn('flex gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-900 dark:text-emerald-200', className)}>
        <CalendarCheck2 className="size-4 shrink-0" />
        <span>
          {rich(t('runs.maintenanceNotice.windowOpen', { end: formatDateTime(s.currentWindow.end) }), {
            title: <span className="font-medium">{t('runs.maintenanceNotice.windowOpenTitle', { name: s.currentWindow.name })}</span>,
          })}{' '}
          {link}
        </span>
      </div>
    )
  return (
    <div className={cn('flex gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-sky-900 dark:text-sky-200', className)}>
      <CalendarClock className="size-4 shrink-0" />
      <span>
        <span className="font-medium">{t('runs.maintenanceNotice.outside')}</span>{' '}
        {s.nextStart ? (
          rich(t(s.nextWindow ? 'runs.maintenanceNotice.startsInWindow' : 'runs.maintenanceNotice.starts', { window: s.nextWindow?.name ?? '' }), { at: <strong>{formatDateTime(s.nextStart)}</strong> })
        ) : (
          t('runs.maintenanceNotice.noMaintenanceWindowIsCurrently')
        )}{' '}
        {link}
      </span>
    </div>
  )
}
