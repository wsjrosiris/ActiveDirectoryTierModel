import * as React from 'react'
import { Link, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileClock,
  FolderTree,
  Layers,
  Rocket,
  ScanSearch,
  ScrollText,
  ShieldCheck,
  User as UserIcon,
  Users,
  XCircle,
  Clock,
  Hourglass,
  Timer,
} from 'lucide-react'
import type { ChangeEntry, Dashboard, RunSummary } from '@/api/types'
import { useDashboardQuery } from '@/components/layout/app-layout'
import { Page, PageHeader } from '@/components/shared/page-header'
import { RunKindIcon, RunStatusBadge, runKindText } from '@/components/shared/badges'
import { OuTree } from '@/components/shared/ou-tree'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { useCan, useUser } from '@/features/auth/auth'
import { sectionQuery } from '@/features/config/queries'
import { actionLabels, includeLabels, scopeLabels } from '@/lib/labels'
import { cn, formatDuration, formatNumber, formatRelative } from '@/lib/utils'

const DriftChart = React.lazy(() => import('./drift-chart'))

export function Component() {
  const { data, isLoading } = useDashboardQuery()
  const user = useUser()
  const canEdit = useCan('Editor')
  const hour = new Date().getHours()
  const greeting = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend'

  return (
    <Page wide>
      <PageHeader
        title={`${greeting}, ${user.displayName?.split(' ')[0] || user.username}`}
        description="Überblick über Soll-Konfiguration, Drift und laufende Vorgänge."
        actions={
          canEdit && (
            <>
              <Button variant="outline" asChild>
                <Link to="/audits?start=1"><ScanSearch /> Audit starten</Link>
              </Button>
              <Button asChild>
                <Link to="/deploy"><Rocket /> Neuer Deploy</Link>
              </Button>
            </>
          )
        }
      />

      {!!data?.pendingApprovals?.length && <PendingApprovalsCard runs={data.pendingApprovals} />}

      <KpiRow data={data} loading={isLoading} />

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <AuditCard data={data} loading={isLoading} />
        <DeployCard data={data} loading={isLoading} />
        <QueueValidationCard data={data} loading={isLoading} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <Card className="flex flex-col xl:col-span-3">
          <CardHeader>
            <div>
              <CardTitle>Drift-Verlauf</CardTitle>
              <CardDescription>Abweichungen der letzten 30 erfolgreichen Audits</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="min-h-64 flex-1 pl-2">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : data && data.driftTrend.length > 0 ? (
              <React.Suspense fallback={<Skeleton className="h-full w-full" />}>
                <DriftChart data={data.driftTrend} />
              </React.Suspense>
            ) : (
              <EmptyState compact icon={<Activity />} title="Noch keine Audits" description="Sobald Audits erfolgreich laufen, erscheint hier der Drift-Verlauf." />
            )}
          </CardContent>
        </Card>
        <RecentRuns runs={data?.recentRuns} loading={isLoading} className="xl:col-span-2" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <OuTreeCard className="xl:col-span-3" />
        <RecentChanges changes={data?.recentChanges} loading={isLoading} className="xl:col-span-2" />
      </div>
    </Page>
  )
}

function PendingApprovalsCard({ runs }: { runs: RunSummary[] }) {
  const canDecide = useCan('Operator')
  const user = useUser()
  return (
    <Card className="relative mb-4 overflow-hidden border-amber-500/40">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-amber-500/[0.08] to-transparent" />
      <CardHeader className="relative">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-content-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300">
            <Hourglass className="size-4" />
          </span>
          <div>
            <CardTitle className="flex items-center gap-2">
              Freigaben ausstehend
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-800 tabular dark:text-amber-300">{runs.length}</span>
            </CardTitle>
            <CardDescription>
              {canDecide ? 'Deploys, die auf die Freigabe durch eine zweite Person warten' : 'Deploys, die auf die Freigabe durch einen Operator warten'}
            </CardDescription>
          </div>
        </div>
        <Button variant="ghost" size="xs" asChild className="text-muted-foreground">
          <Link to="/laeufe?status=AwaitingApproval">Alle <ArrowRight /></Link>
        </Button>
      </CardHeader>
      <CardContent className="relative px-2 pb-2">
        <ul className="grid gap-0.5">
          {runs.map((r) => {
            const own = r.requestedBy.toLocaleLowerCase() === user.username.toLocaleLowerCase()
            return (
              <li key={r.id}>
                <Link
                  to={`/laeufe/${r.id}`}
                  className="flex items-center gap-3 rounded-md px-3 py-2 transition-colors outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <RunKindIcon kind={r.kind} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">
                      #{r.id} · Deploy · {r.scope ? scopeLabels[r.scope] : 'Nur Add-ons'}
                      {r.includes.length > 0 && <span className="font-normal text-muted-foreground"> + {r.includes.map((i) => includeLabels[i] ?? i).join(', ')}</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.requestedBy}{own && ' (Sie)'} · {formatRelative(r.createdAt)} · DC {r.preferredDc}
                    </p>
                  </div>
                  {r.approvalExpiresAt && (
                    <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex" title="Läuft ab">
                      <Timer className="size-3.5" /> {formatRelative(r.approvalExpiresAt)}
                    </span>
                  )}
                  <span className="text-xs font-medium text-primary">{canDecide && !own ? 'Prüfen' : 'Ansehen'}</span>
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                </Link>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

function KpiRow({ data, loading }: { data?: Dashboard; loading: boolean }) {
  const tiles = [
    { label: 'OUs', value: data?.counts.ous, icon: FolderTree, to: '/konfiguration/ous', tone: 'text-indigo-600 bg-indigo-500/10 dark:text-indigo-300' },
    { label: 'Gruppen', value: data?.counts.groups, icon: Users, to: '/konfiguration/groups', tone: 'text-sky-600 bg-sky-500/10 dark:text-sky-300' },
    { label: 'Benutzer', value: data?.counts.users, icon: UserIcon, to: '/konfiguration/users', tone: 'text-teal-600 bg-teal-500/10 dark:text-teal-300' },
    { label: 'ACL-Delegationen', value: data?.counts.acls, icon: ShieldCheck, to: '/konfiguration/acls', tone: 'text-violet-600 bg-violet-500/10 dark:text-violet-300' },
    {
      label: 'GPOs',
      value: data?.counts.gpos,
      sub: data ? `${formatNumber(data.counts.gpoLinks)} Verknüpfungen` : undefined,
      icon: ScrollText,
      to: '/konfiguration/gpos',
      tone: 'text-fuchsia-600 bg-fuchsia-500/10 dark:text-fuchsia-300',
    },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {tiles.map((t) => (
        <Link
          key={t.label}
          to={t.to}
          className="group rounded-xl border bg-card p-4 shadow-[0_1px_2px_0_rgb(0_0_0/0.03)] transition-all outline-none hover:-translate-y-px hover:border-input hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring dark:shadow-none"
        >
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-muted-foreground">{t.label}</span>
            <span className={cn('grid size-7 place-content-center rounded-md', t.tone)}>
              <t.icon className="size-4" />
            </span>
          </div>
          {loading ? (
            <Skeleton className="mt-3 h-8 w-16" />
          ) : (
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-[28px] leading-9 font-semibold tracking-tight tabular">{formatNumber(t.value)}</span>
            </div>
          )}
          <p className="mt-0.5 h-4 text-xs text-muted-foreground">{t.sub}</p>
        </Link>
      ))}
    </div>
  )
}

function AuditCard({ data, loading }: { data?: Dashboard; loading: boolean }) {
  const a = data?.lastAudit
  const drift = a?.driftCount
  const ok = a && a.status === 'Succeeded' && drift === 0
  const bad = a && ((drift ?? 0) > 0 || a.status === 'Failed')
  return (
    <Card className={cn('relative overflow-hidden', ok && 'border-emerald-500/30', bad && 'border-rose-500/30')}>
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b to-transparent',
          ok ? 'from-emerald-500/[0.07]' : bad ? 'from-rose-500/[0.07]' : 'from-transparent',
        )}
      />
      <CardHeader className="relative">
        <div>
          <CardTitle>Letztes Audit</CardTitle>
          <CardDescription>{a ? formatRelative(a.finishedAt ?? a.createdAt) : 'Soll/Ist-Vergleich'}</CardDescription>
        </div>
        {a && <RunStatusBadge status={a.status} />}
      </CardHeader>
      <CardContent className="relative">
        {loading ? (
          <Skeleton className="h-16 w-full" />
        ) : !a ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <ScanSearch className="size-5" /> Noch kein Audit ausgeführt.
          </div>
        ) : (
          <div className="flex items-end justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={cn('grid size-11 place-content-center rounded-full', ok ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : bad ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : 'bg-muted text-muted-foreground')}>
                {ok ? <CheckCircle2 className="size-5" /> : bad ? <AlertTriangle className="size-5" /> : <Clock className="size-5" />}
              </div>
              <div>
                <p className={cn('text-lg font-semibold tracking-tight', ok && 'text-emerald-700 dark:text-emerald-400', bad && 'text-rose-700 dark:text-rose-400')}>
                  {drift === null || drift === undefined ? statusText(a) : drift === 0 ? 'Kein Drift' : `${formatNumber(drift)} Abweichungen`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {a.errorCount ? `${a.errorCount} Fehler · ` : ''}DC {a.preferredDc}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/laeufe/${a.id}`}>Details <ArrowRight /></Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function statusText(r: RunSummary) {
  return r.status === 'Running' ? 'Läuft …' : r.status === 'Queued' ? 'Wartet …' : r.status === 'Failed' ? 'Fehlgeschlagen' : '–'
}

function DeployCard({ data, loading }: { data?: Dashboard; loading: boolean }) {
  const d = data?.lastDeploy
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Letzter Deploy</CardTitle>
          <CardDescription>{d ? formatRelative(d.finishedAt ?? d.createdAt) : 'Bereitstellung ins AD'}</CardDescription>
        </div>
        {d && <RunStatusBadge status={d.status} />}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-16 w-full" />
        ) : !d ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Rocket className="size-5" /> Noch kein Deploy ausgeführt.
          </div>
        ) : (
          <div className="flex items-end justify-between gap-4">
            <div className="flex items-center gap-3">
              <RunKindIcon kind="Deploy" className="size-11 rounded-full [&_svg]:size-5" />
              <div>
                <p className="text-lg font-semibold tracking-tight">
                  {d.status === 'AwaitingApproval'
                    ? 'Wartet auf Freigabe'
                    : d.status === 'Rejected'
                      ? 'Abgelehnt'
                      : d.mode === 'Apply'
                        ? 'Angewendet'
                        : 'Geplant (WhatIf)'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {d.scope ? scopeLabels[d.scope] : 'Nur Add-ons'} · {d.requestedBy} · {formatDuration(d.startedAt, d.finishedAt)}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/laeufe/${d.id}`}>Details <ArrowRight /></Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function QueueValidationCard({ data, loading }: { data?: Dashboard; loading: boolean }) {
  const v = data?.validation
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Warteschlange & Validierung</CardTitle>
          <CardDescription>Aktueller Zustand des Dienstes</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        {loading ? (
          <>
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </>
        ) : (
          <>
            <Link to="/laeufe" className="rounded-lg border bg-muted/30 p-3 transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring">
              <p className="text-xs text-muted-foreground">Läufe</p>
              <p className="mt-1 flex items-baseline gap-1.5 text-sm">
                <span className="text-xl font-semibold tabular">{data?.queue.running ?? 0}</span> aktiv
              </p>
              <p className="text-xs text-muted-foreground">{data?.queue.queued ?? 0} wartend</p>
            </Link>
            <Link
              to="/konfiguration/validierung"
              className={cn(
                'rounded-lg border p-3 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                v && v.errors > 0 ? 'border-rose-500/25 bg-rose-500/5 hover:bg-rose-500/10' : v && v.warnings > 0 ? 'border-amber-500/25 bg-amber-500/5 hover:bg-amber-500/10' : 'bg-muted/30 hover:bg-muted/60',
              )}
            >
              <p className="text-xs text-muted-foreground">Validierung</p>
              {v && v.errors + v.warnings === 0 ? (
                <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-4" /> Keine Probleme
                </p>
              ) : (
                <>
                  <p className="mt-1 flex items-center gap-1.5 text-sm">
                    <XCircle className="size-4 text-rose-500" />
                    <span className="text-xl font-semibold tabular">{v?.errors ?? 0}</span> Fehler
                  </p>
                  <p className="text-xs text-muted-foreground">{v?.warnings ?? 0} Warnungen</p>
                </>
              )}
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function RecentRuns({ runs, loading, className }: { runs?: RunSummary[]; loading: boolean; className?: string }) {
  const navigate = useNavigate()
  return (
    <Card className={className}>
      <CardHeader>
        <div>
          <CardTitle>Letzte Läufe</CardTitle>
          <CardDescription>Deploys, Audits und Überwachungen</CardDescription>
        </div>
        <Button variant="ghost" size="xs" asChild className="text-muted-foreground">
          <Link to="/laeufe">Alle <ArrowRight /></Link>
        </Button>
      </CardHeader>
      <CardContent className="px-2 pb-2">
        {loading ? (
          <div className="grid gap-2 px-3 pb-3">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : !runs?.length ? (
          <EmptyState compact icon={<Activity />} title="Keine Läufe" description="Starten Sie einen Deploy oder ein Audit." />
        ) : (
          <ul>
            {runs.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/laeufe/${r.id}`)}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <RunKindIcon kind={r.kind} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">
                      #{r.id} · {runKindText(r)}
                      {r.kind === 'Audit' && r.driftCount !== null && (
                        <span className={cn('ml-2 text-xs font-normal', r.driftCount ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')}>
                          {r.driftCount ? `${r.driftCount} Drift` : 'kein Drift'}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.requestedBy} · {formatRelative(r.createdAt)}
                    </p>
                  </div>
                  <RunStatusBadge status={r.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function RecentChanges({ changes, loading, className }: { changes?: ChangeEntry[]; loading: boolean; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <div>
          <CardTitle>Letzte Änderungen</CardTitle>
          <CardDescription>Änderungsprotokoll</CardDescription>
        </div>
        <Button variant="ghost" size="xs" asChild className="text-muted-foreground">
          <Link to="/aenderungen">Alle <ArrowRight /></Link>
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="grid gap-3">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : !changes?.length ? (
          <EmptyState compact icon={<FileClock />} title="Keine Änderungen" />
        ) : (
          <ol className="relative grid gap-4 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-border">
            {changes.map((c) => (
              <li key={c.id} className="relative flex gap-3 pl-5">
                <span className={cn('absolute top-1.5 left-0 size-[11px] rounded-full border-2 border-card', dotColor(c.action))} aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-[13px]">
                    <span className="font-medium">{c.username}</span>{' '}
                    <span className="text-muted-foreground">{actionLabels[c.action]?.toLowerCase() ?? c.action}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground" title={c.summary}>
                    {c.summary} · {formatRelative(c.at)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

function dotColor(action: string) {
  if (action.includes('failed') || action.includes('denied') || action.includes('delete') || action.includes('cancel') || action.includes('reject') || action.includes('expired')) return 'bg-rose-500'
  if (action === 'run.approve') return 'bg-emerald-500'
  if (action.startsWith('config')) return 'bg-indigo-500'
  if (action.startsWith('run')) return 'bg-sky-500'
  if (action.startsWith('auth')) return 'bg-muted-foreground/60'
  return 'bg-amber-500'
}

function OuTreeCard({ className }: { className?: string }) {
  const { data, isLoading } = useQuery(sectionQuery('ous'))
  const navigate = useNavigate()
  const ous = data?.content?.organizationUnits ?? []
  return (
    <Card className={className}>
      <CardHeader className="pb-1">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Layers className="size-4 text-muted-foreground" /> OU-Struktur
          </CardTitle>
          <CardDescription>Soll-Struktur aus der Konfiguration, farbig nach Tier</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid gap-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-7" style={{ marginLeft: (i % 3) * 18 }} />)}</div>
        ) : ous.length === 0 ? (
          <EmptyState compact icon={<FolderTree />} title="Keine OUs konfiguriert" />
        ) : (
          <div className="max-h-[420px] overflow-y-auto pr-1">
            <OuTree ous={ous} onSelect={(i) => navigate(`/konfiguration/ous?edit=${i}`)} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
