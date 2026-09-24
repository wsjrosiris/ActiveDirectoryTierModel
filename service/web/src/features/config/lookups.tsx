import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Building2, FolderArchive, Server, Users } from 'lucide-react'
import { api } from '@/api/client'
import type { ComboOption } from '@/components/ui/combobox'
import { useGroupOptions } from './form-helpers'

/* Suggestions for form fields, so values are picked instead of typed from memory. */

export function useGpoBackupOptions(): ComboOption[] {
  const { data } = useQuery({ queryKey: ['lookup', 'gpo-backups'], queryFn: api.lookup.gpoBackups, staleTime: 5 * 60_000 })
  return React.useMemo(
    () =>
      (data ?? []).map((b) => ({
        value: b.path,
        label: b.displayName,
        hint: `${b.folder} · ${b.backupId}`,
        icon: <FolderArchive className="size-4 text-muted-foreground" />,
      })),
    [data],
  )
}

export function useTemplateFiles() {
  return useQuery({ queryKey: ['lookup', 'template-files'], queryFn: api.lookup.templateFiles, staleTime: 5 * 60_000 })
}

/** Domain controllers of the domain (live on the server) plus recently used ones. */
export function useDomainControllerOptions(): ComboOption[] {
  const { data } = useQuery({ queryKey: ['lookup', 'dcs'], queryFn: api.lookup.domainControllers, staleTime: 5 * 60_000 })
  return React.useMemo(() => {
    const opts: ComboOption[] = (data?.items ?? []).map((dc) => ({
      value: dc.name,
      hint: dc.site ? `Standort ${dc.site}` : 'Domänencontroller',
      icon: <Server className="size-4 text-muted-foreground" />,
    }))
    for (const r of data?.recent ?? [])
      if (!opts.some((o) => o.value.toLowerCase() === r.toLowerCase()))
        opts.push({ value: r, hint: 'Zuletzt verwendet', icon: <Server className="size-4 text-muted-foreground" /> })
    return opts
  }, [data])
}

/** Live AD group search (on the Windows server); returns nothing elsewhere. Debounced. */
export function useAdGroupSearch(search: string) {
  const [q, setQ] = React.useState('')
  React.useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])
  const query = useQuery({
    queryKey: ['lookup', 'ad-groups', q],
    queryFn: ({ signal }) => api.lookup.adGroups(q, signal),
    enabled: q.length >= 2,
    staleTime: 60_000,
  })
  return { groups: query.data?.items ?? [], available: query.data?.available ?? false, loading: query.isFetching }
}

/**
 * Principals for ACLs, rights and memberships: groups from the configuration, built-in principals
 * and – while typing – matching groups from Active Directory.
 * `value` is the sAMAccountName (as the framework expects), or `DOMAIN\\name` / SID when `sidValues`.
 */
export function usePrincipalOptions(search: string, opts: { sidValues?: boolean } = {}) {
  const configured = useGroupOptions('samaccountname')
  const { groups, loading } = useAdGroupSearch(search)
  const options = React.useMemo(() => {
    const out: ComboOption[] = opts.sidValues ? [] : [...configured]
    for (const g of groups) {
      const value = opts.sidValues ? g.sid : g.samAccountName
      if (out.some((o) => o.value.toLowerCase() === value.toLowerCase())) continue
      out.push({
        value,
        label: g.name,
        hint: opts.sidValues ? g.sid : (g.description ?? g.distinguishedName ?? 'Active Directory'),
        icon: <Building2 className="size-4 text-sky-600" />,
      })
    }
    return out
  }, [configured, groups, opts.sidValues])
  return { options, loading }
}

export const principalIcon = <Users className="size-4 text-muted-foreground" />
