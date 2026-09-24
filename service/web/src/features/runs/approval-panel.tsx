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
import { PlanCompact } from './plan-view'
import { t } from '@/i18n'
import { rich } from '@/i18n/rich'

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
    const tt = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(tt)
  }, [])
  const expiresMs = run.approvalExpiresAt ? new Date(run.approvalExpiresAt).getTime() - now : null
  const expiringSoon = expiresMs !== null && expiresMs < 60 * 60_000

  const withdraw = useMutation({
    mutationFn: () => api.runs.cancel(run.id),
    onSuccess: () => {
      toast.success(t('runs.approvalPanel.requestWithdrawn'))
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
              <h2 className="text-base font-semibold tracking-tight">{t('runs.approvalPanel.approvalRequired')}</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {t('runs.approvalPanel.thisDeploymentChangesActiveDirectory')}
              </p>
            </div>
          </div>

          <dl className="grid gap-3 text-[13px] sm:grid-cols-3">
            <div className="rounded-lg border bg-card/70 px-3 py-2">
              <dt className="text-xs text-muted-foreground">{t('runs.approvalPanel.requestedBy')}</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 font-medium">
                <UserIcon className="size-3.5 text-muted-foreground" />
                <span className="truncate">{run.requestedBy}</span>
                {isRequester && <span className="text-xs font-normal text-muted-foreground">{t('runs.approvalPanel.you')}</span>}
              </dd>
            </div>
            <div className="rounded-lg border bg-card/70 px-3 py-2">
              <dt className="text-xs text-muted-foreground">{t('runs.approvalPanel.requested')}</dt>
              <dd className="mt-0.5 font-medium" title={formatDateTime(run.createdAt)}>{formatRelative(run.createdAt, now)}</dd>
            </div>
            <div className={cn('rounded-lg border bg-card/70 px-3 py-2', expiringSoon && 'border-rose-500/30 bg-rose-500/5')}>
              <dt className="text-xs text-muted-foreground">{t('runs.approvalPanel.expires')}</dt>
              <dd className={cn('mt-0.5 flex items-center gap-1.5 font-medium', expiringSoon && 'text-rose-700 dark:text-rose-300')} title={formatDateTime(run.approvalExpiresAt)}>
                <Timer className="size-3.5 opacity-70" />
                {run.approvalExpiresAt ? (expiresMs! <= 0 ? 'abgelaufen' : formatRelative(run.approvalExpiresAt, now)) : '–'}
              </dd>
            </div>
          </dl>

          <div className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="text-xs text-muted-foreground">
                {rich(t('runs.approvalPanel.fixedState'), { label: <span className="font-medium text-foreground">{t('runs.approvalPanel.fixedStateLabel')}</span> })}
              </p>
              <Button variant="link" size="xs" className="h-auto px-0" onClick={onShowConfig}>
                <FileSearch /> {t('runs.approvalPanel.allVersions')}
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary">{run.scope ? scopeLabels[run.scope] : t('runs.approvalPanel.addOnsOnly')}</Badge>
              {run.includes.map((i) => <Badge key={i} variant="secondary">{includeLabels[i] ?? i}</Badge>)}
              <span className="mx-1 w-px self-stretch bg-border" aria-hidden />
              {versions.slice(0, 8).map(([k, v]) => (
                <Link key={k} to={`/konfiguration/${k}`} className="inline-flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-xs transition-colors hover:bg-accent">
                  {sectionFallbackTitles[k] ?? k} <span className="font-mono text-muted-foreground">{t('runs.approvalPanel.v')}{v}</span>
                </Link>
              ))}
              {versions.length > 8 && (
                <button type="button" onClick={onShowConfig} className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent">
                  {t('runs.approvalPanel.moreCount', { count: versions.length - 8 })}
                </button>
              )}
            </div>
          </div>

          {run.planRunId ? <LinkedPlanSummary planRunId={run.planRunId} /> : <LatestPlanHint run={run} />}
        </div>

        <div className="flex flex-col gap-3 lg:w-72 lg:border-l lg:pl-8">
          {canDecide ? (
            <>
              <div>
                <p className="text-sm font-medium">{t('runs.approvalPanel.yourDecision')}</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {t('runs.approvalPanel.checkTheScopeConfigurationState')}
                </p>
              </div>
              <div className="grid gap-2">
                <Button size="lg" className="w-full bg-emerald-600 text-white shadow-emerald-600/20 hover:bg-emerald-600/90" onClick={() => setDialog('approve')}>
                  <ShieldCheck /> {t('runs.approvalPanel.approve')}
                </Button>
                <Button size="lg" variant="outline" className="w-full text-destructive hover:text-destructive" onClick={() => setDialog('reject')}>
                  <ShieldX /> {t('runs.approvalPanel.reject')}
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
                  <span className="font-medium">{t('runs.approvalPanel.waitingForApprovalByA')}</span>
                  <span className="mt-0.5 block text-xs opacity-90">{t('runs.approvalPanel.youCannotApproveYourOwn')}</span>
                </span>
              </div>
              <Button
                variant="outline"
                className="w-full"
                loading={withdraw.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: t('runs.approvalPanel.withdrawRequestForDeploymentId', { id: run.id }),
                    description: t('runs.approvalPanel.theDeploymentIsNotExecuted'),
                    confirmText: t('runs.approvalPanel.withdraw'),
                    cancelText: t('runs.approvalPanel.keep'),
                    destructive: true,
                  })
                  if (ok) withdraw.mutate()
                }}
              >
                {!withdraw.isPending && <Undo2 />} {t('runs.approvalPanel.withdrawRequest')}
              </Button>
            </>
          ) : (
            <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-[13px] text-muted-foreground">
              {t('runs.approvalPanel.onlyOperatorsWhoDidNot')}
            </div>
          )}
        </div>
      </div>
      <DecisionDialog run={run} mode={dialog} onClose={() => setDialog(null)} onDone={refresh} />
    </Card>
  )
}

/** What the approved deploy will change: the plan of the planning run it is based on. */
function LinkedPlanSummary({ planRunId }: { planRunId: number }) {
  const q = useQuery({ queryKey: ['run-plan', planRunId], queryFn: () => api.runs.plan(planRunId), meta: { silent: true }, retry: false, staleTime: Infinity })
  if (q.isLoading) return <div className="h-24 animate-pulse rounded-lg bg-muted/60" aria-label={t('runs.approvalPanel.loadingPlan')} />
  if (!q.data)
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-sky-500/25 bg-sky-500/5 px-3 py-2.5 text-[13px]">
        <FlaskConical className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />
        <span className="min-w-0 flex-1">{t('runs.approvalPanel.planUnreadable', { id: planRunId })}</span>
        <Button variant="outline" size="xs" asChild><Link to={`/laeufe/${planRunId}`}>{t('runs.approvalPanel.open')} <ArrowRight /></Link></Button>
      </div>
    )
  return <PlanCompact plan={q.data} planRunId={planRunId} />
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
        <span className="text-muted-foreground">{t('runs.approvalPanel.searchingForTheLastPlan')}</span>
      ) : plan ? (
        <>
          <span className="min-w-0 flex-1">
            {t('runs.approvalPanel.checkTheLastPlanRun')}{' '}
            <span className="font-medium">#{plan.id}</span>
            <span className="text-muted-foreground"> · {plan.requestedBy} · {formatRelative(plan.createdAt)}</span>
            {!sameScope && <span className="ml-1.5 text-xs text-amber-700 dark:text-amber-300">{t('runs.approvalPanel.differentScope')}</span>}
          </span>
          <RunStatusBadge status={plan.status} />
          <Button variant="outline" size="xs" asChild>
            <Link to={`/laeufe/${plan.id}`}>{t('runs.approvalPanel.open')} <ArrowRight /></Link>
          </Button>
        </>
      ) : (
        <span className="text-muted-foreground">
          {t('runs.approvalPanel.noPreviousPlanRunFound')}
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
      toast.success(approve ? t('runs.approvalPanel.deploymentIdApproved', { id: run.id }) : t('runs.approvalPanel.deploymentIdRejected', { id: run.id }), {
        description: approve ? t('runs.approvalPanel.theRunIsQueuedAnd') : undefined,
      })
      onDone(r)
      onClose()
    },
    onError: (e) => {
      const status = e instanceof ApiError ? e.status : 0
      toast.error(approve ? t('runs.approvalPanel.approvalNotPossible') : t('runs.approvalPanel.rejectionNotPossible'), {
        description:
          status === 409
            ? t('runs.approvalPanel.theRequestIsNoLonger')
            : status === 403
              ? t('runs.approvalPanel.youMayNotDecideThis')
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
                <DialogTitle>{approve ? t('runs.approvalPanel.approveDeploymentId', { id: run.id }) : t('runs.approvalPanel.rejectDeploymentId', { id: run.id })}</DialogTitle>
                <DialogDescription>
                  {approve ? (
                    rich(t('runs.approvalPanel.approveDescription'), { user: <span className="font-medium text-foreground">{run.requestedBy}</span>, dc: <span className="font-mono text-foreground">{run.preferredDc}</span> })
                  ) : (
                    rich(t('runs.approvalPanel.rejectDescription'), { user: <span className="font-medium text-foreground">{run.requestedBy}</span> })
                  )}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <Field
            label={approve ? t('runs.approvalPanel.commentOptional') : t('runs.approvalPanel.justification')}
            htmlFor="decision-comment"
            required={!approve}
            error={touched && missing ? t('runs.approvalPanel.aJustificationIsRequired') : undefined}
            className="sm:pl-12"
          >
            <Textarea
              id="decision-comment"
              autoFocus
              rows={3}
              maxLength={1000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={approve ? t('runs.approvalPanel.eGPlanRun123') : t('runs.approvalPanel.eGScopeTooBroad')}
              aria-invalid={(touched && missing) || undefined}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
            <Button
              type="submit"
              variant={approve ? 'default' : 'destructive'}
              className={approve ? 'bg-emerald-600 text-white hover:bg-emerald-600/90' : undefined}
              loading={decide.isPending}
            >
              {!decide.isPending && (approve ? <ShieldCheck /> : <ShieldX />)}
              {approve ? t('runs.approvalPanel.approve2') : t('runs.approvalPanel.reject2')}
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
          {run.approvedBy ? t('runs.approvalPanel.rejectedBy', { by: run.approvedBy }) : t('runs.approvalPanel.approvalExpired')}
          {run.approvalComment && <>: <span className="italic">{t('common.quoted', { text: run.approvalComment })}</span></>}
        </span>
      </span>
    )
  }
  if (!run.approvedBy) return null
  return (
    <span className="flex min-w-0 items-center gap-1 text-emerald-700 dark:text-emerald-400" title={run.approvedAt ? formatDateTime(run.approvedAt) : undefined}>
      <ShieldCheck className="size-3.5 shrink-0" />
      <span className="truncate">
        {t('runs.approvalPanel.approvedBy', { by: run.approvedBy })}
        {run.approvedAt && <span className="text-muted-foreground"> · {formatRelative(run.approvedAt)}</span>}
        {run.approvalComment && <span className="text-muted-foreground">: <span className="italic">{t('common.quoted', { text: run.approvalComment })}</span></span>}
      </span>
    </span>
  )
}
