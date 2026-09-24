import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import {
  AlertTriangle,
  CalendarClock,
  CalendarPlus,
  GitCompareArrows,
  HeartPulse,
  Loader2,
  Play,
  Route,
  ShieldUser,
  UserX,
  Users,
} from 'lucide-react'
import { api } from '@/api/client'
import type { PrivilegedOverview } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Page, PageHeader } from '@/components/shared/page-header'
import { useCan } from '@/features/auth/auth'
import { cn, formatDateTime, formatNumber, formatRelative } from '@/lib/utils'
import { MonitorStartDialog } from './monitor-start'
import { GroupsTab } from './groups-tab'
import { ChangesTab } from './changes-tab'
import { HygieneTab } from './hygiene-tab'
import { AttackPathsTab } from './attack-paths-tab'
import { t } from '@/i18n'

const tabs = ['gruppen', 'aenderungen', 'hygiene', 'angriffspfade'] as const
type Tab = (typeof tabs)[number]

export const privilegedQuery = {
  queryKey: ['privileged', 'overview'],
  queryFn: api.privileged.overview,
}

export function Component() {
  const { tab: tabParam } = useParams()
  const tab: Tab = tabs.includes(tabParam as Tab) ? (tabParam as Tab) : 'gruppen'
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const canOperate = useCan('Operator')
  const [startOpen, setStartOpen] = React.useState(false)
  const q = useQuery({
    ...privilegedQuery,
    // While a monitor run is waiting or running, refresh until its snapshot arrives.
    refetchInterval: (query) => {
      const st = query.state.data?.lastRun?.status
      return st === 'Queued' || st === 'Running' ? 2500 : 60_000
    },
  })
  const data = q.data
  const running = data?.lastRun && (data.lastRun.status === 'Queued' || data.lastRun.status === 'Running')
  const snapshot = data?.snapshot
  const lastFailed = data?.lastRun && data.lastRun.status === 'Failed' && (!snapshot || data.lastRun.id > snapshot.runId) ? data.lastRun : null

  // Command menu: "/privilegiert?check=1" opens the start dialog.
  React.useEffect(() => {
    if (params.get('check') === '1') {
      if (canOperate) setStartOpen(true)
      const p = new URLSearchParams(params)
      p.delete('check')
      setParams(p, { replace: true })
    }
  }, [params, setParams, canOperate])

  const highHygiene = data?.hygiene.filter((h) => h.severity === 'High').length ?? 0

  return (
    <Page wide>
      <PageHeader
        icon={<ShieldUser />}
        title={t('privileged.privileged.privilegedAccess')}
        description={t('privileged.privileged.membersOfTheProtectedAnd')}
        actions={
          <>
            {snapshot && (
              <span className="text-xs text-muted-foreground" title={formatDateTime(snapshot.takenAt)}>
                {t('privileged.privileged.asOf')} {formatRelative(snapshot.takenAt)}
                {snapshot.preferredDc && <> · <span className="font-mono">{snapshot.preferredDc}</span></>}
              </span>
            )}
            {canOperate && (
              <Button onClick={() => setStartOpen(true)} disabled={!!running}>
                {running ? <Loader2 className="animate-spin" /> : <Play />} {running ? t('privileged.privileged.checkRunning') : t('privileged.privileged.checkNow')}
              </Button>
            )}
          </>
        }
      />

      {running && data?.lastRun && (
        <Banner tone="info" icon={<Loader2 className="animate-spin" />}>
          {t(data.lastRun.status === 'Queued' ? 'privileged.privileged.monitorQueued' : 'privileged.privileged.monitorRunning', { id: data.lastRun.id })}{' '}
          <Link to={`/laeufe/${data.lastRun.id}`} className="font-medium underline-offset-2 hover:underline">{t('privileged.privileged.viewLog')}</Link>
        </Banner>
      )}
      {lastFailed && (
        <Banner tone="danger" icon={<AlertTriangle />}>
          {lastFailed.message ? t('privileged.privileged.lastFailedMessage', { id: lastFailed.id, message: lastFailed.message }) : t('privileged.privileged.lastFailed', { id: lastFailed.id })}{' '}
          <Link to={`/laeufe/${lastFailed.id}`} className="font-medium underline-offset-2 hover:underline">{t('privileged.privileged.details')}</Link>
        </Banner>
      )}
      {snapshot && snapshot.errors.length > 0 && (
        <Banner tone="warning" icon={<AlertTriangle />}>
          <p className="font-medium">{t('privileged.privileged.theSnapshotIsIncomplete')}</p>
          <ul className="mt-1 list-disc pl-5">{snapshot.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}</ul>
        </Banner>
      )}

      {q.isLoading ? (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
          <Skeleton className="h-96" />
        </div>
      ) : !data || !snapshot ? (
        <FirstRun data={data} canOperate={canOperate} onStart={() => setStartOpen(true)} />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              label={t('privileged.privileged.groups')}
              value={snapshot.groupCount}
              sub={t('privileged.privileged.memberships', { count: formatNumber(snapshot.memberCount) })}
              icon={<Users />}
              tone="text-sky-600 bg-sky-500/10 dark:text-sky-300"
              onClick={() => navigate('/privilegiert/gruppen')}
            />
            <Tile
              label={t('privileged.privileged.unexpected')}
              value={data.unexpected.length}
              sub={data.unexpected.length ? t('privileged.privileged.membersWithoutADesiredEntry') : t('privileged.privileged.allMembersExpected')}
              icon={<UserX />}
              tone="text-rose-600 bg-rose-500/10 dark:text-rose-300"
              alert={data.unexpected.length > 0}
              onClick={() => navigate('/privilegiert/gruppen?nur=unerwartet')}
            />
            <Tile
              label={t('privileged.privileged.hygiene')}
              value={data.hygiene.length}
              sub={highHygiene ? t('privileged.privileged.highSeverity', { count: highHygiene }) : t('privileged.privileged.noHighFindings')}
              icon={<HeartPulse />}
              tone="text-amber-700 bg-amber-500/10 dark:text-amber-300"
              alert={highHygiene > 0}
              onClick={() => navigate('/privilegiert/hygiene')}
            />
            <Tile
              label={t('privileged.privileged.attackPaths')}
              value={data.attackPaths.length}
              sub={data.attackPaths.length ? t('privileged.privileged.rightsOnTier0Objects') : t('privileged.privileged.noneFound')}
              icon={<Route />}
              tone="text-violet-600 bg-violet-500/10 dark:text-violet-300"
              alert={data.attackPaths.length > 0}
              onClick={() => navigate('/privilegiert/angriffspfade')}
            />
          </div>

          {data.monitorSchedules === 0 && canOperate && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-[13px] text-muted-foreground">
              <CalendarClock className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">{t('privileged.privileged.monitoringOnlyRunsOnDemand')}</span>
              <Button variant="outline" size="xs" asChild><Link to="/audits/zeitplaene?neu=ueberwachung"><CalendarPlus /> {t('privileged.privileged.setUpSchedule')}</Link></Button>
            </div>
          )}

          <Tabs value={tab} onValueChange={(v) => navigate(v === 'gruppen' ? '/privilegiert' : `/privilegiert/${v}`)}>
            <TabsList className="max-w-full overflow-x-auto [scrollbar-width:none]">
              <TabsTrigger value="gruppen"><Users /> {t('privileged.privileged.groups')}<Count n={data.groups.length} /></TabsTrigger>
              <TabsTrigger value="aenderungen"><GitCompareArrows /> {t('privileged.privileged.changes')}</TabsTrigger>
              <TabsTrigger value="hygiene"><HeartPulse /> {t('privileged.privileged.hygiene')}<Count n={data.hygiene.length} /></TabsTrigger>
              <TabsTrigger value="angriffspfade"><Route /> {t('privileged.privileged.attackPaths')}<Count n={data.attackPaths.length} alert /></TabsTrigger>
            </TabsList>
            <TabsContent value="gruppen"><GroupsTab data={data} /></TabsContent>
            <TabsContent value="aenderungen"><ChangesTab baseline={snapshot.baseline} /></TabsContent>
            <TabsContent value="hygiene"><HygieneTab data={data} /></TabsContent>
            <TabsContent value="angriffspfade"><AttackPathsTab data={data} /></TabsContent>
          </Tabs>
        </>
      )}
      <MonitorStartDialog open={startOpen} onOpenChange={setStartOpen} onStarted={() => q.refetch()} />
    </Page>
  )
}

function Count({ n, alert }: { n: number; alert?: boolean }) {
  if (!n) return null
  return <span className={cn('ml-1 rounded px-1.5 text-[11px] tabular', alert ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300' : 'bg-muted-foreground/15')}>{n}</span>
}

function Tile({ label, value, sub, icon, tone, alert, onClick }: { label: string; value: number; sub: string; icon: React.ReactNode; tone: string; alert?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group rounded-xl border bg-card p-4 text-left shadow-[0_1px_2px_0_rgb(0_0_0/0.03)] transition-all outline-none hover:-translate-y-px hover:border-input hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring dark:shadow-none',
        alert && 'border-rose-500/30',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        <span className={cn('grid size-7 shrink-0 place-content-center rounded-md [&_svg]:size-4', tone)}>{icon}</span>
      </div>
      <p className={cn('mt-2 text-[28px] leading-9 font-semibold tracking-tight tabular', alert && 'text-rose-600 dark:text-rose-400')}>{formatNumber(value)}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>
    </button>
  )
}

export function Banner({ tone, icon, children }: { tone: 'info' | 'warning' | 'danger'; icon: React.ReactNode; children: React.ReactNode }) {
  const style = {
    info: 'border-sky-500/25 bg-sky-500/5 text-sky-900 dark:text-sky-200 [&>svg]:text-sky-600 dark:[&>svg]:text-sky-400',
    warning: 'border-amber-500/30 bg-amber-500/5 text-amber-900 dark:text-amber-200 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400',
    danger: 'border-rose-500/30 bg-rose-500/5 text-rose-900 dark:text-rose-200 [&>svg]:text-rose-600 dark:[&>svg]:text-rose-400',
  }[tone]
  return (
    <div className={cn('mb-4 flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px] [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0', style)}>
      {icon}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function FirstRun({ data, canOperate, onStart }: { data?: PrivilegedOverview; canOperate: boolean; onStart: () => void }) {
  const steps = [
    { icon: <Users />, title: t('privileged.privileged.members'), text: t('privileged.privileged.directAndNestedMembersOf') },
    { icon: <HeartPulse />, title: t('privileged.privileged.hygiene'), text: t('privileged.privileged.adminAccountsWithoutProtectedUsers') },
    { icon: <Route />, title: t('privileged.privileged.attackPaths'), text: t('privileged.privileged.whoOutsideTier0Has') },
  ]
  return (
    <Card>
      <EmptyState
        icon={<ShieldUser />}
        title={data?.lastRun ? t('privileged.privileged.noSuccessfulMonitoringRunYet') : t('privileged.privileged.noMonitoringYet')}
        description={
          canOperate
            ? t('privileged.privileged.startTheFirstCheckAfter')
            : t('privileged.privileged.anOperatorCanStartThe')
        }
        action={
          canOperate && (
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={onStart}><Play /> {t('privileged.privileged.checkNow')}</Button>
              <Button variant="outline" asChild><Link to="/audits/zeitplaene?neu=ueberwachung"><CalendarPlus /> {t('privileged.privileged.setUpSchedule')}</Link></Button>
            </div>
          )
        }
      />
      <div className="grid gap-3 border-t px-5 py-5 md:grid-cols-3">
        {steps.map((s) => (
          <div key={s.title} className="flex gap-3">
            <span className="grid size-8 shrink-0 place-content-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">{s.icon}</span>
            <div>
              <p className="text-[13px] font-medium">{s.title}</p>
              <p className="text-xs text-muted-foreground">{s.text}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
