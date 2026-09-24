import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Clock, History, Hourglass, KeyRound, ListChecks, Loader2, Plus, ShieldCheck, ShieldX, Timer, Undo2, UserRound, UserX } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { jitApi, type JitRequest } from '@/api/jit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { TierBadge } from '@/components/shared/badges'
import { errorMessage } from '@/lib/query'
import type { Tier } from '@/lib/tier'
import { cn, formatDateTime, formatRelative } from '@/lib/utils'
import { formatCountdown, formatMinutes, remainingShare, statusLabels, statusTone } from './jit-model'
import { t } from '@/i18n'
import { rich } from '@/i18n/rich'

function useRefresh() {
  const qc = useQueryClient()
  return React.useCallback(() => qc.invalidateQueries({ queryKey: ['jit'] }), [qc])
}

function useNow(intervalMs: number) {
  const [now, setNow] = React.useState(Date.now())
  React.useEffect(() => {
    const tt = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(tt)
  }, [intervalMs])
  return now
}

export function JitStatusBadge({ status }: { status: JitRequest['status'] }) {
  return <Badge variant={statusTone[status]}>{status === 'Approved' && <Loader2 className="animate-spin" />}{statusLabels[status]}</Badge>
}

function Heading({ r }: { r: JitRequest }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <TierBadge tier={(r.tier ?? null) as Tier} short />
      <span className="truncate font-medium">{r.groupDisplayName}</span>
      <span className="font-mono text-xs text-muted-foreground">#{r.id}</span>
    </div>
  )
}

function Facts({ r, now }: { r: JitRequest; now: number }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
      <span className="flex items-center gap-1"><KeyRound className="size-3.5" /><span className="font-mono text-foreground">{r.memberAccount}</span></span>
      <span className="flex items-center gap-1"><Timer className="size-3.5" />{formatMinutes(r.minutes)}</span>
      <span className="flex items-center gap-1" title={formatDateTime(r.requestedAt)}>
        <UserRound className="size-3.5" />{r.requestedBy}{r.mine && <span className="text-xs">{t('jit.jitRequests.you')}</span>} · {formatRelative(r.requestedAt, now)}
      </span>
    </p>
  )
}

function Justification({ text }: { text: string }) {
  return <p className="rounded-md border-l-2 border-primary/30 bg-muted/40 px-3 py-1.5 text-[13px] break-words">„{text}“</p>
}

// ------------------------------------------------------------------ open requests

export function OpenList({ items, onRequest }: { items: JitRequest[]; onRequest?: () => void }) {
  const now = useNow(30_000)
  if (items.length === 0)
    return (
      <Card>
        <EmptyState
          icon={<ListChecks />}
          title={t('jit.jitRequests.noOpenRequests')}
          description={t('jit.jitRequests.requestsThatAreWaitingFor')}
          action={onRequest && <Button variant="outline" onClick={onRequest}><Plus /> {t('jit.jitRequests.requestAccess')}</Button>}
        />
      </Card>
    )
  const sorted = [...items].sort((a, b) => Number(b.canDecide) - Number(a.canDecide) || b.id - a.id)
  return <div className="grid gap-3">{sorted.map((r) => <OpenCard key={r.id} r={r} now={now} />)}</div>
}

function OpenCard({ r, now }: { r: JitRequest; now: number }) {
  const [dialog, setDialog] = React.useState<'approve' | 'reject' | null>(null)
  const confirm = useConfirm()
  const refresh = useRefresh()
  const withdraw = useMutation({
    mutationFn: () => jitApi.withdraw(r.id),
    onSuccess: () => { toast.success(t('jit.jitRequests.requestIdWithdrawn', { id: r.id })); refresh() },
  })
  const expiresMs = r.approvalExpiresAt ? new Date(r.approvalExpiresAt).getTime() - now : null

  return (
    <Card className={cn('relative overflow-hidden', r.canDecide && 'border-amber-500/40 shadow-md shadow-amber-500/5')} data-testid={`jit-request-${r.id}`}>
      {r.canDecide && <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-amber-500/[0.08] to-transparent" />}
      <div className="relative grid gap-3 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-6">
        <div className="grid min-w-0 gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Heading r={r} />
            <JitStatusBadge status={r.status} />
          </div>
          <Facts r={r} now={now} />
          <Justification text={r.justification} />
          {r.status === 'Pending' && r.approvalExpiresAt && (
            <p className={cn('flex items-center gap-1.5 text-xs text-muted-foreground', expiresMs !== null && expiresMs < 3_600_000 && 'text-rose-700 dark:text-rose-300')} title={formatDateTime(r.approvalExpiresAt)}>
              <Hourglass className="size-3.5" /> {t('jit.jitRequests.approvalPossibleUntil')} {formatDateTime(r.approvalExpiresAt)}
            </p>
          )}
          {r.status === 'Approved' && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-sky-700 dark:text-sky-300">
              <Loader2 className="size-3.5 animate-spin" />
              {r.decidedBy ? t('jit.jitRequests.approvedByAdding', { by: r.decidedBy }) : t('jit.jitRequests.adding')}
              {r.runId && <Link to={`/laeufe/${r.runId}`} className="underline-offset-2 hover:underline">{t('jit.jitRequests.runParen', { id: r.runId })}</Link>}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 lg:w-56 lg:border-l lg:pl-6">
          {r.canDecide ? (
            <>
              <Button className="w-full bg-emerald-600 text-white hover:bg-emerald-600/90" onClick={() => setDialog('approve')}><ShieldCheck /> {t('jit.jitRequests.approve')}</Button>
              <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={() => setDialog('reject')}><ShieldX /> {t('jit.jitRequests.reject')}</Button>
            </>
          ) : r.canWithdraw ? (
            <>
              <p className="text-xs text-muted-foreground">
                {r.approvalRequired ? t('jit.jitRequests.waitingForASecondPerson') : t('jit.jitRequests.grantedWithoutApproval')}
              </p>
              <Button
                variant="outline"
                className="w-full"
                loading={withdraw.isPending}
                onClick={async () => {
                  if (await confirm({ title: t('jit.jitRequests.withdrawRequestId', { id: r.id }), description: t('jit.jitRequests.accessWillNotBeGranted'), confirmText: t('jit.jitRequests.withdraw'), cancelText: t('jit.jitRequests.keep'), destructive: true }))
                    withdraw.mutate()
                }}
              >
                {!withdraw.isPending && <Undo2 />} {t('jit.jitRequests.withdraw')}
              </Button>
            </>
          ) : r.status === 'Pending' ? (
            <p className="text-xs text-muted-foreground">{t('jit.jitRequests.operatorsWhoDidNotSubmit')}</p>
          ) : null}
        </div>
      </div>
      <DecisionDialog r={r} mode={dialog} onClose={() => setDialog(null)} onDone={refresh} />
    </Card>
  )
}

function DecisionDialog({ r, mode, onClose, onDone }: { r: JitRequest; mode: 'approve' | 'reject' | null; onClose: () => void; onDone: () => void }) {
  const [comment, setComment] = React.useState('')
  const [touched, setTouched] = React.useState(false)
  React.useEffect(() => { if (mode) { setComment(''); setTouched(false) } }, [mode])
  const approve = mode === 'approve'
  const decide = useMutation({
    mutationFn: () => (approve ? jitApi.approve(r.id, comment.trim() || undefined) : jitApi.reject(r.id, comment.trim())),
    meta: { silent: true },
    onSuccess: () => {
      toast.success(approve ? t('jit.jitRequests.requestIdApproved', { id: r.id }) : t('jit.jitRequests.requestIdRejected', { id: r.id }), {
        description: approve ? t('jit.jitRequests.theMembershipIsNowBeing') : undefined,
      })
      onDone()
      onClose()
    },
    onError: (e) => {
      const status = e instanceof ApiError ? e.status : 0
      toast.error(approve ? t('jit.jitRequests.approvalNotPossible') : t('jit.jitRequests.rejectionNotPossible'), {
        description: status === 409 ? t('jit.jitRequests.theRequestIsNoLonger') : status === 403 ? t('jit.jitRequests.onlyASecondPersonCan') : errorMessage(e),
      })
      if (status === 409 || status === 403) { onDone(); onClose() }
    },
  })
  const missing = !approve && !comment.trim()
  return (
    <Dialog open={!!mode} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!missing) decide.mutate() }}>
          <DialogHeader>
            <div className="flex items-start gap-3">
              <span className={cn('grid size-9 shrink-0 place-content-center rounded-full', approve ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-destructive/10 text-destructive')}>
                {approve ? <ShieldCheck className="size-4" /> : <ShieldX className="size-4" />}
              </span>
              <div className="grid gap-1.5">
                <DialogTitle>{approve ? t('jit.jitRequests.approveRequestId', { id: r.id }) : t('jit.jitRequests.rejectRequestId', { id: r.id })}</DialogTitle>
                <DialogDescription>
                  {rich(t(approve ? 'jit.jitRequests.decisionApprove' : 'jit.jitRequests.decisionReject', { duration: formatMinutes(r.minutes), by: r.requestedBy }), {
                    account: <span className="font-mono text-foreground">{r.memberAccount}</span>,
                    group: <span className="font-medium text-foreground">{r.groupDisplayName}</span>,
                  })}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <Field label={approve ? t('jit.jitRequests.commentOptional') : t('jit.jitRequests.justification')} htmlFor="jit-decision" required={!approve} error={touched && missing ? t('jit.jitRequests.aJustificationIsRequired') : undefined} className="sm:pl-12">
            <Textarea id="jit-decision" autoFocus rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)}
              placeholder={approve ? t('jit.jitRequests.eGChangeChg1234') : t('jit.jitRequests.eGNoApprovedChange')} aria-invalid={(touched && missing) || undefined} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" variant={approve ? 'default' : 'destructive'} className={approve ? 'bg-emerald-600 text-white hover:bg-emerald-600/90' : undefined} loading={decide.isPending}>
              {!decide.isPending && (approve ? <ShieldCheck /> : <ShieldX />)}{approve ? t('jit.jitRequests.approve2') : t('jit.jitRequests.reject2')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------ active grants

export function ActiveList({ items }: { items: JitRequest[] }) {
  const now = useNow(1000)
  if (items.length === 0)
    return (
      <Card>
        <EmptyState icon={<KeyRound />} title={t('jit.jitRequests.noActiveAccess')} description={t('jit.jitRequests.grantedTimeLimitedMembershipsAppear')} />
      </Card>
    )
  return <div className="grid gap-3 md:grid-cols-2">{items.map((r) => <ActiveCard key={r.id} r={r} now={now} />)}</div>
}

function ActiveCard({ r, now }: { r: JitRequest; now: number }) {
  const confirm = useConfirm()
  const refresh = useRefresh()
  const revoke = useMutation({
    mutationFn: () => jitApi.revoke(r.id),
    meta: { silent: true },
    onSuccess: () => { toast.success(t('jit.jitRequests.revokingAccessId', { id: r.id })); refresh() },
    onError: (e) => toast.error(t('jit.jitRequests.revokingNotPossible'), { description: errorMessage(e) }),
  })
  const share = remainingShare(r, now)
  const countdown = formatCountdown(r.expiresAt, now)
  const low = share < 0.15
  return (
    <Card className="overflow-hidden" data-testid={`jit-active-${r.id}`}>
      <div className="grid gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Heading r={r} />
          {r.revokeRunId ? <Badge variant="info"><Loader2 className="animate-spin" /> {t('jit.jitRequests.beingRevoked')}</Badge> : <JitStatusBadge status={r.status} />}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">{t('jit.jitRequests.remaining')}</p>
            <p className={cn('font-mono text-3xl font-semibold tracking-tight tabular', low ? 'text-rose-600 dark:text-rose-400' : 'text-foreground')} aria-label={t('jit.jitRequests.remainingTime')} data-testid="jit-countdown">
              {countdown}
            </p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p className="flex items-center justify-end gap-1"><Clock className="size-3.5" /> {t('jit.jitRequests.until')} {formatDateTime(r.expiresAt)}</p>
            {r.dc && <p className="font-mono">{r.dc}</p>}
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
          <div className={cn('h-full rounded-full transition-[width] duration-1000', low ? 'bg-rose-500' : 'bg-emerald-500')} style={{ width: `${share * 100}%` }} />
        </div>
        <Facts r={r} now={now} />
        <p className="text-xs text-muted-foreground">
          {r.decidedBy ? <>{t('jit.jitRequests.approvedBy')} <span className="text-foreground">{r.decidedBy}</span></> : t('jit.jitRequests.grantedWithoutApproval2')}
          {r.runId && <> · <Link to={`/laeufe/${r.runId}`} className="hover:underline">{t('jit.jitRequests.run')}{r.runId}</Link></>}
        </p>
        {r.message && <p className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-1.5 text-xs text-rose-800 dark:text-rose-200">{r.message}</p>}
        {r.canRevoke && (
          <Button
            variant="outline"
            className="w-full text-destructive hover:text-destructive sm:w-auto sm:justify-self-end"
            loading={revoke.isPending}
            onClick={async () => {
              if (await confirm({
                title: t('jit.jitRequests.revokeAccessIdEarly', { id: r.id }),
                description: t('jit.jitRequests.memberaccountIsRemovedFromGroupdisplayname', { memberAccount: r.memberAccount, groupDisplayName: r.groupDisplayName }),
                confirmText: t('jit.jitRequests.revoke'),
                cancelText: t('jit.jitRequests.keep'),
                destructive: true,
              }))
                revoke.mutate()
            }}
          >
            {!revoke.isPending && <UserX />} {t('jit.jitRequests.revoke')}
          </Button>
        )}
      </div>
    </Card>
  )
}

// ------------------------------------------------------------------ history

export function HistoryList({ items }: { items: JitRequest[] }) {
  const now = useNow(60_000)
  if (items.length === 0)
    return (
      <Card>
        <EmptyState icon={<History />} title={t('jit.jitRequests.noHistoryYet')} description={t('jit.jitRequests.expiredRevokedRejectedAndFailed')} />
      </Card>
    )
  return (
    <Card className="divide-y">
      {items.map((r) => (
        <div key={r.id} className="grid gap-1.5 px-4 py-3 sm:px-5" data-testid={`jit-history-${r.id}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Heading r={r} />
            <JitStatusBadge status={r.status} />
          </div>
          <Facts r={r} now={now} />
          <p className="text-xs text-muted-foreground break-words">{outcome(r)}</p>
        </div>
      ))}
    </Card>
  )
}

function outcome(r: JitRequest): string {
  const parts: string[] = []
  if (r.decidedBy) parts.push(`${r.status === 'Rejected' ? t('jit.jitRequests.rejected') : t('jit.jitRequests.approved')} von ${r.decidedBy}${r.decisionComment ? `: „${r.decisionComment}“` : ''}`)
  if (r.grantedAt) parts.push(t('jit.jitRequests.grantedAt', { at: formatDateTime(r.grantedAt) }))
  if (r.status === 'Expired' && r.expiresAt) parts.push(t('jit.jitRequests.expiredAt', { at: formatDateTime(r.expiresAt) }))
  if (r.status === 'Revoked' && r.revokedAt) parts.push(r.revokedBy ? t('jit.jitRequests.revokedAtBy', { at: formatDateTime(r.revokedAt), by: r.revokedBy }) : t('jit.jitRequests.revokedAt', { at: formatDateTime(r.revokedAt) }))
  if (r.message) parts.push(r.message)
  return parts.join(' · ') || t('jit.jitRequests.requestedRequestedat', { requestedAt: formatDateTime(r.requestedAt) })
}
