import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { ArrowRight, FileSearch, FlaskConical, Hourglass, ShieldCheck, ShieldX, Timer, Undo2, User as UserIcon } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/api/client'
import type { RunDetail, RunSummary } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { RunStatusBadge } from '@/components/shared/badges'
import { useUser } from '@/features/auth/auth'
import { errorMessage } from '@/lib/query'
import { includeLabels, scopeLabels, sectionFallbackTitles } from '@/lib/labels'
import { hasRole } from '@/lib/roles'
import { cn, formatDateTime, formatRelative } from '@/lib/utils'

export function sameUser(a: string | null | undefined, b: string | null | undefined) {
  return !!a && !!b && a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()
}

/** Invalidates everything that shows the run's status. */
function useRefreshRun(id: number) {
  const qc = useQueryClient()
  return React.useCallback(
    (updated?: RunSummary) => {
      if (updated) qc.setQueryData<RunDetail>(['run', id], (old) => (old ? { ...old, ...updated } : old))
      qc.invalidateQueries({ queryKey: ['run', id] })
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    [qc, id],
  )
}

/** Prominent panel on top of a run that waits for the four-eyes approval. */
export function ApprovalPanel({ run, onShowConfig }: { run: RunDetail; onShowConfig: () => void }) {
  const user = useUser()
  const confirm = useConfirm()
  const refresh = useRefreshRun(run.id)
  const [dialog, setDialog] = React.useState<'approve' | 'reject' | null>(null)
  const isRequester = sameUser(run.requestedBy, user.username)
  const canDecide = hasRole(user.role, 'Operator') && !isRequester

  const [now, setNow] = React.useState(Date.now())
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const expiresMs = run.approvalExpiresAt ? new Date(run.approvalExpiresAt).getTime() - now : null
  const expiringSoon = expiresMs !== null && expiresMs < 60 * 60_000

  const withdraw = useMutation({
    mutationFn: () => api.runs.cancel(run.id),
    onSuccess: () => {
      toast.success('Antrag zurückgezogen')
      refresh()
    },
  })

  const versions = Object.entries(run.configVersions ?? {})

  return (
    <Card className="relative mb-6 overflow-hidden border-amber-500/40 shadow-md shadow-amber-500/5">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-amber-500/[0.09] to-transparent" />
      <div className="relative grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-8">
        <div className="grid min-w-0 gap-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-content-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300">
              <Hourglass className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight">Freigabe erforderlich</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                Dieser Deploy ändert das Active Directory und wird erst ausgeführt, wenn eine zweite Person mit der Rolle Operator ihn freigibt.
              </p>
            </div>
          </div>

          <dl className="grid gap-3 text-[13px] sm:grid-cols-3">
            <div className="rounded-lg border bg-card/70 px-3 py-2">
              <dt className="text-xs text-muted-foreground">Angefordert von</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 font-medium">
                <UserIcon className="size-3.5 text-muted-foreground" />
                <span className="truncate">{run.requestedBy}</span>
                {isRequester && <span className="text-xs font-normal text-muted-foreground">(Sie)</span>}
              </dd>
            </div>
            <div className="rounded-lg border bg-card/70 px-3 py-2">
              <dt className="text-xs text-muted-foreground">Angefordert</dt>
              <dd className="mt-0.5 font-medium" title={formatDateTime(run.createdAt)}>{formatRelative(run.createdAt, now)}</dd>
            </div>
            <div className={cn('rounded-lg border bg-card/70 px-3 py-2', expiringSoon && 'border-rose-500/30 bg-rose-500/5')}>
              <dt className="text-xs text-muted-foreground">Läuft ab</dt>
              <dd className={cn('mt-0.5 flex items-center gap-1.5 font-medium', expiringSoon && 'text-rose-700 dark:text-rose-300')} title={formatDateTime(run.approvalExpiresAt)}>
                <Timer className="size-3.5 opacity-70" />
                {run.approvalExpiresAt ? (expiresMs! <= 0 ? 'abgelaufen' : formatRelative(run.approvalExpiresAt, now)) : '–'}
              </dd>
            </div>
          </dl>

          <div className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Festgeschriebener Stand</span> – ausgeführt wird genau diese Konfiguration.
              </p>
              <Button variant="link" size="xs" className="h-auto px-0" onClick={onShowConfig}>
                <FileSearch /> Alle Versionen
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary">{run.scope ? scopeLabels[run.scope] : 'Nur Add-ons'}</Badge>
              {run.includes.map((i) => <Badge key={i} variant="secondary">{includeLabels[i] ?? i}</Badge>)}
              <span className="mx-1 w-px self-stretch bg-border" aria-hidden />
              {versions.slice(0, 8).map(([k, v]) => (
                <Link key={k} to={`/konfiguration/${k}`} className="inline-flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-xs transition-colors hover:bg-accent">
                  {sectionFallbackTitles[k] ?? k} <span className="font-mono text-muted-foreground">v{v}</span>
                </Link>
              ))}
              {versions.length > 8 && (
                <button type="button" onClick={onShowConfig} className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent">
                  +{versions.length - 8} weitere
                </button>
              )}
            </div>
          </div>

          <LatestPlanHint run={run} />
        </div>

        <div className="flex flex-col gap-3 lg:w-72 lg:border-l lg:pl-8">
          {canDecide ? (
            <>
              <div>
                <p className="text-sm font-medium">Ihre Entscheidung</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  Prüfen Sie Bereich, Konfigurationsstand und Planungslauf. Mit der Freigabe wird der Deploy sofort eingereiht.
                </p>
              </div>
              <div className="grid gap-2">
                <Button size="lg" className="w-full bg-emerald-600 text-white shadow-emerald-600/20 hover:bg-emerald-600/90" onClick={() => setDialog('approve')}>
                  <ShieldCheck /> Freigeben …
                </Button>
                <Button size="lg" variant="outline" className="w-full text-destructive hover:text-destructive" onClick={() => setDialog('reject')}>
                  <ShieldX /> Ablehnen …
                </Button>
              </div>
            </>
          ) : isRequester ? (
            <>
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[13px] text-amber-900 dark:text-amber-200">
                <span className="relative mt-1 flex size-2 shrink-0">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-500 opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
                </span>
                <span>
                  <span className="font-medium">Wartet auf Freigabe durch eine zweite Person.</span>
                  <span className="mt-0.5 block text-xs opacity-90">Sie können Ihren eigenen Antrag nicht freigeben.</span>
                </span>
              </div>
              <Button
                variant="outline"
                className="w-full"
                loading={withdraw.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: `Antrag für Deploy #${run.id} zurückziehen?`,
                    description: 'Der Deploy wird nicht ausgeführt und erhält den Status „Abgebrochen“.',
                    confirmText: 'Zurückziehen',
                    cancelText: 'Behalten',
                    destructive: true,
                  })
                  if (ok) withdraw.mutate()
                }}
              >
                {!withdraw.isPending && <Undo2 />} Antrag zurückziehen
              </Button>
            </>
          ) : (
            <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-[13px] text-muted-foreground">
              Freigeben oder ablehnen können nur Operatoren, die den Deploy nicht selbst angefordert haben.
            </div>
          )}
        </div>
      </div>
      <DecisionDialog run={run} mode={dialog} onClose={() => setDialog(null)} onDone={refresh} />
    </Card>
  )
}

/** Points the approver to the most recent planning run before this request. */
function LatestPlanHint({ run }: { run: RunDetail }) {
  const q = useQuery({
    queryKey: ['runs', { kind: 'Deploy', page: 1, pageSize: 50 }],
    queryFn: () => api.runs.list({ kind: 'Deploy', page: 1, pageSize: 50 }),
    meta: { silent: true },
  })
  const plan = q.data?.items.find((r) => r.mode === 'Plan' && r.id < run.id)
  const sameScope = plan && plan.scope === run.scope && [...plan.includes].sort().join() === [...run.includes].sort().join()

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-sky-500/25 bg-sky-500/5 px-3 py-2.5 text-[13px]">
      <FlaskConical className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />
      {q.isLoading ? (
        <span className="text-muted-foreground">Letzter Planungslauf wird gesucht …</span>
      ) : plan ? (
        <>
          <span className="min-w-0 flex-1">
            Vor der Freigabe den letzten Planungslauf prüfen:{' '}
            <span className="font-medium">#{plan.id}</span>
            <span className="text-muted-foreground"> · {plan.requestedBy} · {formatRelative(plan.createdAt)}</span>
            {!sameScope && <span className="ml-1.5 text-xs text-amber-700 dark:text-amber-300">(anderer Bereich)</span>}
          </span>
          <RunStatusBadge status={plan.status} />
          <Button variant="outline" size="xs" asChild>
            <Link to={`/laeufe/${plan.id}`}>Öffnen <ArrowRight /></Link>
          </Button>
        </>
      ) : (
        <span className="text-muted-foreground">
          Kein vorheriger Planungslauf gefunden – ohne WhatIf-Ausgabe ist nicht nachvollziehbar, was dieser Deploy ändert.
        </span>
      )}
    </div>
  )
}

function DecisionDialog({
  run,
  mode,
  onClose,
  onDone,
}: {
  run: RunDetail
  mode: 'approve' | 'reject' | null
  onClose: () => void
  onDone: (r?: RunSummary) => void
}) {
  const [comment, setComment] = React.useState('')
  const [touched, setTouched] = React.useState(false)
  React.useEffect(() => {
    if (mode) {
      setComment('')
      setTouched(false)
    }
  }, [mode])
  const approve = mode === 'approve'
  const decide = useMutation({
    mutationFn: () =>
      approve
        ? api.runs.approve(run.id, comment.trim() ? { comment: comment.trim() } : {})
        : api.runs.reject(run.id, { comment: comment.trim() }),
    meta: { silent: true },
    onSuccess: (r) => {
      toast.success(approve ? `Deploy #${run.id} freigegeben` : `Deploy #${run.id} abgelehnt`, {
        description: approve ? 'Der Lauf ist eingereiht und startet in Kürze.' : undefined,
      })
      onDone(r)
      onClose()
    },
    onError: (e) => {
      const status = e instanceof ApiError ? e.status : 0
      toast.error(approve ? 'Freigabe nicht möglich' : 'Ablehnung nicht möglich', {
        description:
          status === 409
            ? 'Der Antrag wartet nicht mehr auf eine Freigabe (bereits entschieden, zurückgezogen oder abgelaufen).'
            : status === 403
              ? 'Sie dürfen diesen Antrag nicht entscheiden – den eigenen Antrag kann nur eine zweite Person freigeben.'
              : errorMessage(e),
      })
      if (status === 409 || status === 403) {
        onDone()
        onClose()
      }
    },
  })
  const missing = !approve && !comment.trim()

  return (
    <Dialog open={!!mode} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            setTouched(true)
            if (!missing) decide.mutate()
          }}
        >
          <DialogHeader>
            <div className="flex items-start gap-3">
              <span className={cn('grid size-9 shrink-0 place-content-center rounded-full', approve ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-destructive/10 text-destructive')}>
                {approve ? <ShieldCheck className="size-4" /> : <ShieldX className="size-4" />}
              </span>
              <div className="grid gap-1.5">
                <DialogTitle>{approve ? `Deploy #${run.id} freigeben?` : `Deploy #${run.id} ablehnen?`}</DialogTitle>
                <DialogDescription>
                  {approve ? (
                    <>
                      Der Deploy von <span className="font-medium text-foreground">{run.requestedBy}</span> wird eingereiht und ändert das Active Directory über{' '}
                      <span className="font-mono text-foreground">{run.preferredDc}</span>.
                    </>
                  ) : (
                    <>Der Antrag von <span className="font-medium text-foreground">{run.requestedBy}</span> wird verworfen. Bitte begründen Sie die Ablehnung.</>
                  )}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <Field
            label={approve ? 'Kommentar (optional)' : 'Begründung'}
            htmlFor="decision-comment"
            required={!approve}
            error={touched && missing ? 'Eine Begründung ist erforderlich.' : undefined}
            className="sm:pl-12"
          >
            <Textarea
              id="decision-comment"
              autoFocus
              rows={3}
              maxLength={1000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={approve ? 'z. B. Planungslauf #123 geprüft' : 'z. B. Bereich zu weit gefasst – bitte nur OUs deployen'}
              aria-invalid={(touched && missing) || undefined}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Abbrechen</Button>
            <Button
              type="submit"
              variant={approve ? 'default' : 'destructive'}
              className={approve ? 'bg-emerald-600 text-white hover:bg-emerald-600/90' : undefined}
              loading={decide.isPending}
            >
              {!decide.isPending && (approve ? <ShieldCheck /> : <ShieldX />)}
              {approve ? 'Freigeben' : 'Ablehnen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** One-line outcome of the approval for the run header. */
export function ApprovalOutcome({ run }: { run: RunSummary }) {
  if (!run.approvalRequired || run.status === 'AwaitingApproval') return null
  if (run.status === 'Rejected') {
    return (
      <span className="flex min-w-0 items-center gap-1 text-rose-700 dark:text-rose-300" title={run.approvedAt ? formatDateTime(run.approvedAt) : undefined}>
        <ShieldX className="size-3.5 shrink-0" />
        <span className="truncate">
          {run.approvedBy ? `Abgelehnt von ${run.approvedBy}` : 'Freigabe abgelaufen'}
          {run.approvalComment && <>: <span className="italic">„{run.approvalComment}“</span></>}
        </span>
      </span>
    )
  }
  if (!run.approvedBy) return null
  return (
    <span className="flex min-w-0 items-center gap-1 text-emerald-700 dark:text-emerald-400" title={run.approvedAt ? formatDateTime(run.approvedAt) : undefined}>
      <ShieldCheck className="size-3.5 shrink-0" />
      <span className="truncate">
        Freigegeben von {run.approvedBy}
        {run.approvedAt && <span className="text-muted-foreground"> · {formatRelative(run.approvedAt)}</span>}
        {run.approvalComment && <span className="text-muted-foreground">: <span className="italic">„{run.approvalComment}“</span></span>}
      </span>
    </span>
  )
}
