import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { GitCompareArrows, Info, Minus, Plus } from 'lucide-react'
import { api } from '@/api/client'
import type { MembershipChange } from '@/api/types'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { objectClassLabels } from '@/lib/labels'
import { cn, formatDateTime, formatRelative } from '@/lib/utils'
import { t } from '@/i18n'
import { rich } from '@/i18n/rich'

export function ChangesTab({ baseline }: { baseline: boolean }) {
  const q = useQuery({ queryKey: ['privileged', 'changes'], queryFn: () => api.privileged.changes(50), refetchInterval: 60_000 })

  if (q.isLoading) return <Skeleton className="h-72" />
  const items = q.data?.items ?? []
  if (!items.length)
    return (
      <Card>
        <EmptyState
          icon={<GitCompareArrows />}
          title={(q.data?.snapshotCount ?? 0) < 2 ? t('privileged.changesTab.noComparisonPossibleYet') : t('privileged.changesTab.noChanges')}
          description={
            (q.data?.snapshotCount ?? 0) < 2
              ? t('privileged.changesTab.theFirstCheckIsThe')
              : q.data?.firstSnapshotAt
                ? t('privileged.changesTab.noChangesSinceAt', { at: formatDateTime(q.data.firstSnapshotAt) })
                : t('privileged.changesTab.noChangesSince')
          }
        />
      </Card>
    )

  return (
    <div className="grid gap-3">
      {baseline && (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Info className="size-4 shrink-0" /> {t('privileged.changesTab.theLastCheckWasA')}
        </p>
      )}
      <Card className="px-5 py-5">
        <ol className="relative grid gap-6 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-border">
          {items.map((set) => {
            const added = set.changes.filter((c) => c.change === 'Added').length
            const removed = set.changes.length - added
            return (
              <li key={set.runId} className="relative pl-6">
                <span className="absolute top-1.5 left-0 size-[11px] rounded-full border-2 border-card bg-teal-500" aria-hidden />
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <p className="text-[13px] font-medium" title={formatDateTime(set.takenAt)}>{formatDateTime(set.takenAt)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatRelative(set.takenAt)}
                    {added > 0 && <> · <span className="text-emerald-700 dark:text-emerald-400">{t('privileged.changesTab.addedCount', { count: added })}</span></>}
                    {removed > 0 && <> · <span className="text-rose-700 dark:text-rose-400">{t('privileged.changesTab.removedCount', { count: removed })}</span></>}
                    {' · '}
                    <Link to={`/laeufe/${set.runId}`} className="hover:text-foreground hover:underline">{t('privileged.changesTab.run')}{set.runId}</Link>
                  </p>
                </div>
                <ul className="mt-2 grid gap-1.5">
                  {set.changes.map((c, i) => <ChangeRow key={i} c={c} />)}
                </ul>
              </li>
            )
          })}
        </ol>
      </Card>
    </div>
  )
}

function ChangeRow({ c }: { c: MembershipChange }) {
  const add = c.change === 'Added'
  return (
    <li className="flex items-start gap-2.5 rounded-lg border bg-muted/20 px-3 py-2 text-[13px]">
      <span
        className={cn(
          'mt-0.5 grid size-5 shrink-0 place-content-center rounded-full [&_svg]:size-3',
          add ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
        )}
        aria-label={add ? t('privileged.changesTab.added') : t('privileged.changesTab.removed')}
      >
        {add ? <Plus /> : <Minus />}
      </span>
      <div className="min-w-0">
        <p className="break-words">
          {rich(t(add ? 'privileged.changesTab.memberAdded' : 'privileged.changesTab.memberRemoved'), {
            member: <span className="font-medium">{c.memberName}</span>,
            class: <span className="text-muted-foreground"> ({objectClassLabels[c.objectClass] ?? c.objectClass})</span>,
            group: <span className="font-medium">{c.groupName}</span>,
          })}
        </p>
        {!c.direct && c.via.length > 0 && <p className="text-xs text-muted-foreground">{t('privileged.changesTab.via')} {c.via.join(' › ')}</p>}
      </div>
    </li>
  )
}
