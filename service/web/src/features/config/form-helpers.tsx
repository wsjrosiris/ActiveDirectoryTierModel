import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Combobox, type ComboOption } from '@/components/ui/combobox'
import { Switch } from '@/components/ui/switch'
import { ouDnOptions, type OuItem } from '@/lib/ou'
import { tierOf } from '@/lib/tier'
import { cn } from '@/lib/utils'
import { TierDot } from '@/components/shared/badges'
import { sectionQuery } from './queries'
import { useSectionContent } from './draft-store'
import type { Item } from './list-editor'
import { t } from '@/i18n'

/** Set a field while preserving all other (possibly unknown) keys.
 *  Optional fields are removed when cleared, so we never introduce empty keys. */
export function setField(value: Item, key: string, v: unknown, optional = false): Item {
  const next = { ...value }
  if (optional && (v === '' || v === undefined || v === null || (Array.isArray(v) && v.length === 0))) delete next[key]
  else next[key] = v
  return next
}

export function SwitchRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
}: {
  id: string
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border bg-card px-3.5 py-3 transition-colors hover:bg-accent/40 has-[:disabled]:cursor-default has-[:disabled]:hover:bg-card">
      <div className="grid gap-0.5">
        <span className="text-[13px] font-medium">{label}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} className="mt-0.5" />
    </label>
  )
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4">
      <div>
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

export function CheckboxGrid({
  options,
  value,
  onChange,
  columns = 3,
  describe,
}: {
  options: string[]
  value: string[]
  onChange: (v: string[]) => void
  columns?: 2 | 3
  describe?: Record<string, string>
}) {
  const set = new Set(value)
  const extras = value.filter((v) => !options.includes(v))
  return (
    <div className={cn('grid gap-1.5', columns === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2')}>
      {[...options, ...extras].map((o) => {
        const id = `cb-${o}`
        const checked = set.has(o)
        return (
          <label
            key={o}
            htmlFor={id}
            title={describe?.[o]}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-[12.5px] transition-colors hover:bg-accent/50',
              checked && 'border-primary/40 bg-primary/5',
            )}
          >
            <Checkbox
              id={id}
              checked={checked}
              onCheckedChange={(c) => {
                const next = new Set(set)
                if (c) next.add(o)
                else next.delete(o)
                // keep canonical order: known options first, then extras
                onChange([...options, ...extras].filter((x) => next.has(x)))
              }}
            />
            <span className="truncate font-mono">{o}</span>
          </label>
        )
      })}
    </div>
  )
}

/** Multi-select as removable chips + combobox for adding. */
export function ChipsInput({
  value,
  onChange,
  options,
  placeholder,
  id,
}: {
  value: string[]
  onChange: (v: string[]) => void
  options: ComboOption[]
  placeholder: string
  id?: string
}) {
  return (
    <div className="grid gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-md border bg-secondary py-0.5 pr-1 pl-2 font-mono text-xs">
              {v}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== v))}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={t('config.formHelpers.removeV', { v })}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Combobox
        id={id}
        value=""
        onChange={(v) => v && !value.includes(v) && onChange([...value, v])}
        options={options.filter((o) => !value.includes(o.value))}
        placeholder={placeholder}
      />
    </div>
  )
}

export const builtinPrincipals = [
  'Domain Admins',
  'Enterprise Admins',
  'Schema Admins',
  'Administrators',
  'Account Operators',
  'Authenticated Users',
  'Domain Computers',
  'SELF',
  'Everyone',
]

/** OU DN options (full DN) built from the draft-aware ous section. */
export function useOuOptions(): ComboOption[] {
  useQuery(sectionQuery('ous'))
  const content = useSectionContent('ous')
  return React.useMemo(
    () =>
      ouDnOptions((content?.organizationUnits ?? []) as OuItem[]).map((o) => ({
        value: o.value,
        label: o.label,
        hint: o.value,
        icon: <TierDot tier={tierOf(o.value)} />,
      })),
    [content],
  )
}

export function useGroupOptions(by: 'samaccountname' | 'name' = 'samaccountname'): ComboOption[] {
  useQuery(sectionQuery('groups'))
  const content = useSectionContent('groups')
  return React.useMemo(() => {
    const groups = (content?.groups ?? []) as Item[]
    const opts: ComboOption[] = groups.map((g) => ({
      value: String(g[by] ?? ''),
      label: String(g[by] ?? ''),
      hint: by === 'samaccountname' ? g.name : g.samaccountname,
      icon: <TierDot tier={tierOf(g.name ?? g.samaccountname)} />,
    }))
    for (const b of builtinPrincipals) if (!opts.some((o) => o.value === b)) opts.push({ value: b, label: b, hint: t('config.formHelpers.builtIn') })
    return opts.filter((o) => o.value)
  }, [content, by])
}

export function useGpoNameOptions(): ComboOption[] {
  useQuery(sectionQuery('gpos'))
  const content = useSectionContent('gpos')
  return React.useMemo(() => {
    const names = new Set<string>()
    const map = content?.gpos as Record<string, Item> | undefined
    if (map)
      for (const v of Object.values(map))
        for (const k of ['ImportOnlyGpo', 'PostConfigureGpo'])
          if (Array.isArray(v?.[k])) v[k].forEach((g: Item) => g?.name && names.add(g.name))
    return [...names].sort().map((n) => ({ value: n }))
  }, [content])
}
