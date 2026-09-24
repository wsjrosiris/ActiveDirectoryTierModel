import { ArrowRightLeft, Network } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDomains } from './domain-context'
import { t } from '@/i18n'
import { rich } from '@/i18n/rich'

/** Hint on pages of objects (runs) that belong to another domain than the selected one (roadmap 17). */
export function OtherDomainNotice({ domainId, what }: { domainId: number | undefined | null; what: string }) {
  const { current, byId, switchTo } = useDomains()
  const d = byId(domainId)
  if (!d || !current || d.id === current.id) return null
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-sky-500/30 bg-sky-500/[0.07] px-3.5 py-2.5 text-[13px]" data-testid="other-domain-notice">
      <Network className="size-4 shrink-0 text-sky-700 dark:text-sky-300" />
      <p className="min-w-0 flex-1 basis-56">
        {rich(t('domains.otherDomainNotice.belongsTo', { dns: d.dnsName ? ` (${d.dnsName})` : '', current: current.displayName }), { what, domain: <strong>{d.displayName}</strong> })}
      </p>
      {d.enabled && (
        <Button size="xs" variant="outline" onClick={() => void switchTo(d.key)}>
          <ArrowRightLeft /> {t('domains.otherDomainNotice.switchTo', { name: d.displayName })}
        </Button>
      )}
    </div>
  )
}
