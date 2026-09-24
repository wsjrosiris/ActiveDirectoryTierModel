import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, ArrowRight, Ban, CalendarClock, ClipboardList, FileSearch, FlaskConical, HeartPulse, ListChecks, Route, Search, ShieldUser, Terminal, User as UserIcon, UserX, Users, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/api/client'
import type { Finding, MonitorSummary, RunDetail, RunStatus } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { RunKindIcon, RunStatusBadge, DriftBadge, SeverityBadge } from '@/components/shared/badges'
import { Page } from '@/components/shared/page-header'
import { useCan } from '@/features/auth/auth'
import { areaLabels, areaPlanLabels, findingArea, findingTypeLabels, includeLabels, scopeLabels, sectionFallbackTitles } from '@/lib/labels'
import { Tooltip } from '@/components/ui/tooltip'
import { cn, formatDateTime, formatDuration, formatNumber } from '@/lib/utils'
import { RunLog, useRunLog } from './run-log'
import { ApprovalOutcome, ApprovalPanel } from './approval-panel'
import { PlanApplyBar, PlanMissing, PlanView } from './plan-view'
import { planTotal } from './plan-model'
import { Component as NotFound } from '@/components/layout/not-found'

export function Component() {
  const { id: idParam } = useParams()
  const id = Number(idParam)
  const qc = useQueryClient()
  const canCancel = useCan('Operator')
  const confirm = useConfirm()
  const [tab, setTab] = React.useState('log')
  const run = useQuery({
    queryKey: ['run', id],
    queryFn: () => api.runs.get(id),
    enabled: Number.isFinite(id),
    // Awaiting approval: someone else may approve/reject at any time, so keep refreshing (a bit slower).
    refetchInterval: (q) => {
      const st = q.state.data?.status
      return st === 'Queued' || st === 'Running' ? 5000 : st === 'AwaitingApproval' ? 8000 : false
    },
  })
  const log = useRunLog(id, run.data?.status)
  // The log poller sees status changes earlier than the detail query – but only ever trust a later lifecycle state.
  const status = log.status && run.data && statusRank(log.status) > statusRank(run.data.status) ? log.status : run.data?.status
  const active = status === 'Queued' || status === 'Running'
  const awaiting = status === 'AwaitingApproval'
  // While awaiting approval there is no log yet: show the pinned configuration; switch to the live log once approved.
  const wasAwaiting = React.useRef<boolean | null>(null)
  React.useEffect(() => {
    if (status === undefined) return
    if (wasAwaiting.current === null && awaiting) setTab('config')
    if (wasAwaiting.current && !awaiting) setTab('log')
    wasAwaiting.current = awaiting
  }, [status, awaiting])
  // Planning runs open on their result once it is there.
  const isPlanRun = run.data?.kind === 'Deploy' && run.data.mode === 'Plan'
  const planTabShown = React.useRef(false)
  React.useEffect(() => {
    if (!isPlanRun || planTabShown.current || status !== 'Succeeded') return
    planTabShown.current = true
    setTab('plan')
  }, [isPlanRun, status])
  const [now, setNow] = React.useState(Date.now())
  React.useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])

  const cancel = useMutation({
    mutationFn: () => api.runs.cancel(id),
    onSuccess: () => {
      toast.success('Abbruch angefordert')
      qc.invalidateQueries({ queryKey: ['run', id] })
    },
  })

  if (!Number.isFinite(id) || (run.error instanceof ApiError && run.error.status === 404)) return <NotFound />

  const r = run.data
  const isAudit = r?.kind === 'Audit'
  const isMonitor = r?.kind === 'Monitor'

  return (
    <Page wide>
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2 text-muted-foreground">
        <Link to="/laeufe"><ArrowLeft /> Alle Läufe</Link>
      </Button>

      {!r ? (
        <div className="grid gap-4">
          <Skeleton className="h-12 w-80" />
          <Skeleton className="h-28" />
          <Skeleton className="h-96" />
        </div>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <RunKindIcon kind={r.kind} className="size-11 shrink-0 rounded-xl [&_svg]:size-5" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold tracking-tight">
                    {r.kind === 'Deploy' ? (r.mode === 'Apply' ? 'Deploy' : 'Deploy (Planung)') : r.kind === 'Monitor' ? 'Überwachung' : 'Audit'}{' '}
                    <span className="font-mono text-muted-foreground">#{r.id}</span>
                  </h1>
                  <RunStatusBadge status={status ?? r.status} />
                  {r.kind === 'Deploy' && (
                    <Badge variant={r.mode === 'Apply' ? 'danger' : 'info'}>{r.mode === 'Apply' ? 'Anwenden' : 'WhatIf'}</Badge>
                  )}
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    {r.trigger === 'Schedule' ? <CalendarClock className="size-3.5" /> : <UserIcon className="size-3.5" />}
                    {r.trigger === 'Schedule' ? `Zeitplan${r.scheduleId ? ` #${r.scheduleId}` : ''}` : r.requestedBy}
                  </span>
                  <span>{formatDateTime(r.createdAt)}</span>
                  <ApprovalOutcome run={r} />
                  {r.planRunId && (
                    <Link to={`/laeufe/${r.planRunId}`} className="flex items-center gap-1 text-sky-700 hover:underline dark:text-sky-300">
                      <FlaskConical className="size-3.5" /> Nach Planung #{r.planRunId}
                    </Link>
                  )}
                </p>
              </div>
            </div>
            {canCancel && active && (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                loading={cancel.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: `Lauf #${r.id} abbrechen?`,
                    description: r.status === 'Running' ? 'Der laufende PowerShell-Prozess wird beendet. Bereits durchgeführte Änderungen bleiben bestehen.' : 'Der Lauf wird aus der Warteschlange entfernt.',
                    confirmText: 'Lauf abbrechen',
                    cancelText: 'Weiterlaufen lassen',
                    destructive: true,
                  })
                  if (ok) cancel.mutate()
                }}
              >
                {!cancel.isPending && <Ban />} Abbrechen
              </Button>
            )}
          </div>

          {awaiting && <ApprovalPanel run={r} onShowConfig={() => setTab('config')} />}

          <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Meta label="Bereich">
              {isMonitor ? 'Privilegierte Gruppen' : r.scope ? scopeLabels[r.scope] : 'Nur Add-ons'}
              {r.includes.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">{r.includes.map((i) => <Badge key={i} variant="secondary">{includeLabels[i] ?? i}</Badge>)}</div>
              )}
            </Meta>
            <Meta label="Domain Controller"><span className="font-mono text-[13px]">{r.preferredDc}</span></Meta>
            <Meta label="Dauer">
              <span className="tabular">{formatDuration(r.startedAt, r.finishedAt, now)}</span>
              <p className="text-xs font-normal text-muted-foreground">
                {r.startedAt ? `Start ${formatDateTime(r.startedAt)}` : 'Noch nicht gestartet'}
              </p>
            </Meta>
            <Meta label={isAudit || isMonitor ? 'Ergebnis' : 'Exit-Code'}>
              {isAudit || isMonitor ? (
                <div className="flex flex-wrap items-center gap-2">
                  <DriftBadge count={r.driftCount} monitor={isMonitor} />
                  {!!r.errorCount && <Badge variant="danger">{r.errorCount} Fehler</Badge>}
                </div>
              ) : (
                <span className={cn('font-mono', r.exitCode ? 'text-rose-600 dark:text-rose-400' : '')}>{r.exitCode ?? '–'}</span>
              )}
            </Meta>
          </div>

          {r.message && (
            <div className={cn('mb-6 rounded-lg border px-4 py-3 text-[13px]', r.status === 'Failed' || r.status === 'Rejected' ? 'border-rose-500/30 bg-rose-500/5 text-rose-900 dark:text-rose-200' : 'bg-muted/40')}>
              {r.message}
            </div>
          )}

          {isMonitor && r.status === 'Succeeded' && r.summary && <MonitorResult summary={r.summary as unknown as MonitorSummary} />}

          <Tabs value={tab} onValueChange={setTab}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <TabsList className="max-w-full overflow-x-auto [scrollbar-width:none]">
                <TabsTrigger value="log"><Terminal /> Protokoll</TabsTrigger>
                {isAudit && (
                  <TabsTrigger value="findings">
                    <ListChecks /> Befunde
                    {r.findings.length > 0 && <span className="ml-1 rounded bg-muted-foreground/15 px-1.5 text-[11px] tabular">{r.findings.length}</span>}
                  </TabsTrigger>
                )}
                {r.kind === 'Deploy' && (r.mode === 'Plan' || r.planRunId) && (
                  <TabsTrigger value="plan">
                    <ClipboardList /> Geplante Änderungen
                    {r.plan && <span className="ml-1 rounded bg-muted-foreground/15 px-1.5 text-[11px] tabular">{planTotal(r.plan)}</span>}
                  </TabsTrigger>
                )}
                <TabsTrigger value="config"><FileSearch /> Konfiguration</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="log">
              <RunLog
                lines={log.lines}
                active={active}
                loaded={log.loaded}
                runId={id}
                emptyText={
                  awaiting
                    ? 'Der Lauf startet erst nach der Freigabe – dann erscheint hier die Ausgabe.'
                    : status === 'Rejected'
                      ? 'Der Lauf wurde nicht ausgeführt (Freigabe abgelehnt oder abgelaufen).'
                      : undefined
                }
              />
            </TabsContent>
            {isAudit && (
              <TabsContent value="findings">
                <Findings run={r} />
              </TabsContent>
            )}
            {r.kind === 'Deploy' && (r.mode === 'Plan' || r.planRunId) && (
              <TabsContent value="plan">
                {r.mode === 'Plan' ? (
                  r.plan ? <PlanView plan={r.plan} header={<PlanApplyBar run={r} />} /> : <PlanMissing run={{ ...r, status: status ?? r.status }} />
                ) : (
                  <LinkedPlan planRunId={r.planRunId!} />
                )}
              </TabsContent>
            )}
            <TabsContent value="config">
              <ConfigVersions versions={r.configVersions} pinned={r.approvalRequired} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </Page>
  )
}

const lifecycle: Record<RunStatus, number> = { AwaitingApproval: 0, Queued: 1, Running: 2, Succeeded: 3, Failed: 3, Cancelled: 3, Rejected: 3 }
function statusRank(s: RunStatus) {
  return lifecycle[s] ?? 0
}

/** Apply runs: the plan of the planning run they are based on. */
function LinkedPlan({ planRunId }: { planRunId: number }) {
  const q = useQuery({ queryKey: ['run-plan', planRunId], queryFn: () => api.runs.plan(planRunId), meta: { silent: true }, retry: false, staleTime: Infinity })
  if (q.isLoading) return <Skeleton className="h-64" />
  if (!q.data)
    return (
      <Card>
        <EmptyState compact icon={<ClipboardList />} title="Plan nicht verfügbar" description={<>Die Planung #{planRunId} enthält keine auswertbare Plandatei.</>} />
      </Card>
    )
  return (
    <PlanView
      plan={q.data}
      header={
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/25 bg-sky-500/5 px-3 py-2.5 text-[13px]">
          <FlaskConical className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />
          <span className="min-w-0 flex-1">Dieser Lauf wendet die geprüfte Planung an – mit genau deren Konfigurationsversionen.</span>
          <Button variant="outline" size="xs" asChild><Link to={`/laeufe/${planRunId}`}>Planung #{planRunId} öffnen</Link></Button>
        </div>
      }
    />
  )
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm font-medium">{children}</div>
    </Card>
  )
}

function ConfigVersions({ versions, pinned }: { versions: Record<string, number>; pinned?: boolean }) {
  const entries = Object.entries(versions ?? {})
  if (!entries.length) return <Card><EmptyState compact icon={<FileSearch />} title="Keine Versionsangaben" /></Card>
  return (
    <Card className="p-5">
      <p className="mb-3 text-[13px] text-muted-foreground">
        {pinned
          ? 'Beim Einreichen zur Freigabe festgeschriebene Konfigurationsversionen – genau dieser Stand wird ausgeführt:'
          : 'Dieser Lauf hat folgende Konfigurationsversionen verwendet:'}
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {entries.map(([k, v]) => (
          <Link key={k} to={`/konfiguration/${k}`} className="flex items-center justify-between rounded-lg border px-3 py-2 text-[13px] transition-colors hover:bg-accent/50">
            <span>{sectionFallbackTitles[k] ?? k}</span>
            <Badge variant="outline" className="font-mono">v{v}</Badge>
          </Link>
        ))}
      </div>
    </Card>
  )
}

const findingTone: Record<string, string> = {
  Missing: 'text-rose-600 dark:text-rose-400 bg-rose-500/10',
  Unexpected: 'text-amber-700 dark:text-amber-300 bg-amber-500/10',
  Mismatch: 'text-violet-600 dark:text-violet-300 bg-violet-500/10',
  Error: 'text-rose-700 dark:text-rose-300 bg-rose-500/15',
}

// Keys of the audit report's auditSummary, in display order. `type` links a tile to the findings filter.
const summaryTiles: { key: string; label: string; type?: string }[] = [
  { key: 'totalChecked', label: 'Geprüft' },
  { key: 'driftCount', label: 'Abweichungen gesamt' },
  { key: 'missingCount', label: 'Fehlend', type: 'Missing' },
  { key: 'unexpectedCount', label: 'Unerwartet', type: 'Unexpected' },
  { key: 'mismatchCount', label: 'Abweichend', type: 'Mismatch' },
  { key: 'orphanedGpoLinkCount', label: 'Verwaiste GPO-Links' },
  { key: 'securityDeltaCount', label: 'Sicherheitsabweichungen' },
]

function Findings({ run }: { run: RunDetail }) {
  const [type, setType] = React.useState('all')
  const [res, setRes] = React.useState('all')
  const [area, setArea] = React.useState('all')
  const [q, setQ] = React.useState('')
  const canOperate = useCan('Operator')
  const remediate = useRemediation(run)
  const findings = run.findings ?? []
  const types = React.useMemo(() => [...new Set(findings.map((f) => f.type))].sort(), [findings])
  const resTypes = React.useMemo(() => [...new Set(findings.map((f) => f.resourceType))].sort(), [findings])
  const summary: { key: string; label: string; type?: string; value: number }[] = run.summary
    ? [
        ...summaryTiles.filter((t) => typeof run.summary![t.key] === 'number').map((t) => ({ ...t, value: run.summary![t.key] })),
        // Keys a newer report version might add.
        ...Object.entries(run.summary)
          .filter(([k, v]) => typeof v === 'number' && !summaryTiles.some((t) => t.key === k))
          .map(([k, v]) => ({ key: k, label: k, value: v })),
      ]
    : types.map((t) => ({ key: t, label: findingTypeLabels[t] ?? t, type: t, value: findings.filter((f) => f.type === t).length }))
  const areas = React.useMemo(() => [...new Set(findings.map((f) => findingArea(f)).filter((a): a is string => !!a))], [findings])
  const hasSeverity = findings.some((f) => f.severity)
  const filtered = findings.filter(
    (f: Finding) =>
      (type === 'all' || f.type === type) &&
      (res === 'all' || f.resourceType === res) &&
      (area === 'all' || findingArea(f) === area) &&
      (!q || `${f.identifier} ${f.details} ${f.resourceType}`.toLowerCase().includes(q.toLowerCase())),
  )

  return (
    <div className="grid gap-4">
      {summary.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {summary.map(({ key, label, type: t, value: v }) => (
            <button
              key={key}
              type="button"
              disabled={!t}
              onClick={() => t && setType(type === t ? 'all' : t)}
              className={cn('rounded-xl border bg-card p-3.5 text-left transition-all outline-none enabled:hover:border-input focus-visible:ring-2 focus-visible:ring-ring', t && type === t && 'border-primary/50 ring-1 ring-primary/30')}
              aria-pressed={t ? type === t : undefined}
            >
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={cn('mt-1 text-2xl font-semibold tabular', v > 0 && t && findingTone[t] ? findingTone[t].split(' ').filter((c) => c.startsWith('text-') || c.startsWith('dark:text-')).join(' ') : '', v > 0 && key === 'driftCount' && 'text-rose-600 dark:text-rose-400')}>
                {formatNumber(v)}
              </p>
            </button>
          ))}
        </div>
      )}
      {run.status === 'Succeeded' && <RemediationPanel run={run} findings={findings} onFilter={setArea} />}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Befunde durchsuchen …" className="h-8 pl-8 text-[13px]" aria-label="Befunde durchsuchen" />
          </div>
          <div className="w-44">
            <Select size="sm" aria-label="Befundtyp" value={type} onValueChange={setType} options={[{ value: 'all', label: 'Alle Typen' }, ...types.map((t) => ({ value: t, label: findingTypeLabels[t] ?? t }))]} />
          </div>
          <div className="w-48">
            <Select size="sm" aria-label="Ressourcentyp" value={res} onValueChange={setRes} options={[{ value: 'all', label: 'Alle Ressourcen' }, ...resTypes.map((t) => ({ value: t, label: t }))]} />
          </div>
          {areas.length > 0 && (
            <div className="w-44">
              <Select size="sm" aria-label="Bereich" value={area} onValueChange={setArea} options={[{ value: 'all', label: 'Alle Bereiche' }, ...areas.map((a) => ({ value: a, label: areaLabels[a] ?? a }))]} />
            </div>
          )}
          <span className="ml-auto text-xs text-muted-foreground">{filtered.length} von {findings.length}</span>
        </div>
        {findings.length === 0 ? (
          <EmptyState icon={<ListChecks />} title={run.status === 'Succeeded' ? 'Keine Abweichungen' : 'Keine Befunde'} description={run.status === 'Succeeded' ? 'Das Active Directory entspricht der Soll-Konfiguration.' : 'Befunde erscheinen, sobald das Audit abgeschlossen ist.'} />
        ) : filtered.length === 0 ? (
          <EmptyState compact icon={<Search />} title="Keine Treffer" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Typ</TH>
                {hasSeverity && <TH>Schweregrad</TH>}
                <TH>Ressource</TH>
                <TH>Bezeichner</TH>
                <TH>Details</TH>
                {canOperate && run.status === 'Succeeded' && <TH className="w-10"><span className="sr-only">Behebung</span></TH>}
              </TR>
            </THead>
            <TBody>
              {filtered.map((f, i) => (
                <TR key={i}>
                  <TD>
                    <span className={cn('inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium', findingTone[f.type] ?? 'bg-muted text-muted-foreground')}>
                      {findingTypeLabels[f.type] ?? f.type}
                    </span>
                  </TD>
                  {hasSeverity && <TD>{f.severity ? <SeverityBadge severity={f.severity} /> : <span className="text-muted-foreground">–</span>}</TD>}
                  <TD className="text-[13px] text-muted-foreground">{f.resourceType}</TD>
                  <TD className="max-w-[360px]"><span className="block truncate font-mono text-[12px]" title={f.identifier}>{f.identifier}</span></TD>
                  <TD className="text-[13px] text-muted-foreground">{f.details}</TD>
                  {canOperate && run.status === 'Succeeded' && (
                    <TD>
                      {findingArea(f) && (
                        <Tooltip content={`Planung für ${areaLabels[findingArea(f)!]} starten`}>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Planung für ${areaLabels[findingArea(f)!]} starten`}
                            disabled={remediate.isPending}
                            onClick={() => remediate.mutate(findingArea(f)!)}
                          >
                            <Wrench />
                          </Button>
                        </Tooltip>
                      )}
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  )
}

/** Monitor runs: the evaluation in numbers; details live on the "Privilegierte Zugriffe" page. */
function MonitorResult({ summary: s }: { summary: MonitorSummary }) {
  const changes = (s.addedCount ?? 0) + (s.removedCount ?? 0)
  const tiles = [
    { label: 'Gruppen', value: s.groupCount, sub: `${formatNumber(s.memberCount)} Mitgliedschaften`, icon: <Users />, to: '/privilegiert' },
    {
      label: 'Änderungen',
      value: changes,
      sub: s.baseline ? 'Erste Momentaufnahme' : changes ? `${s.addedCount} hinzugefügt, ${s.removedCount} entfernt` : 'Keine seit der letzten Prüfung',
      icon: <ListChecks />,
      to: '/privilegiert/aenderungen',
      alert: changes > 0,
    },
    { label: 'Nicht erwartet', value: s.unexpectedCount, sub: 'Mitglieder ohne Soll-Eintrag', icon: <UserX />, to: '/privilegiert/gruppen?nur=unerwartet', alert: s.unexpectedCount > 0 },
    { label: 'Hygiene', value: s.hygieneCount, sub: s.hygieneHighCount ? `${s.hygieneHighCount} mit hohem Schweregrad` : 'Keine hohen Befunde', icon: <HeartPulse />, to: '/privilegiert/hygiene', alert: s.hygieneHighCount > 0 },
    { label: 'Angriffspfade', value: s.attackPathCount, sub: 'Rechte auf Tier-0-Objekte', icon: <Route />, to: '/privilegiert/angriffspfade', alert: s.attackPathCount > 0 },
  ]
  return (
    <Card className="mb-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold"><ShieldUser className="size-4 text-muted-foreground" /> Ergebnis der Überwachung</p>
        <Button variant="outline" size="xs" asChild>
          <Link to="/privilegiert">Privilegierte Zugriffe öffnen <ArrowRight /></Link>
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 xl:grid-cols-5">
        {tiles.map((t) => (
          <Link key={t.label} to={t.to} className="bg-card px-4 py-3 transition-colors outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">{t.icon} {t.label}</p>
            <p className={cn('mt-1 text-2xl font-semibold tabular', t.alert && 'text-rose-600 dark:text-rose-400')}>{formatNumber(t.value)}</p>
            <p className="truncate text-xs text-muted-foreground">{t.sub}</p>
          </Link>
        ))}
      </div>
    </Card>
  )
}

/** Remediation by click: a planning run for the area of audit findings (Operator). */
function useRemediation(run: RunDetail) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (area: string) => api.runs.remediate(run.id, area),
    onSuccess: (plan, area) => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      toast.success(`Planung #${plan.id} für ${areaLabels[area] ?? area} gestartet`, { description: 'Es werden noch keine Änderungen vorgenommen.' })
      navigate(`/laeufe/${plan.id}`)
    },
  })
}

function RemediationPanel({ run, findings, onFilter }: { run: RunDetail; findings: Finding[]; onFilter: (area: string) => void }) {
  const canOperate = useCan('Operator')
  const remediate = useRemediation(run)
  const byArea = new Map<string, Finding[]>()
  for (const f of findings) {
    const a = findingArea(f)
    if (!a) continue
    if (!byArea.has(a)) byArea.set(a, [])
    byArea.get(a)!.push(f)
  }
  if (byArea.size === 0) return null
  const order = Object.keys(areaLabels)
  const areas = [...byArea.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
  return (
    <Card className="overflow-hidden">
      <div className="border-b px-5 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold"><Wrench className="size-4 text-muted-foreground" /> Behebung</p>
        <p className="text-xs text-muted-foreground">
          {canOperate
            ? 'Startet einen Planungslauf nur für den Bereich, mit demselben Domain Controller und derselben ADML-Sprache wie dieses Audit. Angewendet wird erst nach Prüfung des Plans.'
            : 'Planungsläufe zur Behebung können Operatoren starten.'}
        </p>
      </div>
      <ul className="divide-y">
        {areas.map(([area, list]) => {
          const high = list.filter((f) => f.severity === 'High').length
          return (
            <li key={area} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
              <button type="button" onClick={() => onFilter(area)} className="min-w-0 flex-1 text-left outline-none focus-visible:underline">
                <p className="text-[13px] font-medium">{areaLabels[area]}</p>
                <p className="text-xs text-muted-foreground">
                  {list.length} {list.length === 1 ? 'Befund' : 'Befunde'}
                  {high > 0 && <span className="text-rose-700 dark:text-rose-400"> · {high} hoch</span>} · Planung „{areaPlanLabels[area]}“
                </p>
              </button>
              {canOperate && (
                <Button
                  size="xs"
                  variant="outline"
                  loading={remediate.isPending && remediate.variables === area}
                  disabled={remediate.isPending}
                  onClick={() => remediate.mutate(area)}
                >
                  {!(remediate.isPending && remediate.variables === area) && <FlaskConical />} Planung für diesen Bereich starten
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
