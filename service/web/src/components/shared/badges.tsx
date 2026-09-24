import { Ban, CheckCircle2, Clock, Loader2, XCircle, Rocket, ScanSearch, CalendarClock } from 'lucide-react'
import type { RunKind, RunStatus, RunSummary } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { statusLabels } from '@/lib/labels'
import { tierMeta, tierOf, type Tier } from '@/lib/tier'
import { cn } from '@/lib/utils'

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
  Queued: { variant: 'muted', icon: <Clock /> },
  Running: { variant: 'info', icon: <Loader2 className="animate-spin" /> },
  Succeeded: { variant: 'success', icon: <CheckCircle2 /> },
  Failed: { variant: 'danger', icon: <XCircle /> },
  Cancelled: { variant: 'warning', icon: <Ban /> },
}

export function RunStatusBadge({ status, className }: { status: RunStatus; className?: string }) {
  const s = statusStyle[status]
  return (
    <Badge variant={s.variant} className={className}>
      {s.icon}
      {statusLabels[status]}
    </Badge>
  )
}

export function RunKindLabel({ run, className }: { run: Pick<RunSummary, 'kind' | 'mode' | 'trigger'>; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', className)}>
      <RunKindIcon kind={run.kind} />
      {run.kind === 'Deploy' ? (run.mode === 'Apply' ? 'Deploy' : 'Deploy (Plan)') : 'Audit'}
      {run.trigger === 'Schedule' && (
        <CalendarClock className="size-3.5 text-muted-foreground" aria-label="Geplant" />
      )}
    </span>
  )
}

export function RunKindIcon({ kind, className }: { kind: RunKind; className?: string }) {
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

export function DriftBadge({ count }: { count: number | null }) {
  if (count === null || count === undefined) return <span className="text-muted-foreground">–</span>
  if (count === 0)
    return (
      <Badge variant="success">
        <CheckCircle2 /> Kein Drift
      </Badge>
    )
  return <Badge variant="danger">{count} Abweichung{count === 1 ? '' : 'en'}</Badge>
}
