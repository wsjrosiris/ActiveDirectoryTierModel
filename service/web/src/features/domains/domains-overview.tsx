import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRightLeft, Hourglass, Loader2, Network, ScanSearch, ShieldUser, Sparkles } from 'lucide-react'
import { domainsApi, type DomainOverview } from '@/api/domains'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatRelative } from '@/lib/utils'
import { useDomains } from './domain-context'
import { t } from '@/i18n'

function scoreTone(score: number | undefined) {
  if (score === undefined) return 'text-muted-foreground'
  return score >= 90 ? 'text-emerald-600 dark:text-emerald-400' : score >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'
}

/** "Alle Domänen": compliance and last runs per enabled domain; a click switches the domain (roadmap 17). */
export function DomainsOverviewCard() {
  const { multiple, current, switchTo } = useDomains()
  const q = useQuery({ queryKey: ['domains', 'overview'], queryFn: domainsApi.overview, enabled: multiple, refetchInterval: 60_000, meta: { silent: true } })
  if (!multiple) return null

  return (
    <Card className="mb-4 overflow-hidden" data-testid="domains-overview">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Network className="size-4 text-muted-foreground" />
          <div>
            <CardTitle>{t('domains.domainsOverview.allDomains')}</CardTitle>
            <CardDescription>{t('domains.domainsOverview.complianceAndRecentRunsPer')}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
        {q.isLoading || !q.data
          ? [0, 1].map((i) => <Skeleton key={i} className="h-32" />)
          : q.data.map((d) => <DomainTile key={d.id} d={d} active={d.key === current?.key} onSelect={() => void switchTo(d.key)} />)}
      </div>
    </Card>
  )
}

function DomainTile({ d, active, onSelect }: { d: DomainOverview; active: boolean; onSelect: () => void }) {
  const tiers = [0, 1, 2].map((tt) => d.compliance?.find((c) => c.tier === tt)?.score)
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={active}
      aria-current={active || undefined}
      className={cn(
        'group grid min-w-0 gap-3 rounded-lg border bg-card p-3.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'border-primary/50 ring-1 ring-primary/30' : 'hover:border-input hover:bg-accent/40',
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="grid min-w-0">
          <span className="truncate font-medium">{d.displayName}</span>
          <span className="truncate text-xs text-muted-foreground">{d.dnsName || d.key}</span>
        </div>
        {active ? (
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{t('domains.domainsOverview.current')}</span>
        ) : (
          <ArrowRightLeft className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {tiers.map((score, tt) => (
          <div key={tt} className="rounded-md bg-muted/50 px-2 py-1.5">
            <p className="text-[10.5px] text-muted-foreground">{t('domains.domainsOverview.tier')} {tt}</p>
            <p className={cn('text-base font-semibold tabular', scoreTone(score))}>{score ?? '–'}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-1 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <ScanSearch className="size-3.5 shrink-0" />
          <span className="truncate">
            {d.lastAudit
              ? `${t('domains.domainsOverview.auditAt', { at: formatRelative(d.lastAudit.at) })}${d.lastAudit.driftCount ? t('domains.domainsOverview.withDeviations', { count: d.lastAudit.driftCount }) : d.lastAudit.status === 'Succeeded' ? t('domains.domainsOverview.noDeviation') : t('domains.domainsOverview.failed')}`
              : t('domains.domainsOverview.noAuditYet')}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <ShieldUser className="size-3.5 shrink-0" />
          <span className="truncate">{d.lastMonitor ? t('domains.domainsOverview.monitoringAt', { at: formatRelative(d.lastMonitor.at) }) : t('domains.domainsOverview.noMonitoringYet')}</span>
        </span>
      </div>
      {(d.pendingApprovals > 0 || d.active > 0 || d.setupNeeded) && (
        <div className="flex flex-wrap gap-1.5">
          {d.pendingApprovals > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
              <Hourglass className="size-3" /> {d.pendingApprovals} {t('domains.domainsOverview.approval')}{d.pendingApprovals === 1 ? '' : 'n'}
            </span>
          )}
          {d.active > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">
              <Loader2 className="size-3 animate-spin" /> {d.active} {t('domains.domainsOverview.active')}
            </span>
          )}
          {d.setupNeeded && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">
              <Sparkles className="size-3" /> {t('domains.domainsOverview.sampleConfiguration')}
            </span>
          )}
          {d.lastAudit?.status === 'Failed' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">
              <AlertTriangle className="size-3" /> {t('domains.domainsOverview.auditFailed')}
            </span>
          )}
        </div>
      )}
    </button>
  )
}
