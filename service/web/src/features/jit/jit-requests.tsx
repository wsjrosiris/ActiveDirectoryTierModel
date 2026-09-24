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

function useRefresh() {
  const qc = useQueryClient()
  return React.useCallback(() => qc.invalidateQueries({ queryKey: ['jit'] }), [qc])
}

function useNow(intervalMs: number) {
  const [now, setNow] = React.useState(Date.now())
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
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
        <UserRound className="size-3.5" />{r.requestedBy}{r.mine && <span className="text-xs">(Sie)</span>} · {formatRelative(r.requestedAt, now)}
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
          title="Keine offenen Anfragen"
          description="Anträge, die auf eine Freigabe warten oder gerade eingetragen werden, erscheinen hier."
          action={onRequest && <Button variant="outline" onClick={onRequest}><Plus /> Zugriff beantragen</Button>}
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
    onSuccess: () => { toast.success(`Antrag #${r.id} zurückgezogen`); refresh() },
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
              <Hourglass className="size-3.5" /> Freigabe möglich bis {formatDateTime(r.approvalExpiresAt)}
            </p>
          )}
          {r.status === 'Approved' && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-sky-700 dark:text-sky-300">
              <Loader2 className="size-3.5 animate-spin" />
              {r.decidedBy ? `Freigegeben von ${r.decidedBy} – ` : ''}Mitgliedschaft wird im Active Directory eingetragen
              {r.runId && <Link to={`/laeufe/${r.runId}`} className="underline-offset-2 hover:underline">(Lauf #{r.runId})</Link>}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 lg:w-56 lg:border-l lg:pl-6">
          {r.canDecide ? (
            <>
              <Button className="w-full bg-emerald-600 text-white hover:bg-emerald-600/90" onClick={() => setDialog('approve')}><ShieldCheck /> Freigeben …</Button>
              <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={() => setDialog('reject')}><ShieldX /> Ablehnen …</Button>
            </>
          ) : r.canWithdraw ? (
            <>
              <p className="text-xs text-muted-foreground">
                {r.approvalRequired ? 'Wartet auf eine zweite Person (Vier-Augen-Prinzip). Eigene Anträge können Sie nicht freigeben.' : 'Wird ohne Freigabe erteilt.'}
              </p>
              <Button
                variant="outline"
                className="w-full"
                loading={withdraw.isPending}
                onClick={async () => {
                  if (await confirm({ title: `Antrag #${r.id} zurückziehen?`, description: 'Der Zugriff wird nicht erteilt.', confirmText: 'Zurückziehen', cancelText: 'Behalten', destructive: true }))
                    withdraw.mutate()
                }}
              >
                {!withdraw.isPending && <Undo2 />} Zurückziehen
              </Button>
            </>
          ) : r.status === 'Pending' ? (
            <p className="text-xs text-muted-foreground">Freigeben können Operatoren, die den Antrag nicht selbst gestellt haben.</p>
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
      toast.success(approve ? `Antrag #${r.id} freigegeben` : `Antrag #${r.id} abgelehnt`, {
        description: approve ? 'Die Mitgliedschaft wird jetzt im Active Directory eingetragen.' : undefined,
      })
      onDone()
      onClose()
    },
    onError: (e) => {
      const status = e instanceof ApiError ? e.status : 0
      toast.error(approve ? 'Freigabe nicht möglich' : 'Ablehnung nicht möglich', {
        description: status === 409 ? 'Der Antrag wartet nicht mehr auf eine Freigabe.' : status === 403 ? 'Den eigenen Antrag kann nur eine zweite Person freigeben.' : errorMessage(e),
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
                <DialogTitle>{approve ? `Antrag #${r.id} freigeben?` : `Antrag #${r.id} ablehnen?`}</DialogTitle>
                <DialogDescription>
                  <span className="font-mono text-foreground">{r.memberAccount}</span> wird {approve ? '' : 'nicht '}für {formatMinutes(r.minutes)} Mitglied von{' '}
                  <span className="font-medium text-foreground">{r.groupDisplayName}</span>. Beantragt von {r.requestedBy}.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <Field label={approve ? 'Kommentar (optional)' : 'Begründung'} htmlFor="jit-decision" required={!approve} error={touched && missing ? 'Eine Begründung ist erforderlich.' : undefined} className="sm:pl-12">
            <Textarea id="jit-decision" autoFocus rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)}
              placeholder={approve ? 'z. B. Change CHG-1234 geprüft' : 'z. B. Kein freigegebener Change vorhanden'} aria-invalid={(touched && missing) || undefined} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Abbrechen</Button>
            <Button type="submit" variant={approve ? 'default' : 'destructive'} className={approve ? 'bg-emerald-600 text-white hover:bg-emerald-600/90' : undefined} loading={decide.isPending}>
              {!decide.isPending && (approve ? <ShieldCheck /> : <ShieldX />)}{approve ? 'Freigeben' : 'Ablehnen'}
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
        <EmptyState icon={<KeyRound />} title="Keine aktiven Zugriffe" description="Erteilte befristete Mitgliedschaften erscheinen hier mit der verbleibenden Zeit." />
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
    onSuccess: () => { toast.success(`Zugriff #${r.id} wird entzogen`); refresh() },
    onError: (e) => toast.error('Entziehen nicht möglich', { description: errorMessage(e) }),
  })
  const share = remainingShare(r, now)
  const countdown = formatCountdown(r.expiresAt, now)
  const low = share < 0.15
  return (
    <Card className="overflow-hidden" data-testid={`jit-active-${r.id}`}>
      <div className="grid gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Heading r={r} />
          {r.revokeRunId ? <Badge variant="info"><Loader2 className="animate-spin" /> Wird entzogen</Badge> : <JitStatusBadge status={r.status} />}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Verbleibend</p>
            <p className={cn('font-mono text-3xl font-semibold tracking-tight tabular', low ? 'text-rose-600 dark:text-rose-400' : 'text-foreground')} aria-label="Verbleibende Zeit" data-testid="jit-countdown">
              {countdown}
            </p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p className="flex items-center justify-end gap-1"><Clock className="size-3.5" /> bis {formatDateTime(r.expiresAt)}</p>
            {r.dc && <p className="font-mono">{r.dc}</p>}
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
          <div className={cn('h-full rounded-full transition-[width] duration-1000', low ? 'bg-rose-500' : 'bg-emerald-500')} style={{ width: `${share * 100}%` }} />
        </div>
        <Facts r={r} now={now} />
        <p className="text-xs text-muted-foreground">
          {r.decidedBy ? <>Freigegeben von <span className="text-foreground">{r.decidedBy}</span></> : 'Ohne Freigabe erteilt'}
          {r.runId && <> · <Link to={`/laeufe/${r.runId}`} className="hover:underline">Lauf #{r.runId}</Link></>}
        </p>
        {r.message && <p className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-1.5 text-xs text-rose-800 dark:text-rose-200">{r.message}</p>}
        {r.canRevoke && (
          <Button
            variant="outline"
            className="w-full text-destructive hover:text-destructive sm:w-auto sm:justify-self-end"
            loading={revoke.isPending}
            onClick={async () => {
              if (await confirm({
                title: `Zugriff #${r.id} vorzeitig entziehen?`,
                description: `${r.memberAccount} wird sofort aus ${r.groupDisplayName} entfernt. Bereits ausgestellte Kerberos-Tickets bleiben bis zu ihrem Ablauf gültig.`,
                confirmText: 'Entziehen',
                cancelText: 'Behalten',
                destructive: true,
              }))
                revoke.mutate()
            }}
          >
            {!revoke.isPending && <UserX />} Entziehen
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
        <EmptyState icon={<History />} title="Noch kein Verlauf" description="Abgelaufene, entzogene, abgelehnte und fehlgeschlagene Anträge erscheinen hier." />
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
  if (r.decidedBy) parts.push(`${r.status === 'Rejected' ? 'Abgelehnt' : 'Freigegeben'} von ${r.decidedBy}${r.decisionComment ? `: „${r.decisionComment}“` : ''}`)
  if (r.grantedAt) parts.push(`erteilt ${formatDateTime(r.grantedAt)}`)
  if (r.status === 'Expired' && r.expiresAt) parts.push(`abgelaufen ${formatDateTime(r.expiresAt)}`)
  if (r.status === 'Revoked' && r.revokedAt) parts.push(`entzogen ${formatDateTime(r.revokedAt)}${r.revokedBy ? ` von ${r.revokedBy}` : ''}`)
  if (r.message) parts.push(r.message)
  return parts.join(' · ') || `Beantragt ${formatDateTime(r.requestedAt)}`
}
