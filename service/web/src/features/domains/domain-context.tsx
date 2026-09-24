import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { domainsApi, type Domain } from '@/api/domains'
import { useUser } from '@/features/auth/auth'
import { draftStore } from '@/features/config/draft-store'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { FullPageSpinner } from '@/components/layout/full-page-spinner'
import { getDomainKey, readStoredDomain, setDomainKey, storeDomain } from '@/lib/domain'
import { t } from '@/i18n'

/* The managed domain the UI works on (roadmap 17). Chosen per user (localStorage), sent as header on every API call,
 * part of every query hash; configuration drafts are kept per domain. */

interface DomainContextValue {
  /** All domains (also disabled ones: runs of them stay readable). */
  domains: Domain[]
  /** Enabled domains; the switcher only appears when there is more than one. */
  enabled: Domain[]
  current: Domain | null
  /** More than one enabled domain: the UI names the domain. */
  multiple: boolean
  byId: (id: number | undefined | null) => Domain | undefined
  switchTo: (key: string) => Promise<boolean>
}

const Ctx = React.createContext<DomainContextValue | null>(null)

export const domainsQueryKey = ['domains'] as const

export function useDomainsQuery() {
  return useQuery({ queryKey: domainsQueryKey, queryFn: domainsApi.list, staleTime: 60_000, meta: { silent: true } })
}

function resolve(domains: Domain[], wanted: string | null): Domain | null {
  const enabled = domains.filter((d) => d.enabled)
  return (
    enabled.find((d) => wanted && d.key.toLowerCase() === wanted.toLowerCase()) ??
    enabled.find((d) => d.isDefault) ??
    enabled[0] ??
    domains[0] ??
    null
  )
}

export function DomainProvider({ children }: { children: React.ReactNode }) {
  const user = useUser()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const q = useDomainsQuery()
  const [wanted, setWanted] = React.useState<string | null>(() => readStoredDomain(user.username))
  const domains = React.useMemo(() => q.data ?? [], [q.data])
  const current = React.useMemo(() => resolve(domains, wanted), [domains, wanted])

  // Must be known before any page renders its queries (the query hash and the header depend on it).
  if (current && getDomainKey() !== current.key) {
    setDomainKey(current.key)
    draftStore.adoptDomain(current.key)
  }

  // Unsaved drafts parked in other domains are lost on reload: ask before leaving the page.
  React.useEffect(() => {
    const on = (e: BeforeUnloadEvent) => {
      const counts = draftStore.dirtyCounts()
      if (Object.keys(counts).some((k) => k !== getDomainKey())) e.preventDefault()
    }
    window.addEventListener('beforeunload', on)
    return () => window.removeEventListener('beforeunload', on)
  }, [])

  const switchTo = React.useCallback(
    async (key: string) => {
      const target = domains.find((d) => d.key === key)
      if (!target || target.key === current?.key) return false
      const dirty = draftStore.dirtyKeys().length
      if (dirty > 0) {
        const ok = await confirm({
          title: t('domains.domainContext.switchToDomainDisplayname', { displayName: target.displayName }),
          description: t('domains.domainContext.switchDescription', { count: dirty, name: current?.displayName }),
          confirmText: t('domains.domainContext.switch'),
          cancelText: t('domains.domainContext.stayHere'),
        })
        if (!ok) return false
      }
      await qc.cancelQueries()
      setDomainKey(target.key)
      draftStore.switchDomain(target.key)
      storeDomain(user.username, target.key)
      setWanted(target.key)
      const parked = draftStore.getState().drafts
      toast.success(t('domains.domainContext.domainDisplayname', { displayName: target.displayName }), {
        description: Object.keys(parked).length > 0 ? t('domains.domainContext.yourDraftsForThisDomain') : target.dnsName || undefined,
        duration: 2500,
      })
      return true
    },
    [domains, current, confirm, qc, user.username],
  )

  const value = React.useMemo<DomainContextValue>(() => {
    const enabled = domains.filter((d) => d.enabled)
    return {
      domains,
      enabled,
      current,
      multiple: enabled.length > 1,
      byId: (id) => domains.find((d) => d.id === id),
      switchTo,
    }
  }, [domains, current, switchTo])

  // Older service without domains: continue without header.
  if (q.isLoading) return <FullPageSpinner />
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDomains(): DomainContextValue {
  const v = React.useContext(Ctx)
  if (!v) throw new Error('useDomains outside DomainProvider')
  return v
}

/** Like useDomains, but usable outside the provider (e.g. in tests or the login page). */
export function useOptionalDomains(): DomainContextValue | null {
  return React.useContext(Ctx)
}
