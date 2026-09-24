import * as React from 'react'
import { Command } from 'cmdk'
import { useNavigate } from 'react-router'
import { Check, ChevronsUpDown, Network, Settings2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip } from '@/components/ui/tooltip'
import { useCan } from '@/features/auth/auth'
import { draftStore, useDraftState } from '@/features/config/draft-store'
import { cn } from '@/lib/utils'
import { useDomains } from './domain-context'
import { t } from '@/i18n'

/** Domain switcher of the top bar: only shown when more than one domain is enabled (roadmap 17). */
export function DomainSwitcher() {
  const { enabled, current, multiple, switchTo } = useDomains()
  const [open, setOpen] = React.useState(false)
  const navigate = useNavigate()
  const isAdmin = useCan('Admin')
  // Re-render when drafts change, to show which domains hold unsaved changes.
  useDraftState((s) => s.drafts)
  const dirty = draftStore.dirtyCounts()

  if (!multiple || !current) return null
  const others = Object.entries(dirty).filter(([k]) => k !== current.key).reduce((n, [, c]) => n + c, 0)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content={t('domains.domainSwitcher.switchTooltip', { name: current.dnsName ? `${current.displayName} (${current.dnsName})` : current.displayName })}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-label={t('domains.domainSwitcher.domainDisplaynameSwitchDomain', { displayName: current.displayName })}
            data-testid="domain-switcher"
            className="relative flex h-9 shrink-0 items-center gap-1.5 rounded-lg sm:min-w-0 sm:shrink sm:gap-2 border bg-card px-2.5 text-sm shadow-xs transition-colors outline-none hover:border-input hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring sm:max-w-64"
          >
            <span className="grid size-5 shrink-0 place-content-center rounded bg-primary/10 text-primary [&_svg]:size-3.5">
              <Network />
            </span>
            <span className="hidden min-w-0 flex-col text-left leading-tight sm:flex">
              <span className="truncate text-[13px] font-medium">{current.displayName}</span>
              {current.dnsName && current.dnsName !== current.displayName && (
                <span className="truncate text-[10.5px] text-muted-foreground">{current.dnsName}</span>
              )}
            </span>
            <span className="max-w-[64px] truncate font-mono text-xs sm:hidden">{current.key}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
            {others > 0 && (
              <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-amber-500 ring-2 ring-background" aria-label={t('domains.domainSwitcher.draftsInOtherDomains')} />
            )}
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] p-0" align="start">
        <Command filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)} className="flex flex-col">
          <Command.Input
            placeholder={t('domains.domainSwitcher.searchDomain')}
            className="h-10 border-b bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
            aria-label={t('domains.domainSwitcher.searchDomain2')}
          />
          <Command.List className="max-h-80 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">{t('domains.domainSwitcher.noDomainFound')}</Command.Empty>
            <Command.Group heading={t('domains.domainSwitcher.domains')} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
              {enabled.map((d) => (
                <Command.Item
                  key={d.id}
                  value={`${d.displayName} ${d.dnsName} ${d.key}`}
                  onSelect={async () => {
                    setOpen(false)
                    await switchTo(d.key)
                  }}
                  className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent"
                >
                  <Check className={cn('size-4 shrink-0 text-primary', d.key === current.key ? 'opacity-100' : 'opacity-0')} />
                  <div className="grid min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{d.displayName}</span>
                      {d.isDefault && <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">{t('domains.domainSwitcher.default')}</span>}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {d.dnsName || t('domains.domainSwitcher.dnsNameNotSet')} · <span className="font-mono">{d.key}</span>
                    </span>
                  </div>
                  {dirty[d.key] > 0 && (
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 text-[10.5px] font-semibold text-amber-800 dark:text-amber-300" title={t('common.unsavedChanges')}>
                      {dirty[d.key]} {t('domains.domainSwitcher.draft')}
                    </span>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                navigate('/admin/domaenen')
              }}
              className="flex items-center gap-2 border-t px-3 py-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Settings2 className="size-4" /> {t('domains.domainSwitcher.manageDomains')}
            </button>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** Small badge naming a domain, e.g. for runs of another domain. Only when several domains exist. */
export function DomainBadge({ id, className }: { id: number | undefined | null; className?: string }) {
  const { byId, multiple } = useDomains()
  const d = byId(id)
  if (!multiple || !d) return null
  return (
    <span
      className={cn('inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground', className)}
      title={d.dnsName ? `${d.displayName} (${d.dnsName})` : d.displayName}
    >
      <Network className="size-3 shrink-0" />
      <span className="truncate">{d.displayName}</span>
    </span>
  )
}
