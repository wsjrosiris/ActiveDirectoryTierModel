import { Ban, CheckCircle2, Clock, Loader2, XCircle, Rocket, ScanSearch, CalendarClock, Hourglass, ShieldX, ShieldUser } from 'lucide-react'
import type { RunKind, RunStatus, RunSummary } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { severityLabels, statusLabels } from '@/lib/labels'
import { tierMeta, tierOf, type Tier } from '@/lib/tier'
import { cn, formatDateShort } from '@/lib/utils'

export function TierBadge({ tier, className, short }: { tier: Tier; className?: string; short?: boolean }) {
  if (tier === null) return null
  const m = tierMeta[tier]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold leading-4 whitespace-nowrap',
        m.badge,
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', m.dot)} aria-hidden />
      {short ? m.short : m.label}
    </span>
  )
}

export function TierBadgeFor({ text, className, short }: { text: string | null | undefined; className?: string; short?: boolean }) {
  return <TierBadge tier={tierOf(text)} className={className} short={short} />
}

export function TierDot({ tier, className }: { tier: Tier; className?: string }) {
  return (
    <span
      className={cn('inline-block size-2 shrink-0 rounded-full', tier === null ? 'bg-muted-foreground/40' : tierMeta[tier].dot, className)}
      aria-hidden
    />
  )
}

const statusStyle: Record<RunStatus, { variant: 'success' | 'danger' | 'info' | 'muted' | 'warning'; icon: React.ReactNode }> = {
  AwaitingApproval: { variant: 'warning', icon: <Hourglass /> },
  Queued: { variant: 'muted', icon: <Clock /> },
  Running: { variant: 'info', icon: <Loader2 className="animate-spin" /> },
  Succeeded: { variant: 'success', icon: <CheckCircle2 /> },
  Failed: { variant: 'danger', icon: <XCircle /> },
  Cancelled: { variant: 'muted', icon: <Ban /> },
  Rejected: { variant: 'danger', icon: <ShieldX /> },
  Scheduled: { variant: 'info', icon: <CalendarClock /> },
}

export function RunStatusBadge({ status, className, scheduledFor }: { status: RunStatus; className?: string; scheduledFor?: string | null }) {
  const s = statusStyle[status]
  return (
    <Badge variant={s.variant} className={className}>
      {s.icon}
      {status === 'Scheduled' && scheduledFor ? `Geplant für ${formatDateShort(scheduledFor)}` : statusLabels[status]}
    </Badge>
  )
}

export function RunKindLabel({ run, className }: { run: Pick<RunSummary, 'kind' | 'mode' | 'trigger'>; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', className)}>
      <RunKindIcon kind={run.kind} />
      {runKindText(run)}
      {run.trigger === 'Schedule' && (
        <CalendarClock className="size-3.5 text-muted-foreground" aria-label="Geplant" />
      )}
    </span>
  )
}

/** "Deploy", "Deploy (Plan)", "Audit" or "Überwachung". */
export function runKindText(run: Pick<RunSummary, 'kind' | 'mode'>) {
  return run.kind === 'Deploy' ? (run.mode === 'Apply' ? 'Deploy' : 'Deploy (Plan)') : run.kind === 'Monitor' ? 'Überwachung' : 'Audit'
}

export function RunKindIcon({ kind, className }: { kind: RunKind; className?: string }) {
  if (kind === 'Monitor')
    return (
      <span className={cn('grid size-6 place-content-center rounded-md bg-teal-500/10 text-teal-600 dark:text-teal-300', className)}>
        <ShieldUser className="size-3.5" />
      </span>
    )
  return kind === 'Deploy' ? (
    <span className={cn('grid size-6 place-content-center rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-300', className)}>
      <Rocket className="size-3.5" />
    </span>
  ) : (
    <span className={cn('grid size-6 place-content-center rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-300', className)}>
      <ScanSearch className="size-3.5" />
    </span>
  )
}

export function DriftBadge({ count, monitor }: { count: number | null; monitor?: boolean }) {
  if (count === null || count === undefined) return <span className="text-muted-foreground">–</span>
  if (count === 0)
    return (
      <Badge variant="success">
        <CheckCircle2 /> {monitor ? 'Unauffällig' : 'Kein Drift'}
      </Badge>
    )
  if (monitor) return <Badge variant="warning">{count} Auffälligkeit{count === 1 ? '' : 'en'}</Badge>
  return <Badge variant="danger">{count} Abweichung{count === 1 ? '' : 'en'}</Badge>
}

const severityStyle: Record<string, string> = {
  High: 'border-rose-600/15 bg-rose-500/10 text-rose-700 dark:border-rose-400/20 dark:text-rose-300',
  Medium: 'border-amber-600/15 bg-amber-500/10 text-amber-800 dark:border-amber-400/20 dark:text-amber-300',
  Low: 'border-sky-600/15 bg-sky-500/10 text-sky-700 dark:border-sky-400/20 dark:text-sky-300',
}

export function SeverityBadge({ severity, className }: { severity: string | null | undefined; className?: string }) {
  const s = severity && severityStyle[severity] ? severity : 'Medium'
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium leading-4 whitespace-nowrap', severityStyle[s], className)}>
      <span className={cn('size-1.5 rounded-full', s === 'High' ? 'bg-rose-500' : s === 'Medium' ? 'bg-amber-500' : 'bg-sky-500')} aria-hidden />
      {severityLabels[s]}
    </span>
  )
}
