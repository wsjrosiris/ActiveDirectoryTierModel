import * as React from 'react'
import { ShieldAlert, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buildGroupTierMap, type GroupTierMap, type TierIssue } from '@/lib/tier-rules'
import { useSectionContent } from './draft-store'

/** Tiers of the configured groups (draft included), for live tier-rule checks. */
export function useGroupTierMap(): GroupTierMap {
  const content = useSectionContent('groups') as { groups?: Record<string, unknown>[] } | undefined
  return React.useMemo(() => buildGroupTierMap(content?.groups ?? []), [content])
}

/** Tier-rule findings for the entry being edited; errors block nothing but are shown prominently. */
export function TierRuleAlerts({ issues }: { issues: TierIssue[] }) {
  if (issues.length === 0) return null
  return (
    <div className="grid gap-2" role="status">
      {issues.map((issue, i) => {
        const error = issue.severity === 'Error'
        const Icon = error ? ShieldAlert : TriangleAlert
        return (
          <div
            key={i}
            className={cn(
              'flex gap-3 rounded-xl border px-4 py-3 text-[13px]',
              error
                ? 'border-destructive/30 bg-destructive/10 text-destructive dark:text-red-300'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200',
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0" />
            <p className="min-w-0">{issue.message}</p>
          </div>
        )
      })}
    </div>
  )
}
