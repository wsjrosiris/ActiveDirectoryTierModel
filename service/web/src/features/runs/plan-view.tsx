import * as React from 'react'
import { Link } from 'react-router'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ClipboardList,
  Clock,
  FlaskConical,
  Link2,
  Lock,
  Minus,
  PencilLine,
  Plus,
  Search,
  Settings2,
  UsersRound,
  XCircle,
  Zap,
} from 'lucide-react'
import type { DeployPlan, PlanAction, RunDetail } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Tooltip } from '@/components/ui/tooltip'
import { KeyValueList } from '@/components/shared/key-value-list'
import { useCan } from '@/features/auth/auth'
import { cn, formatDateTime, formatNumber, formatRelative } from '@/lib/utils'
import {
  actionKind,
  actionKindLabels,
  actionLabel,
  describeAction,
  groupPlan,
  planAreaLabels,
  planCountsText,
  planTotal,
  readableDn,
  remainingDetails,
  sentenceText,
  type ActionKind,
  type SentencePart,
} from './plan-model'
import { requestFromRun, useApplyPlan } from './plan-apply'
import { MaintenanceNotice } from './maintenance-notice'

const kindStyle: Record<ActionKind, { icon: React.ReactNode; tone: string; text: string }> = {
  create: { icon: <Plus />, tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', text: 'text-emerald-600 dark:text-emerald-400' },
  update: { icon: <PencilLine />, tone: 'bg-sky-500/10 text-sky-700 dark:text-sky-300', text: 'text-sky-600 dark:text-sky-400' },
  link: { icon: <Link2 />, tone: 'bg-violet-500/10 text-violet-700 dark:text-violet-300', text: 'text-violet-600 dark:text-violet-300' },
  configure: { icon: <Settings2 />, tone: 'bg-amber-500/10 text-amber-800 dark:text-amber-300', text: 'text-amber-700 dark:text-amber-300' },
  remove: { icon: <Minus />, tone: 'bg-rose-500/10 text-rose-700 dark:text-rose-300', text: 'text-rose-600 dark:text-rose-400' },
  other: { icon: <CircleDot />, tone: 'bg-muted text-muted-foreground', text: '' },
}

export function KindIcon({ action, className }: { action: string; className?: string }) {
  const s = kindStyle[actionKind(action)]
  return (
    <span className={cn('grid size-6 shrink-0 place-content-center rounded-md [&_svg]:size-3.5', s.tone, className)} aria-label={actionKindLabels[actionKind(action)]}>
      {s.icon}
    </span>
  )
}

export function Sentence({ parts, className }: { parts: SentencePart[]; className?: string }) {
  return (
    <span className={cn('break-words', className)}>
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          <React.Fragment key={i}>{p}</React.Fragment>
        ) : 'name' in p ? (
          <span key={i} className="font-medium text-foreground">„{p.name}“</span>
        ) : (
          <span key={i} className="font-medium text-foreground" title={p.path}>„{readableDn(p.path)}“</span>
        ),
      )}
    </span>
  )
}

/** Full plan: counters, warnings, filters and the actions grouped by phase. */
export function PlanView({ plan, header }: { plan: DeployPlan; header?: React.ReactNode }) {
  const [q, setQ] = React.useState('')
  const [area, setArea] = React.useState('all')
  const [action, setAction] = React.useState('all')
  const [kind, setKind] = React.useState<ActionKind | 'all'>('all')
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())
  const total = planTotal(plan)

  const areas = React.useMemo(() => [...new Set(plan.actions.map((a) => a.area))], [plan])
  const actionTypes = React.useMemo(() => Object.keys(plan.actionCounts).sort((a, b) => actionLabel(a).localeCompare(actionLabel(b), 'de')), [plan])
  const needle = q.trim().toLowerCase()
  const filtered = plan.actions.filter(
    (a) =>
      (area === 'all' || a.area === area) &&
      (action === 'all' || a.action === action) &&
      (kind === 'all' || actionKind(a.action) === kind) &&
      (!needle || `${sentenceText(describeAction(a))} ${a.name} ${a.path ?? ''} ${Object.values(a.details ?? {}).flat().join(' ')}`.toLowerCase().includes(needle)),
  )
  const groups = groupPlan(plan, filtered)
  const filtering = area !== 'all' || action !== 'all' || kind !== 'all' || !!needle

  const tiles: { key: ActionKind | 'all' | 'existing'; label: string; value: number }[] = [
    { key: 'all', label: 'Änderungen', value: total },
    { key: 'create', label: 'Anlegen', value: plan.summary.create },
    { key: 'update', label: 'Ändern', value: plan.summary.update },
    { key: 'link', label: 'Verknüpfen', value: plan.summary.link },
    { key: 'configure', label: 'Konfigurieren', value: plan.summary.configure },
    { key: 'existing', label: 'Bereits vorhanden', value: plan.summary.existing },
  ]

  return (
    <div className="grid gap-4">
      {header}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => {
          const selectable = t.key !== 'existing' && t.key !== 'all' && t.value > 0
          const active = t.key === kind
          return (
            <button
              key={t.key}
              type="button"
              disabled={!selectable && t.key !== 'all'}
              onClick={() => (t.key === 'all' ? setKind('all') : selectable && setKind(active ? 'all' : (t.key as ActionKind)))}
              aria-pressed={t.key !== 'existing' ? active : undefined}
              className={cn(
                'rounded-xl border bg-card p-3.5 text-left transition-all outline-none enabled:hover:border-input focus-visible:ring-2 focus-visible:ring-ring',
                active && t.key !== 'all' && 'border-primary/50 ring-1 ring-primary/30',
              )}
            >
              <p className="text-xs text-muted-foreground">{t.label}</p>
              <p
                className={cn(
                  'mt-1 text-2xl font-semibold tabular',
                  t.value > 0 && t.key !== 'all' && t.key !== 'existing' && kindStyle[t.key as ActionKind].text,
                  t.key === 'existing' && 'text-muted-foreground',
                )}
              >
                {formatNumber(t.value)}
              </p>
            </button>
          )
        })}
      </div>

      {plan.errors.length > 0 && <Messages tone="error" title={`${plan.errors.length} Fehler bei der Planung`} items={plan.errors} />}
      {plan.warnings.length > 0 && <Messages tone="warn" title={`${plan.warnings.length} ${plan.warnings.length === 1 ? 'Hinweis' : 'Hinweise'}`} items={plan.warnings} />}
      {plan.truncated && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[13px] text-amber-900 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Der Plan enthält {formatNumber(total)} Änderungen; gespeichert und angezeigt werden die ersten {formatNumber(plan.actions.length)}. Die Zähler umfassen alle Änderungen.
        </div>
      )}

      {total === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckCircle2 />}
            title="Keine Änderungen nötig"
            description="Das Active Directory entspricht in diesem Bereich bereits der Soll-Konfiguration."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="grid gap-3 border-b px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:max-w-xs">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Änderungen durchsuchen …" className="h-8 pl-8 text-[13px]" aria-label="Änderungen durchsuchen" />
              </div>
              <div className="w-[calc(50%-4px)] sm:w-48">
                <Select
                  size="sm"
                  aria-label="Bereich"
                  value={area}
                  onValueChange={setArea}
                  options={[{ value: 'all', label: 'Alle Bereiche' }, ...areas.map((a) => ({ value: a, label: planAreaLabels[a] ?? a }))]}
                />
              </div>
              <div className="w-[calc(50%-4px)] sm:w-56">
                <Select
                  size="sm"
                  aria-label="Aktionsart"
                  value={action}
                  onValueChange={setAction}
                  options={[{ value: 'all', label: 'Alle Aktionen' }, ...actionTypes.map((a) => ({ value: a, label: `${actionLabel(a)} (${plan.actionCounts[a]})` }))]}
                />
              </div>
              <div className="ml-auto flex items-center gap-2">
                {filtering && (
                  <Button variant="ghost" size="xs" onClick={() => { setQ(''); setArea('all'); setAction('all'); setKind('all') }}>
                    Filter zurücksetzen
                  </Button>
                )}
                <span className="text-xs text-muted-foreground tabular">{filtered.length} von {plan.actions.length}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5" aria-label="Zähler je Aktionsart">
              {actionTypes.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAction(action === a ? 'all' : a)}
                  aria-pressed={action === a}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border bg-card py-0.5 pr-2 pl-0.5 text-xs transition-colors hover:bg-accent',
                    action === a && 'border-primary/50 bg-primary/5',
                  )}
                >
                  <KindIcon action={a} className="size-5 [&_svg]:size-3" />
                  {actionLabel(a)}
                  <span className="font-semibold tabular">{plan.actionCounts[a]}</span>
                </button>
              ))}
            </div>
          </div>
          {groups.length === 0 ? (
            <EmptyState compact icon={<Search />} title="Keine Treffer" description="Keine geplante Änderung passt zu den Filtern." />
          ) : (
            <>
              <div className="flex justify-end border-b px-4 py-1.5">
                <Button
                  variant="link"
                  size="xs"
                  className="h-auto px-0"
                  onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(groups.map((g) => g.key)))}
                >
                  {collapsed.size ? 'Alle aufklappen' : 'Alle zuklappen'}
                </Button>
              </div>
              <div className="divide-y">
                {groups.map((g) => {
                  const open = !collapsed.has(g.key)
                  return (
                    <section key={g.key} aria-label={g.title}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2.5 bg-muted/30 px-4 py-2.5 text-left transition-colors hover:bg-muted/60"
                        aria-expanded={open}
                        onClick={() => {
                          const next = new Set(collapsed)
                          if (open) next.add(g.key)
                          else next.delete(g.key)
                          setCollapsed(next)
                        }}
                      >
                        {open ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
                        <span className="text-xs font-medium text-muted-foreground tabular">Phase {g.phase || '–'}</span>
                        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{g.title}</span>
                        {g.existing !== null && g.existing > 0 && (
                          <span className="hidden text-xs text-muted-foreground sm:inline">{formatNumber(g.existing)} bereits vorhanden</span>
                        )}
                        <Badge variant="secondary" className="tabular">{g.actions.length}</Badge>
                      </button>
                      {open && (
                        <ul className="divide-y divide-border/60">
                          {g.actions.map((a, i) => <ActionRow key={i} action={a} />)}
                        </ul>
                      )}
                    </section>
                  )
                })}
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  )
}

function ActionRow({ action: a }: { action: PlanAction }) {
  const [open, setOpen] = React.useState(false)
  const rest = remainingDetails(a)
  const hasMore = Object.keys(rest).length > 0 || !!a.path
  return (
    <li className="flex gap-3 px-4 py-2.5">
      <KindIcon action={a.action} className="mt-px" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-6 text-muted-foreground">
          <Sentence parts={describeAction(a)} />
        </p>
        {open && (
          <div className="mt-2 grid gap-2 rounded-lg border bg-muted/20 px-3 py-2.5">
            <KeyValueList
              value={{ aktion: actionLabel(a.action), ...(a.resourceType ? { objekttyp: a.resourceType } : {}), ...(a.path ? { pfad: a.path } : {}), ...rest }}
              labels={{ aktion: 'Aktion', objekttyp: 'Objekttyp', pfad: 'Pfad (DN)' }}
            />
          </div>
        )}
      </div>
      {hasMore && (
        <Button variant="ghost" size="xs" className="shrink-0 text-muted-foreground" aria-expanded={open} onClick={() => setOpen(!open)}>
          Details {open ? <ChevronDown /> : <ChevronRight />}
        </Button>
      )}
    </li>
  )
}

function Messages({ tone, title, items }: { tone: 'warn' | 'error'; title: string; items: string[] }) {
  const [all, setAll] = React.useState(false)
  const shown = all ? items : items.slice(0, 5)
  return (
    <div
      className={cn(
        'rounded-lg border px-3.5 py-3 text-[13px]',
        tone === 'error' ? 'border-rose-500/30 bg-rose-500/5 text-rose-900 dark:text-rose-200' : 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200',
      )}
    >
      <p className="flex items-center gap-2 font-medium">
        {tone === 'error' ? <XCircle className="size-4 shrink-0" /> : <AlertTriangle className="size-4 shrink-0" />} {title}
      </p>
      <ul className="mt-1.5 grid list-disc gap-1 pl-10 break-words">
        {shown.map((m, i) => <li key={i}>{m}</li>)}
      </ul>
      {items.length > 5 && (
        <Button variant="link" size="xs" className="mt-1 ml-6 h-auto px-0 text-current" onClick={() => setAll(!all)}>
          {all ? 'Weniger anzeigen' : `Alle ${items.length} anzeigen`}
        </Button>
      )}
    </div>
  )
}

/** Bar above the plan of a planning run: can it be applied, and the button to do so. */
export function PlanApplyBar({ run }: { run: RunDetail }) {
  const canApply = useCan('Operator')
  const apply = useApplyPlan()
  const a = run.planApplicability
  if (run.status !== 'Succeeded' || !a) return null
  const changes = run.plan ? planTotal(run.plan) : undefined
  const reason = !canApply ? 'Anwenden erfordert die Rolle Operator.' : !a.applicable ? a.reason ?? 'Diese Planung kann nicht angewendet werden.'
    : apply.frozen ? 'Während einer Sperrzeit kann nicht angewendet werden.' : undefined
  return (
    <Card className={cn('flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3', a.applicable ? 'border-sky-500/30' : 'bg-muted/30')}>
      <span className={cn('grid size-9 shrink-0 place-content-center rounded-lg [&_svg]:size-4', a.applicable ? 'bg-sky-500/10 text-sky-600 dark:text-sky-300' : 'bg-muted text-muted-foreground')}>
        {a.applicable ? <FlaskConical /> : <Lock />}
      </span>
      <div className="min-w-0 flex-1 basis-60">
        <p className="text-sm font-medium">{a.applicable ? 'Diese Planung kann angewendet werden' : 'Anwenden nicht möglich'}</p>
        <p className="text-[13px] text-muted-foreground">
          {a.applicable ? (
            <>
              Gleicher Konfigurationsstand wie bei der Planung
              {a.expiresAt && <> · gültig bis <span title={formatDateTime(a.expiresAt)}>{formatDateTime(a.expiresAt)}</span> ({formatRelative(a.expiresAt)})</>}
            </>
          ) : (
            a.reason
          )}
        </p>
      </div>
      <Tooltip content={reason} disabled={!reason}>
        <span className="w-full sm:w-auto">
          <Button
            variant={apply.needsApproval ? 'default' : 'destructive'}
            className="w-full sm:w-auto"
            disabled={!!reason || changes === 0}
            loading={apply.isPending}
            onClick={() => apply.start(requestFromRun(run), run.id, changes, run.domain?.key)}
          >
            {!apply.isPending && (apply.needsApproval ? <UsersRound /> : <Zap />)}
            {apply.needsApproval ? 'Diesen Plan zur Freigabe einreichen …' : 'Diesen Plan anwenden …'}
          </Button>
        </span>
      </Tooltip>
      {a.applicable && canApply && <MaintenanceNotice className="basis-full" />}
    </Card>
  )
}

/** Short list for the approval panel: counters and the first changes of the linked planning run. */
export function PlanCompact({ plan, planRunId, limit = 6 }: { plan: DeployPlan; planRunId: number; limit?: number }) {
  const total = planTotal(plan)
  const counts = planCountsText(plan.summary)
  const groups = groupPlan(plan, plan.actions)
  let left = limit
  return (
    <div className="grid gap-2.5 rounded-lg border bg-card/70 px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-2 text-[13px] font-medium">
          <ClipboardList className="size-4 text-sky-600 dark:text-sky-400" />
          Geplante Änderungen laut Planung #{planRunId}
        </p>
        <Button variant="link" size="xs" className="h-auto px-0" asChild>
          <Link to={`/laeufe/${planRunId}`}>Alle {total} ansehen <ArrowRight /></Link>
        </Button>
      </div>
      {total === 0 ? (
        <p className="text-[13px] text-muted-foreground">Keine Änderungen nötig – das AD entspricht bereits der Soll-Konfiguration.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(plan.actionCounts).map(([a, n]) => (
              <span key={a} className="inline-flex items-center gap-1.5 rounded-md border py-0.5 pr-2 pl-0.5 text-xs">
                <KindIcon action={a} className="size-5 [&_svg]:size-3" /> {actionLabel(a)} <span className="font-semibold tabular">{n}</span>
              </span>
            ))}
          </div>
          <ul className="grid gap-1.5 text-[13px] text-muted-foreground">
            {groups.flatMap((g) =>
              g.actions.map((a, i) => {
                if (left <= 0) return []
                left--
                return (
                  <li key={`${g.key}-${i}`} className="flex gap-2">
                    <KindIcon action={a.action} className="size-5 [&_svg]:size-3" />
                    <Sentence parts={describeAction(a)} className="min-w-0" />
                  </li>
                )
              }),
            )}
          </ul>
          {total > limit && <p className="text-xs text-muted-foreground">… und {total - limit} weitere{counts && <> ({counts} insgesamt)</>}</p>}
        </>
      )}
      {(plan.errors.length > 0 || plan.warnings.length > 0) && (
        <p className="flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="size-3.5" />
          {[plan.errors.length && `${plan.errors.length} Fehler`, plan.warnings.length && `${plan.warnings.length} Hinweis(e)`].filter(Boolean).join(', ')} in der Planung
        </p>
      )}
    </div>
  )
}

/** Placeholder while a planning run has not produced a plan (yet). */
export function PlanMissing({ run }: { run: RunDetail }) {
  const pending = run.status === 'Queued' || run.status === 'Running'
  return (
    <Card>
      <EmptyState
        icon={pending ? <Clock /> : <ClipboardList />}
        title={pending ? 'Planung läuft …' : 'Keine Plandatei'}
        description={
          pending
            ? 'Die geplanten Änderungen erscheinen hier, sobald der Planungslauf abgeschlossen ist.'
            : 'Für diesen Lauf liegt keine auswertbare Planung vor. Die geplanten Änderungen stehen im Protokoll.'
        }
      />
    </Card>
  )
}
