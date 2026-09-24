import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Server } from 'lucide-react'
import { api } from '@/api/client'
import type { RunRequest, Scope } from '@/api/types'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { scopeLabels, scopes } from '@/lib/labels'
import { cn } from '@/lib/utils'

export const settingsQuery = { queryKey: ['settings'], queryFn: api.settings.get, staleTime: 5 * 60_000 }

const scopeDescriptions: Record<Scope, string> = {
  FullDeployment: 'OUs, Gruppen, Benutzer, ACLs, GPOs und ADMX',
  OuOnly: 'Nur die OU-Struktur',
  GroupOnly: 'Nur Sicherheitsgruppen',
  UserOnly: 'Nur Dienstkonten',
  GposOnly: 'Nur Gruppenrichtlinien',
  OuAclsOnly: 'Nur OU-Berechtigungen',
  AdmxOnly: 'Nur ADMX/ADML-Vorlagen',
}

export function emptyRunRequest(): RunRequest {
  return { preferredDc: '', scope: 'FullDeployment', includeMsa: false, includeGmsa: false, includeDmsa: false, includeWinLaps: false }
}

export function hasInclude(r: RunRequest) {
  return r.includeMsa || r.includeGmsa || r.includeDmsa || r.includeWinLaps
}

export function runRequestError(r: RunRequest): string | null {
  if (!r.preferredDc.trim()) return 'Bitte einen Domain Controller angeben.'
  if (r.scope === null && !hasInclude(r)) return 'Ohne Bereich muss mindestens ein Add-on aktiviert sein.'
  if (!includesAllowed(r.scope) && hasInclude(r)) return 'Add-ons sind nur mit „Vollständig“ oder „Kein Bereich“ möglich.'
  return null
}

/** The framework scripts accept -Include* switches only together with -FullDeployment or on their own. */
export function includesAllowed(scope: RunRequest['scope']) {
  return scope === null || scope === 'FullDeployment'
}

/** Fills preferredDc / admlLanguage from settings once they are loaded. */
export function useRunRequestDefaults(value: RunRequest, onChange: (v: RunRequest) => void) {
  const settings = useQuery(settingsQuery)
  const applied = React.useRef(false)
  React.useEffect(() => {
    if (applied.current || !settings.data) return
    applied.current = true
    onChange({
      ...value,
      preferredDc: value.preferredDc || settings.data.defaultPreferredDc,
      admlLanguage: value.admlLanguage || settings.data.admlLanguage,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data])
  return settings.data
}

export function RunRequestFields({
  value,
  onChange,
  idPrefix,
  disabled,
  compact,
}: {
  value: RunRequest
  onChange: (v: RunRequest) => void
  idPrefix: string
  disabled?: boolean
  compact?: boolean
}) {
  const settings = useRunRequestDefaults(value, onChange)
  const set = <K extends keyof RunRequest>(k: K, v: RunRequest[K]) => onChange({ ...value, [k]: v })
  const includes: { key: 'includeMsa' | 'includeGmsa' | 'includeDmsa' | 'includeWinLaps'; label: string; hint: string }[] = [
    { key: 'includeMsa', label: 'MSA', hint: 'Managed Service Accounts' },
    { key: 'includeGmsa', label: 'gMSA', hint: 'Group Managed Service Accounts' },
    { key: 'includeDmsa', label: 'dMSA', hint: 'Delegated MSA (Server 2025)' },
    { key: 'includeWinLaps', label: 'Windows LAPS', hint: 'LAPS-Delegationen & Decryptor-GPOs' },
  ]
  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-6">
      <div className={cn('grid gap-4', !compact && 'sm:grid-cols-2')}>
        <Field label="Domain Controller" htmlFor={`${idPrefix}-dc`} required hint={settings ? `Standard: ${settings.defaultPreferredDc || '–'}` : undefined}>
          <div className="relative">
            <Server className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id={`${idPrefix}-dc`} className="pl-9 font-mono" value={value.preferredDc} onChange={(e) => set('preferredDc', e.target.value)} placeholder="dc01.contoso.local" />
          </div>
        </Field>
        <Field label="ADML-Sprache" htmlFor={`${idPrefix}-lang`} hint="Leer = Standard aus den Einstellungen">
          <Input id={`${idPrefix}-lang`} className="font-mono" value={value.admlLanguage ?? ''} onChange={(e) => set('admlLanguage', e.target.value || undefined)} placeholder={settings?.admlLanguage ?? 'en-US'} />
        </Field>
      </div>

      <div className="grid gap-2">
        <p className="text-[13px] font-medium">Bereich</p>
        <div role="radiogroup" aria-label="Bereich" className={cn('grid gap-2', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 2xl:grid-cols-4')}>
          {[...scopes, null].map((s) => {
            const checked = value.scope === s
            const isNone = s === null
            const dis = isNone && !hasInclude(value)
            return (
              <button
                key={s ?? 'none'}
                type="button"
                role="radio"
                aria-checked={checked}
                disabled={dis}
                onClick={() =>
                  onChange(
                    includesAllowed(s)
                      ? { ...value, scope: s }
                      : { ...value, scope: s, includeMsa: false, includeGmsa: false, includeDmsa: false, includeWinLaps: false },
                  )
                }
                className={cn(
                  'flex items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left transition-all outline-none hover:border-input hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45',
                  checked && 'border-primary/60 bg-primary/5 ring-1 ring-primary/30 hover:bg-primary/5',
                )}
              >
                <span className={cn('mt-0.5 grid size-4 shrink-0 place-content-center rounded-full border', checked ? 'border-primary bg-primary' : 'border-input')}>
                  {checked && <span className="size-1.5 rounded-full bg-primary-foreground" />}
                </span>
                <span className="grid gap-0.5">
                  <span className="text-[13px] font-medium">{isNone ? 'Kein Bereich' : scopeLabels[s]}</span>
                  <span className="text-xs text-muted-foreground">{isNone ? 'Nur die gewählten Add-ons' : scopeDescriptions[s]}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid gap-2">
        <p className="text-[13px] font-medium">Add-ons</p>
        {!includesAllowed(value.scope) && (
          <p className="text-xs text-muted-foreground">Add-ons sind nur mit „Vollständig“ oder „Kein Bereich“ möglich.</p>
        )}
        <div className={cn('grid gap-2', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 2xl:grid-cols-4')}>
          {includes.map((i) => (
            <label
              key={i.key}
              htmlFor={`${idPrefix}-${i.key}`}
              className={cn('flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent/40', value[i.key] && 'border-primary/40 bg-primary/5')}
            >
              <span className="grid">
                <span className="text-[13px] font-medium">{i.label}</span>
                <span className="text-xs text-muted-foreground">{i.hint}</span>
              </span>
              <Switch
                id={`${idPrefix}-${i.key}`}
                checked={value[i.key]}
                disabled={!includesAllowed(value.scope)}
                onCheckedChange={(c) => {
                  const next = { ...value, [i.key]: c }
                  if (!hasInclude(next) && next.scope === null) next.scope = 'FullDeployment'
                  onChange(next)
                }}
              />
            </label>
          ))}
        </div>
      </div>
    </fieldset>
  )
}

export function includesFromRequest(r: RunRequest) {
  return [r.includeMsa && 'MSA', r.includeGmsa && 'gMSA', r.includeDmsa && 'dMSA', r.includeWinLaps && 'Windows LAPS'].filter(Boolean) as string[]
}
