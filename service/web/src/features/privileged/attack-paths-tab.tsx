import { ArrowRight, Route, ShieldCheck, Users } from 'lucide-react'
import type { AttackPath, PrivilegedOverview } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Tooltip } from '@/components/ui/tooltip'
import { SeverityBadge } from '@/components/shared/badges'
import { aclObjectTypeLabels, rightDescriptions } from '@/lib/labels'
import { t } from '@/i18n'

export function AttackPathsTab({ data }: { data: PrivilegedOverview }) {
  const paths = data.attackPaths
  if (!paths.length)
    return (
      <Card>
        <EmptyState
          icon={<ShieldCheck />}
          title={t('privileged.attackPathsTab.noAttackPathsFound')}
          description={t('privileged.attackPathsTab.outsideTier0NobodyHas')}
        />
      </Card>
    )

  // Grouped by the Tier 0 object the right applies to.
  const byTarget = new Map<string, AttackPath[]>()
  for (const p of paths) {
    if (!byTarget.has(p.objectDn)) byTarget.set(p.objectDn, [])
    byTarget.get(p.objectDn)!.push(p)
  }

  return (
    <div className="grid gap-4">
      <p className="text-[13px] text-muted-foreground">
        {t('privileged.attackPathsTab.anyoneWithOneOfThese')}
      </p>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {[...byTarget.entries()].map(([dn, list]) => (
          <Card key={dn} className="min-w-0 overflow-hidden border-rose-500/25">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b px-5 py-3.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold tracking-tight">{list[0].objectName}</h3>
                  <Badge variant="outline">{aclObjectTypeLabels[list[0].objectType] ?? list[0].objectType}</Badge>
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={dn}>{dn}</p>
              </div>
              <Badge variant="danger"><Route /> {t('privileged.attackPathsTab.paths', { count: list.length })}</Badge>
            </div>
            <ul className="divide-y">
              {list.map((p, i) => (
                <li key={i} className="grid gap-2 px-5 py-3.5">
                  <div className="flex items-start gap-2.5">
                    <SeverityBadge severity={p.severity} className="mt-0.5" />
                    <p className="min-w-0 text-[13px] leading-5">{p.sentence}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pl-0 sm:pl-[68px]">
                    {p.rights.map((r) => (
                      <Tooltip key={r} content={rightDescriptions[r]}>
                        <span className="rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]" tabIndex={0}>{r}</span>
                      </Tooltip>
                    ))}
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <ArrowRight className="size-3" /> {p.principalName}
                    </span>
                  </div>
                  {p.membershipPath && (
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground sm:pl-[68px]">
                      <Users className="mt-0.5 size-3.5 shrink-0" /> {p.membershipPath}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  )
}
