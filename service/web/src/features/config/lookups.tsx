import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Asterisk, Building2, FolderArchive, Languages, Server, Shapes, Users } from 'lucide-react'
import { api } from '@/api/client'
import { Combobox, type ComboOption } from '@/components/ui/combobox'
import { MultiCombobox } from '@/components/ui/multi-combobox'
import { useGroupOptions } from './form-helpers'
import { useSectionContent } from './draft-store'
import { sectionQuery } from './queries'

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
    const tt = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(tt)
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
export function usePrincipalOptions(search: string, opts: { sidValues?: boolean; by?: 'samaccountname' | 'name' } = {}) {
  const configured = useGroupOptions(opts.by ?? 'samaccountname')
  const { groups, loading } = useAdGroupSearch(search)
  const options = React.useMemo(() => {
    const out: ComboOption[] = opts.sidValues ? [] : [...configured]
    for (const g of groups) {
      const value = opts.sidValues ? g.sid : opts.by === 'name' ? g.name : g.samAccountName
      if (out.some((o) => o.value.toLowerCase() === value.toLowerCase())) continue
      out.push({
        value,
        label: g.name,
        hint: opts.sidValues ? g.sid : (g.description ?? g.distinguishedName ?? 'Active Directory'),
        icon: <Building2 className="size-4 text-sky-600" />,
      })
    }
    return out
  }, [configured, groups, opts.sidValues, opts.by])
  return { options, loading }
}

type ComboProps = React.ComponentProps<typeof Combobox>

/** Combobox for a principal (group / built-in account) with live AD search while typing. */
export function PrincipalCombobox({ by, ...props }: Omit<ComboProps, 'options' | 'onSearchChange' | 'loading'> & { by?: 'samaccountname' | 'name' }) {
  const [search, setSearch] = React.useState('')
  const { options, loading } = usePrincipalOptions(search, { by })
  return <Combobox {...props} options={options} onSearchChange={setSearch} loading={loading} searchPlaceholder={props.searchPlaceholder ?? 'Gruppe suchen (auch im AD) …'} />
}

type MultiProps = React.ComponentProps<typeof MultiCombobox>

/** Multi-select of principals with live AD search while typing. */
export function PrincipalMultiCombobox({ by, ...props }: Omit<MultiProps, 'options' | 'onSearchChange' | 'loading'> & { by?: 'samaccountname' | 'name' }) {
  const [search, setSearch] = React.useState('')
  const { options, loading } = usePrincipalOptions(search, { by })
  return <MultiCombobox {...props} options={options} onSearchChange={setSearch} loading={loading} />
}

export const principalIcon = <Users className="size-4 text-muted-foreground" />

/* ---------------------------------------------------------------- ADML languages */

export const COMMON_LANGUAGES: { code: string; name: string }[] = [
  { code: 'en-US', name: 'Englisch (USA)' },
  { code: 'de-DE', name: 'Deutsch (Deutschland)' },
  { code: 'en-GB', name: 'Englisch (Vereinigtes Königreich)' },
  { code: 'fr-FR', name: 'Französisch (Frankreich)' },
  { code: 'es-ES', name: 'Spanisch (Spanien)' },
  { code: 'it-IT', name: 'Italienisch (Italien)' },
  { code: 'nl-NL', name: 'Niederländisch (Niederlande)' },
  { code: 'pt-BR', name: 'Portugiesisch (Brasilien)' },
  { code: 'pl-PL', name: 'Polnisch (Polen)' },
  { code: 'sv-SE', name: 'Schwedisch (Schweden)' },
  { code: 'ja-JP', name: 'Japanisch (Japan)' },
  { code: 'zh-CN', name: 'Chinesisch (vereinfacht)' },
]

export const LANGUAGE_RE = /^[a-z]{2,3}-[A-Z]{2,4}$/

export function languageError(v: string): string | null {
  return !v || LANGUAGE_RE.test(v) ? null : 'Format: Sprache-REGION, z. B. en-US oder de-DE'
}

/** ADML languages: those present in the template folder first, then common codes. */
export function useLanguageOptions(): ComboOption[] {
  const { data } = useTemplateFiles()
  return React.useMemo(() => {
    const available = data?.languages ?? []
    const opts: ComboOption[] = available.map((code) => ({
      value: code,
      label: code,
      hint: `${COMMON_LANGUAGES.find((l) => l.code === code)?.name ?? 'Sprache'} · ${data?.adml?.[code]?.length ?? 0} ADML-Dateien vorhanden`,
      icon: <Languages className="size-4 text-emerald-600" />,
    }))
    for (const l of COMMON_LANGUAGES)
      if (!opts.some((o) => o.value.toLowerCase() === l.code.toLowerCase()))
        opts.push({ value: l.code, label: l.code, hint: `${l.name} · keine Vorlagen vorhanden`, icon: <Languages className="size-4 text-muted-foreground" /> })
    return opts
  }, [data])
}

/* ---------------------------------------------------------------- object types (guid-mappings) */

export const ALL_OBJECTS_LABEL = '(alle Objekte)'

const categoryLabels: Record<string, string> = {
  objectClasses: 'Objektklasse',
  extendedRights: 'Erweitertes Recht',
  attributes: 'Attribut',
}

/** Every name the framework can resolve for objecttype / inheritedobjecttype, from the guid-mappings section. */
export function useObjectTypeOptions(extra: string[] = []): ComboOption[] {
  useQuery(sectionQuery('guid-mappings'))
  const content = useSectionContent('guid-mappings')
  const extraKey = extra.join('|')
  return React.useMemo(() => {
    const opts: ComboOption[] = [{ value: '', label: ALL_OBJECTS_LABEL, hint: 'Kein Objekttyp – gilt für alle Objekte', icon: <Asterisk className="size-4 text-muted-foreground" /> }]
    const seen = new Set<string>([''])
    const push = (value: string, hint: string) => {
      if (!value || seen.has(value.toLowerCase())) return
      seen.add(value.toLowerCase())
      opts.push({ value, hint, icon: <Shapes className="size-4 text-muted-foreground" /> })
    }
    for (const kind of ['staticMappings', 'dynamicMappings'] as const) {
      const block = content?.[kind]
      if (!block || typeof block !== 'object') continue
      for (const cat of ['objectClasses', 'extendedRights', 'attributes']) {
        const map = block[cat]
        if (!map || typeof map !== 'object') continue
        for (const [name, v] of Object.entries(map)) {
          if (name === 'comment') continue
          push(name, `${categoryLabels[cat]} · ${kind === 'dynamicMappings' ? 'dynamisch aufgelöst' : String(v)}`)
        }
      }
    }
    const special = content?.specialValues
    if (special && typeof special === 'object')
      for (const [name, v] of Object.entries(special)) if (name !== 'comment') push(name, `Sonderwert${v ? ` · ${String(v)}` : ''}`)
    const friendly = content?.friendlyNameMappings
    if (friendly && typeof friendly === 'object')
      for (const [name, v] of Object.entries(friendly)) if (name !== 'comment') push(name, `Alias für ${String(v)}`)
    for (const e of extra) push(e, 'In der Konfiguration verwendet')
    return opts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, extraKey])
}
