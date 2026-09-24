import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import { api } from '@/api/client'
import type { RunRequest, Scope } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Field } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { scopeLabels, scopes } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { languageError, useDomainControllerOptions, useLanguageOptions } from '@/features/config/lookups'
import { t } from '@/i18n'

export const settingsQuery = { queryKey: ['settings'], queryFn: api.settings.get, staleTime: 5 * 60_000 }

const scopeDescriptions: Record<Scope, string> = {
  FullDeployment: t('runs.runRequestForm.ousGroupsUsersAclsGpos'),
  OuOnly: t('runs.runRequestForm.onlyTheOuStructure'),
  GroupOnly: t('runs.runRequestForm.onlySecurityGroups'),
  UserOnly: t('runs.runRequestForm.onlyServiceAccounts'),
  GposOnly: t('runs.runRequestForm.onlyGroupPolicies'),
  OuAclsOnly: t('runs.runRequestForm.onlyOuPermissions'),
  AdmxOnly: t('runs.runRequestForm.onlyAdmxAdmlTemplates'),
  AuthSilosOnly: t('runs.runRequestForm.authenticationPoliciesSilosAndDevice'),
}

export function emptyRunRequest(): RunRequest {
  return { preferredDc: '', scope: 'FullDeployment', includeMsa: false, includeGmsa: false, includeDmsa: false, includeWinLaps: false }
}

export function hasInclude(r: RunRequest) {
  return r.includeMsa || r.includeGmsa || r.includeDmsa || r.includeWinLaps
}

export function runRequestError(r: RunRequest): string | null {
  if (!r.preferredDc.trim()) return t('runs.runRequestForm.pleaseEnterADomainController')
  if (r.admlLanguage && languageError(r.admlLanguage)) return t('runs.runRequestForm.theAdmlLanguageHasAn')
  if (r.scope === null && !hasInclude(r)) return t('runs.runRequestForm.withoutAScopeAtLeast')
  if (!includesAllowed(r.scope) && hasInclude(r)) return t('runs.runRequestForm.addOnsAreOnlyPossible')
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
  const dcOptions = useDomainControllerOptions()
  const languageOptions = useLanguageOptions()
  const set = <K extends keyof RunRequest>(k: K, v: RunRequest[K]) => onChange({ ...value, [k]: v })
  const includes: { key: 'includeMsa' | 'includeGmsa' | 'includeDmsa' | 'includeWinLaps'; label: string; hint: string }[] = [
    { key: 'includeMsa', label: 'MSA', hint: t('runs.runRequestForm.managedServiceAccounts') },
    { key: 'includeGmsa', label: 'gMSA', hint: t('runs.runRequestForm.groupManagedServiceAccounts') },
    { key: 'includeDmsa', label: 'dMSA', hint: t('runs.runRequestForm.delegatedMsaServer2025') },
    { key: 'includeWinLaps', label: 'Windows LAPS', hint: t('runs.runRequestForm.lapsDelegationsDecryptorGpos') },
  ]
  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-6">
      <div className={cn('grid gap-4', !compact && 'sm:grid-cols-2')}>
        <Field label={t('runs.runRequestForm.domainController')} htmlFor={`${idPrefix}-dc`} required hint={settings ? t('runs.runRequestForm.defaultValue', { value: settings.defaultPreferredDc || '–' }) : undefined}>
          <Combobox
            id={`${idPrefix}-dc`}
            mono
            value={value.preferredDc}
            onChange={(v) => set('preferredDc', v)}
            options={dcOptions}
            placeholder="dc01.contoso.local"
            searchPlaceholder={t('runs.runRequestForm.searchDcOrEnterFqdn')}
            emptyText={t('runs.runRequestForm.noDomainControllersFoundEnter')}
            disabled={disabled}
          />
        </Field>
        <Field label={t('runs.runRequestForm.admlLanguage')} htmlFor={`${idPrefix}-lang`} error={languageError(value.admlLanguage ?? '') ?? undefined} hint={t('runs.runRequestForm.emptyDefaultFromTheSettings', { value: settings?.admlLanguage || 'en-US' })}>
          <div className="flex gap-1.5">
            <Combobox
              id={`${idPrefix}-lang`}
              mono
              value={value.admlLanguage ?? ''}
              onChange={(v) => set('admlLanguage', v || undefined)}
              options={languageOptions}
              placeholder={t('runs.runRequestForm.defaultValue2', { value: settings?.admlLanguage || 'en-US' })}
              searchPlaceholder={t('runs.runRequestForm.searchLanguageEGDe')}
              validateCustom={languageError}
              disabled={disabled}
            />
            {value.admlLanguage && !disabled && (
              <Button type="button" variant="ghost" size="icon" aria-label={t('runs.runRequestForm.resetToDefault')} onClick={() => set('admlLanguage', undefined)}>
                <RotateCcw />
              </Button>
            )}
          </div>
        </Field>
      </div>

      <div className="grid gap-2">
        <p className="text-[13px] font-medium">{t('runs.runRequestForm.scope')}</p>
        <div role="radiogroup" aria-label={t('runs.runRequestForm.scope')} className={cn('grid gap-2', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 2xl:grid-cols-4')}>
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
                  <span className="text-[13px] font-medium">{isNone ? t('runs.runRequestForm.noScope') : scopeLabels[s]}</span>
                  <span className="text-xs text-muted-foreground">{isNone ? t('runs.runRequestForm.onlyTheSelectedAddOns') : scopeDescriptions[s]}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid gap-2">
        <p className="text-[13px] font-medium">{t('runs.runRequestForm.addOns')}</p>
        {!includesAllowed(value.scope) && (
          <p className="text-xs text-muted-foreground">{t('runs.runRequestForm.addOnsAreOnlyPossible')}</p>
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
