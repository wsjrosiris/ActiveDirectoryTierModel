import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  FileClock,
  FolderCog,
  HardDrive,
  History,
  KeyRound,
  ListOrdered,
  RefreshCw,
  ShieldCheck,
  Terminal,
  XCircle,
} from 'lucide-react'
import { api } from '@/api/client'
import type { HealthItem, HealthStatus } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Page, PageHeader } from '@/components/shared/page-header'
import { RequireAuth } from '@/features/auth/auth'
import { errorMessage } from '@/lib/query'
import { cn, formatDateTime, formatRelative } from '@/lib/utils'
import { t } from '@/i18n'

export function Component() {
  return (
    <RequireAuth role="Admin">
      <HealthPage />
    </RequireAuth>
  )
}

const itemIcons: Record<string, React.ReactNode> = {
  app: <Cpu />,
  certificate: <ShieldCheck />,
  database: <Database />,
  queue: <ListOrdered />,
  lastRuns: <History />,
  workPath: <HardDrive />,
  pwsh: <Terminal />,
  framework: <FolderCog />,
  workers: <Activity />,
  dataProtection: <KeyRound />,
  changelog: <FileClock />,
}

const statusMeta: Record<HealthStatus, { label: string; dot: string; ring: string; chip: string; icon: React.ReactNode }> = {
  ok: {
    label: t('admin.health.ok'),
    dot: 'bg-emerald-500',
    ring: 'border-border',
    chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    icon: <CheckCircle2 />,
  },
  warn: {
    label: t('admin.health.warning'),
    dot: 'bg-amber-500',
    ring: 'border-amber-500/40',
    chip: 'bg-amber-500/10 text-amber-800 dark:text-amber-300',
    icon: <AlertTriangle />,
  },
  error: {
    label: t('admin.health.error'),
    dot: 'bg-rose-500',
    ring: 'border-rose-500/50',
    chip: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
    icon: <XCircle />,
  },
}

const order: Record<HealthStatus, number> = { error: 0, warn: 1, ok: 2 }

function HealthPage() {
  const q = useQuery({ queryKey: ['health'], queryFn: api.health.details, refetchInterval: 30_000 })
  const d = q.data
  const counts = d ? { error: d.items.filter((i) => i.status === 'error').length, warn: d.items.filter((i) => i.status === 'warn').length } : null
  // Problems first, otherwise the order of the service.
  const items = d ? [...d.items].sort((a, b) => order[a.status] - order[b.status]) : []

  return (
    <Page>
      <PageHeader
        icon={<Activity />}
        title={t('admin.health.systemHealth')}
        description={t('admin.health.stateOfTheServiceIts')}
        actions={
          <Button variant="outline" onClick={() => q.refetch()} loading={q.isFetching}>
            {!q.isFetching && <RefreshCw />} {t('admin.health.checkAgain')}
          </Button>
        }
      />
      {q.error && !d ? (
        <Card className="border-rose-500/40 px-5 py-4 text-sm text-rose-800 dark:text-rose-200">{t('admin.health.theSystemHealthCouldNot')} {errorMessage(q.error)}</Card>
      ) : !d || !counts ? (
        <div className="grid gap-4">
          <Skeleton className="h-24" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-48" />)}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          <Card className={cn('relative overflow-hidden', statusMeta[d.status].ring)}>
            <div
              aria-hidden
              className={cn(
                'pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b to-transparent',
                d.status === 'ok' ? 'from-emerald-500/[0.07]' : d.status === 'warn' ? 'from-amber-500/[0.09]' : 'from-rose-500/[0.09]',
              )}
            />
            <div className="relative flex flex-wrap items-center gap-4 p-5">
              <TrafficLight status={d.status} />
              <div className="min-w-0 flex-1 basis-60">
                <h2 className="text-base font-semibold tracking-tight">
                  {d.status === 'ok'
                    ? t('admin.health.allOk')
                    : [counts.error && t('admin.health.errors', { count: counts.error }), counts.warn && t('admin.health.warnings', { count: counts.warn })]
                        .filter(Boolean)
                        .join(t('admin.health.and'))}
                </h2>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {t('admin.health.checkSummary', { count: d.items.length, version: d.version, checked: formatRelative(d.checkedAt) })}{' '}
                  <span className="hidden sm:inline">({formatDateTime(d.checkedAt)})</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {(['ok', 'warn', 'error'] as HealthStatus[]).map((s) => (
                  <span key={s} className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium [&_svg]:size-3.5', statusMeta[s].chip)}>
                    {statusMeta[s].icon}
                    {d.items.filter((i) => i.status === s).length} {statusMeta[s].label}
                  </span>
                ))}
              </div>
            </div>
          </Card>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => <HealthCard key={item.key} item={item} />)}
          </div>
        </div>
      )}
    </Page>
  )
}

/** Three lamps; the one matching the status is lit. */
function TrafficLight({ status, small }: { status: HealthStatus; small?: boolean }) {
  const lamps: HealthStatus[] = ['error', 'warn', 'ok']
  return (
    <span
      role="img"
      aria-label={t('admin.health.statusLabel', { label: statusMeta[status].label })}
      className={cn('flex shrink-0 flex-col items-center rounded-full border bg-muted/60 dark:bg-muted/30', small ? 'gap-1 p-1' : 'gap-1.5 p-1.5')}
    >
      {lamps.map((l) => (
        <span
          key={l}
          className={cn(
            'rounded-full transition-colors',
            small ? 'size-2' : 'size-3',
            l === status ? cn(statusMeta[l].dot, 'shadow-[0_0_8px] shadow-current') : 'bg-muted-foreground/20',
            l === status && (l === 'ok' ? 'text-emerald-500/60' : l === 'warn' ? 'text-amber-500/60' : 'text-rose-500/60'),
          )}
        />
      ))}
    </span>
  )
}

function HealthCard({ item }: { item: HealthItem }) {
  const m = statusMeta[item.status]
  return (
    <Card className={cn('flex flex-col', m.ring)} aria-label={item.title}>
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <span className="grid size-9 shrink-0 place-content-center rounded-lg border bg-card text-muted-foreground [&_svg]:size-4">{itemIcons[item.key] ?? <Activity />}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-sm font-semibold">{item.title}</h3>
            <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium [&_svg]:size-3', m.chip)}>
              <span className={cn('size-1.5 rounded-full', m.dot)} aria-hidden />
              {m.label}
            </span>
          </div>
          <p className={cn('mt-1 text-[13px]', item.status === 'ok' ? 'text-muted-foreground' : 'text-foreground')}>{item.message}</p>
        </div>
      </div>
      {item.facts.length > 0 && (
        <dl className="mt-auto grid gap-x-3 gap-y-1 border-t bg-muted/20 px-4 py-3 text-xs grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,max-content)_minmax(0,1fr)]">
          {item.facts.map((f) => (
            <React.Fragment key={f.label}>
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className={cn('min-w-0 break-words', /[\\/]|^[0-9A-F]{40}$|^[0-9a-f]{64}$|^S-1-/.test(f.value) && 'font-mono text-[11.5px] break-all')}>{f.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </Card>
  )
}
