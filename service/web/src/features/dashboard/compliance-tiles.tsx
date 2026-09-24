import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { AlertTriangle, CheckCircle2, Gauge, Info, XCircle } from 'lucide-react'
import { api } from '@/api/client'
import type { Compliance, TierCompliance } from '@/api/types'
import { Card } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { TierBadge } from '@/components/shared/badges'
import { cn, formatRelative } from '@/lib/utils'
import { t } from '@/i18n'

const Sparkline = React.lazy(() => import('./compliance-sparkline'))

/** Status of a score: text and icon carry the meaning, color only supports it. */
function band(score: number) {
  if (score >= 90) return { label: t('dashboard.complianceTiles.good'), icon: <CheckCircle2 />, text: 'text-emerald-700 dark:text-emerald-400', ring: 'border-emerald-500/30', bar: 'bg-emerald-500' }
  if (score >= 70) return { label: t('dashboard.complianceTiles.needsImprovement'), icon: <AlertTriangle />, text: 'text-amber-700 dark:text-amber-400', ring: 'border-amber-500/30', bar: 'bg-amber-500' }
  return { label: t('dashboard.complianceTiles.critical'), icon: <XCircle />, text: 'text-rose-700 dark:text-rose-400', ring: 'border-rose-500/30', bar: 'bg-rose-500' }
}

const categoryLabels: Record<string, string> = {
  audit: t('dashboard.complianceTiles.audit'),
  unexpected: t('dashboard.complianceTiles.members'),
  hygiene: t('dashboard.complianceTiles.hygiene'),
  attackPath: t('dashboard.complianceTiles.attackPaths'),
}

export function ComplianceTiles() {
  const q = useQuery({ queryKey: ['compliance'], queryFn: api.compliance, refetchInterval: 120_000 })
  const data = q.data

  return (
    <section aria-label={t('dashboard.complianceTiles.complianceScorePerTier')} className="mt-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Gauge className="size-4 text-muted-foreground" /> {t('dashboard.complianceTiles.complianceScore')}</h2>
        {data && (data.audit || data.monitor) && (
          <p className="text-xs text-muted-foreground">
            {t('dashboard.complianceTiles.basedOn')}{' '}
            {data.audit ? <Link to={`/laeufe/${data.audit.runId}`} className="hover:text-foreground hover:underline">{t('dashboard.complianceTiles.audit')} {formatRelative(data.audit.at)}</Link> : t('dashboard.complianceTiles.noAudit')}
            {' · '}
            {data.monitor ? <Link to="/privilegiert" className="hover:text-foreground hover:underline">{t('dashboard.complianceTiles.monitoring')} {formatRelative(data.monitor.at)}</Link> : t('dashboard.complianceTiles.noMonitoring')}
          </p>
        )}
      </div>
      {q.isLoading ? (
        <div className="grid gap-3 md:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-36" />)}</div>
      ) : !data?.current ? (
        <Card className="flex flex-wrap items-center gap-3 px-5 py-4 text-[13px] text-muted-foreground">
          <Gauge className="size-5 shrink-0" />
          <span className="min-w-0 flex-1">{t('dashboard.complianceTiles.theComplianceScoreIsDerived')}</span>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {data.current.map((tt) => <TierTile key={tt.tier} tier={tt} data={data} />)}
        </div>
      )}
    </section>
  )
}

function TierTile({ tier, data }: { tier: TierCompliance; data: Compliance }) {
  const b = band(tier.score)
  const key = `tier${tier.tier}` as const
  const history = data.history.map((h) => ({ date: h.date, score: h[key] }))
  const hasHistory = history.filter((h) => h.score !== null).length > 1
  return (
    <Card className={cn('flex min-w-0 flex-col p-4', b.ring)}>
      <div className="flex items-center justify-between gap-2">
        <TierBadge tier={tier.tier} />
        <span className={cn('inline-flex items-center gap-1 text-xs font-medium [&_svg]:size-3.5', b.text)}>{b.icon} {b.label}</span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="text-[32px] leading-10 font-semibold tracking-tight tabular">
          {tier.score}
          <span className="text-sm font-normal text-muted-foreground"> / 100</span>
        </p>
        <div className="h-12 min-w-0 flex-1" aria-label={t('dashboard.complianceTiles.historyOfTheLast30', { tier: tier.tier })}>
          {hasHistory ? (
            <React.Suspense fallback={null}>
              <Sparkline data={history} id={`t${tier.tier}`} />
            </React.Suspense>
          ) : (
            <p className="pt-5 text-right text-[11px] text-muted-foreground">{t('dashboard.complianceTiles.historyFromTheSecondDay')}</p>
          )}
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={cn('h-full rounded-full', b.bar)} style={{ width: `${tier.score}%` }} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{tier.deductions.length === 0 ? t('dashboard.complianceTiles.noDeductions') : t('dashboard.complianceTiles.reducePointsDeducted', { reduce: tier.deductions.reduce((s, d) => s + d.points, 0), count: tier.deductions.reduce((s, d) => s + d.points, 0) })}</span>
        <Breakdown tier={tier} data={data} />
      </div>
    </Card>
  )
}

function Breakdown({ tier, data }: { tier: TierCompliance; data: Compliance }) {
  const w = data.weights
  return (
    <Popover>
      <PopoverTrigger className="inline-flex items-center gap-1 rounded text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
        <Info className="size-3.5" /> {t('dashboard.complianceTiles.breakdown')}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">{t('dashboard.complianceTiles.tier')} {tier.tier}: {tier.score} {t('dashboard.complianceTiles.of100')}</p>
          <p className="text-xs text-muted-foreground">{t('dashboard.complianceTiles.startsAt100MinusThe')}</p>
        </div>
        {tier.deductions.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-muted-foreground">{t('dashboard.complianceTiles.noDeductionsNoFindingsFor')}</p>
        ) : (
          <ul className="divide-y">
            {tier.deductions.map((d, i) => (
              <li key={i} className="flex items-start justify-between gap-3 px-4 py-2 text-[13px]">
                <span className="min-w-0">
                  <span className="block">{d.label}</span>
                  <span className="text-xs text-muted-foreground">{categoryLabels[d.category] ?? d.category} {t('dashboard.complianceTiles.each')} {d.pointsEach} {t('dashboard.complianceTiles.points', { count: d.pointsEach })}</span>
                </span>
                <span className="shrink-0 font-medium tabular text-rose-700 dark:text-rose-400">−{d.points}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">{t('dashboard.complianceTiles.weighting')}</p>
          <p>{t('dashboard.complianceTiles.auditDeviationHigh')} {w.auditDrift.High}{t('dashboard.complianceTiles.medium')} {w.auditDrift.Medium}{t('dashboard.complianceTiles.low')} {w.auditDrift.Low} {t('dashboard.complianceTiles.tierFromTheObjectName')}</p>
          <p>{t('dashboard.complianceTiles.unexpectedMember')} {w.unexpectedMember} {t('dashboard.complianceTiles.tier0')}</p>
          <p>{t('dashboard.complianceTiles.hygieneHigh')} {w.hygiene.High}{t('dashboard.complianceTiles.medium')} {w.hygiene.Medium}{t('dashboard.complianceTiles.low')} {w.hygiene.Low} {t('dashboard.complianceTiles.tierOfTheAccount')}</p>
          <p>{t('dashboard.complianceTiles.attackPath')} {w.attackPath} {t('dashboard.complianceTiles.tier0')}</p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
