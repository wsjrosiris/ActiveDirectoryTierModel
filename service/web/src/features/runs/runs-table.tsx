import * as React from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { Activity, Ban, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { RunKind, RunStatus } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Tooltip } from '@/components/ui/tooltip'
import { useCan } from '@/features/auth/auth'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { DriftBadge, RunKindLabel, RunStatusBadge } from '@/components/shared/badges'
import { includeLabels, scopeLabels } from '@/lib/labels'
import { formatDateTime, formatDuration, formatNumber, formatRelative } from '@/lib/utils'

export function RunsTable({
  kind,
  status,
  pageSize = 25,
  hideKind,
  emptyAction,
}: {
  kind?: RunKind | ''
  status?: RunStatus | ''
  pageSize?: number
  hideKind?: boolean
  emptyAction?: React.ReactNode
}) {
  const [page, setPage] = React.useState(1)
  React.useEffect(() => setPage(1), [kind, status])
  const navigate = useNavigate()
  const q = useQuery({
    queryKey: ['runs', { kind, status, page, pageSize }],
    queryFn: () => api.runs.list({ kind, status, page, pageSize }),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.items.some((r) => r.status === 'Running' || r.status === 'Queued') ? 3000 : 15000),
  })
  const total = q.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const items = q.data?.items ?? []
  const [now, setNow] = React.useState(Date.now())
  React.useEffect(() => {
    if (!items.some((r) => r.status === 'Running')) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [items])

  return (
    <Card className="overflow-hidden">
      {q.isLoading ? (
        <div className="grid gap-2 p-5">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Activity />} title="Keine Läufe" description={kind || status ? 'Für diese Filter gibt es keine Läufe.' : 'Es wurden noch keine Deploys, Audits oder Überwachungen gestartet.'} action={emptyAction} />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH className="w-16">#</TH>
              {!hideKind && <TH>Art</TH>}
              <TH>Status</TH>
              <TH className="hidden xl:table-cell">Bereich</TH>
              {kind !== 'Deploy' && <TH>Drift</TH>}
              <TH className="hidden 2xl:table-cell">DC</TH>
              <TH className="hidden md:table-cell">Angefordert</TH>
              <TH className="text-right">Dauer</TH>
            </TR>
          </THead>
          <TBody className={q.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
            {items.map((r) => (
              <TR key={r.id} className="cursor-pointer" onClick={() => navigate(`/laeufe/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/laeufe/${r.id}`)} tabIndex={0} role="link" aria-label={`Lauf ${r.id} öffnen`}>
                <TD className="font-mono text-xs text-muted-foreground">#{r.id}</TD>
                {!hideKind && <TD><RunKindLabel run={r} /></TD>}
                <TD><RunStatusBadge status={r.status} scheduledFor={r.scheduledFor} /></TD>
                <TD className="hidden xl:table-cell">
                  <span className="text-[13px]">{r.kind === 'Monitor' ? 'Privilegierte Gruppen' : r.scope ? scopeLabels[r.scope] : 'Nur Add-ons'}</span>
                  {r.includes.length > 0 && <span className="ml-1.5 text-xs text-muted-foreground">+ {r.includes.map((i) => includeLabels[i] ?? i).join(', ')}</span>}
                </TD>
                {kind !== 'Deploy' && <TD>{r.kind !== 'Deploy' ? <DriftBadge count={r.driftCount} monitor={r.kind === 'Monitor'} /> : <span className="text-muted-foreground">–</span>}</TD>}
                <TD className="hidden font-mono text-xs text-muted-foreground 2xl:table-cell">{r.preferredDc}</TD>
                <TD className="hidden md:table-cell">
                  <div className="text-[13px]" title={formatDateTime(r.createdAt)}>{formatRelative(r.createdAt)}</div>
                  <div className="text-xs text-muted-foreground">{r.trigger === 'Schedule' ? 'Zeitplan' : r.requestedBy}</div>
                </TD>
                <TD className="text-right text-[13px] text-muted-foreground tabular">
                  {r.status === 'Scheduled' ? <CancelScheduled id={r.id} /> : formatDuration(r.startedAt, r.finishedAt, now)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {total > 0 && (
        <div className="flex items-center justify-between gap-2 border-t bg-muted/20 px-5 py-2 text-xs text-muted-foreground">
          <span>
            {formatNumber((page - 1) * pageSize + 1)}–{formatNumber(Math.min(page * pageSize, total))} von {formatNumber(total)}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Vorherige Seite"><ChevronLeft /></Button>
            <span className="px-1 tabular">Seite {page} / {pages}</span>
            <Button variant="ghost" size="icon-xs" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Nächste Seite"><ChevronRight /></Button>
          </div>
        </div>
      )}
    </Card>
  )
}

/** Scheduled applies (waiting for a maintenance window) can be cancelled right from the list. */
function CancelScheduled({ id }: { id: number }) {
  const canCancel = useCan('Operator')
  const confirm = useConfirm()
  const qc = useQueryClient()
  const cancel = useMutation({
    mutationFn: () => api.runs.cancel(id),
    onSuccess: () => {
      toast.success(`Geplanter Lauf #${id} abgebrochen`)
      qc.invalidateQueries({ queryKey: ['runs'] })
    },
  })
  if (!canCancel) return <span>–</span>
  return (
    <Tooltip content="Geplanten Lauf abbrechen">
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-destructive hover:text-destructive"
        aria-label={`Geplanten Lauf #${id} abbrechen`}
        loading={cancel.isPending}
        onClick={async (e) => {
          e.stopPropagation()
          if (await confirm({ title: `Lauf #${id} abbrechen?`, description: 'Der Lauf wird nicht im Wartungsfenster gestartet.', confirmText: 'Lauf abbrechen', cancelText: 'Geplant lassen', destructive: true }))
            cancel.mutate()
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {!cancel.isPending && <Ban />}
      </Button>
    </Tooltip>
  )
}
