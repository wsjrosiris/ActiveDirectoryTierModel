import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConical, FolderCog, Globe, Lock, Save, Settings2, ShieldUser, Terminal, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { Settings, SettingsUpdate } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Page, PageHeader } from '@/components/shared/page-header'
import { RequireAuth } from '@/features/auth/auth'
import { useDomains } from '@/features/domains/domain-context'
import { settingsQuery } from '@/features/runs/run-request-form'
import { languageError, useDomainControllerOptions, useLanguageOptions } from '@/features/config/lookups'
import { GitSettingsCard } from './git-settings-card'
import { currentLocale, t } from '@/i18n'

export function Component() {
  return (
    <RequireAuth role="Admin">
      <SettingsPage />
    </RequireAuth>
  )
}

function SettingsPage() {
  const q = useQuery(settingsQuery)
  const dcOptions = useDomainControllerOptions()
  const languageOptions = useLanguageOptions()
  const qc = useQueryClient()
  const domains = useDomains()
  const [form, setForm] = React.useState<Settings | null>(null)
  React.useEffect(() => {
    if (q.data) setForm(q.data)
  }, [q.data])

  const save = useMutation({
    // PUT sends every field except the two read-only paths.
    mutationFn: ({ frameworkPath: _f, pwshPath: _p, ...rest }: Settings) => api.settings.update(rest satisfies SettingsUpdate),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['domains'] })
      qc.setQueryData(settingsQuery.queryKey, s)
      toast.success(t('admin.settings.settingsSaved'))
    },
  })

  const dirty = form && q.data && JSON.stringify(form) !== JSON.stringify(q.data)
  const retentionInvalid = form ? !Number.isInteger(form.runRetentionDays) || (form.runRetentionDays < 0 || form.runRetentionDays > 3650) : false
  const timeoutInvalid = form ? !Number.isInteger(form.approvalTimeoutHours) || form.approvalTimeoutHours < 1 || form.approvalTimeoutHours > 720 : false
  const planAgeInvalid = form ? !Number.isInteger(form.planMaxAgeHours) || form.planMaxAgeHours < 1 || form.planMaxAgeHours > 720 : false
  const staleInvalid = form ? !Number.isInteger(form.staleDays) || form.staleDays < 1 || form.staleDays > 3650 : false
  const pwAgeInvalid = form ? !Number.isInteger(form.passwordMaxAgeDays) || form.passwordMaxAgeDays < 1 || form.passwordMaxAgeDays > 3650 : false
  const urlError = form ? publicUrlError(form.publicBaseUrl) : null
  const langError = form ? (form.admlLanguage.trim() ? languageError(form.admlLanguage.trim()) : t('admin.settings.pleaseSelectALanguage')) : null
  const invalid = retentionInvalid || timeoutInvalid || planAgeInvalid || staleInvalid || pwAgeInvalid || !!urlError || !!langError

  return (
    <Page className="max-w-3xl">
      <PageHeader icon={<Settings2 />} title={t('admin.settings.settings')} description={t('admin.settings.defaultsForRunsRetentionAnd')} />
      {!form ? (
        <Skeleton className="h-80" />
      ) : (
        <form
          className="grid grid-cols-[minmax(0,1fr)] gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!invalid) save.mutate(form)
          }}
        >
          <Card>
            <CardHeader>
              <div>
                <CardTitle>{t('admin.settings.runs')}</CardTitle>
                <CardDescription>
                  {t('admin.settings.preFilledInTheDeploy')}
                  {domains.multiple && domains.current && (
                    <> {t('admin.settings.appliesToTheDomain')} <span className="font-medium text-foreground">{domains.current.displayName}</span> {t('admin.settings.theOtherSettingsApplyTo')}</>
                  )}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5">
              <Field label={t('admin.settings.defaultDomainController')} htmlFor="st-dc" hint={t('admin.settings.fqdnOfThePreferredDc')}>
                <Combobox
                  id="st-dc"
                  mono
                  value={form.defaultPreferredDc}
                  onChange={(v) => setForm({ ...form, defaultPreferredDc: v })}
                  options={dcOptions}
                  placeholder="dc01.contoso.local"
                  searchPlaceholder={t('admin.settings.searchDcOrEnterFqdn')}
                  emptyText={t('admin.settings.noDomainControllersFoundEnter')}
                />
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label={t('admin.settings.admlLanguage')} htmlFor="st-lang" error={langError ?? undefined} hint={t('admin.settings.languagesWithExistingAdmlFiles')}>
                  <Combobox
                    id="st-lang"
                    mono
                    value={form.admlLanguage}
                    onChange={(v) => setForm({ ...form, admlLanguage: v })}
                    options={languageOptions}
                    placeholder={t('admin.settings.selectLanguage')}
                    searchPlaceholder={t('admin.settings.searchLanguageEGDe')}
                    validateCustom={languageError}
                    invalid={!!langError}
                  />
                </Field>
                <Field label={t('admin.settings.runRetentionDays')} htmlFor="st-ret" error={retentionInvalid ? t('admin.settings.pleaseEnterAWholeNumber') : undefined}>
                  <Input id="st-ret" type="number" min={0} max={3650} value={Number.isNaN(form.runRetentionDays) ? '' : form.runRetentionDays} onChange={(e) => setForm({ ...form, runRetentionDays: e.target.valueAsNumber })} aria-invalid={retentionInvalid || undefined} />
                </Field>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2"><UsersRound className="size-4 text-muted-foreground" /> {t('admin.settings.approvalsTwoPersonRule')}</CardTitle>
                <CardDescription>{t('admin.settings.deploymentsInApplyModeMust')}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5">
              <label htmlFor="st-approval" className="flex items-center justify-between gap-4 rounded-lg border px-3.5 py-3">
                <span className="grid">
                  <span className="text-[13px] font-medium">{t('admin.settings.approvalRequiredForApply')}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('admin.settings.aSecondOperatorReviewsThe')}
                  </span>
                </span>
                <Switch id="st-approval" checked={form.requireApproval} onCheckedChange={(v) => setForm({ ...form, requireApproval: v })} />
              </label>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label={t('admin.settings.approvalDeadlineHours')}
                  htmlFor="st-timeout"
                  error={timeoutInvalid ? t('admin.settings.pleaseEnterAWholeNumber2') : undefined}
                  hint={form.approvalTimeoutHours >= 24 && Number.isInteger(form.approvalTimeoutHours) ? t('admin.settings.approvalExpiresDays', { days: formatDays(form.approvalTimeoutHours) }) : t('admin.settings.approvalExpires')}
                >
                  <Input
                    id="st-timeout"
                    type="number"
                    min={1}
                    max={720}
                    value={Number.isNaN(form.approvalTimeoutHours) ? '' : form.approvalTimeoutHours}
                    onChange={(e) => setForm({ ...form, approvalTimeoutHours: e.target.valueAsNumber })}
                    aria-invalid={timeoutInvalid || undefined}
                  />
                </Field>
              </div>
              <Field
                label={<span className="inline-flex items-center gap-1.5"><Globe className="size-3.5 text-muted-foreground" /> {t('admin.settings.publicUrl')}</span>}
                htmlFor="st-url"
                error={urlError ?? undefined}
                hint={t('admin.settings.forLinksInNotificationsE')}
              >
                <Input
                  id="st-url"
                  className="font-mono"
                  placeholder="https://tiermodel01.contoso.com:8443"
                  value={form.publicBaseUrl}
                  onChange={(e) => setForm({ ...form, publicBaseUrl: e.target.value })}
                  aria-invalid={!!urlError || undefined}
                />
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2"><FlaskConical className="size-4 text-muted-foreground" /> {t('admin.settings.planBeforeApply')}</CardTitle>
                <CardDescription>{t('admin.settings.onlyWhatWasVisibleIn')}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5">
              <label htmlFor="st-require-plan" className="flex items-center justify-between gap-4 rounded-lg border px-3.5 py-3">
                <span className="grid">
                  <span className="text-[13px] font-medium">{t('admin.settings.applyOnlyAfterAReviewed')}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('admin.settings.applyIsOnlyPossibleFrom')}
                  </span>
                </span>
                <Switch id="st-require-plan" checked={form.requirePlanBeforeApply} onCheckedChange={(v) => setForm({ ...form, requirePlanBeforeApply: v })} />
              </label>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label={t('admin.settings.planValidityHours')}
                  htmlFor="st-plan-age"
                  error={planAgeInvalid ? t('admin.settings.pleaseEnterAWholeNumber2') : undefined}
                  hint={form.planMaxAgeHours >= 24 && Number.isInteger(form.planMaxAgeHours) ? t('admin.settings.planExpiresDays', { days: formatDays(form.planMaxAgeHours) }) : t('admin.settings.planExpires')}
                >
                  <Input
                    id="st-plan-age"
                    type="number"
                    min={1}
                    max={720}
                    value={Number.isNaN(form.planMaxAgeHours) ? '' : form.planMaxAgeHours}
                    onChange={(e) => setForm({ ...form, planMaxAgeHours: e.target.valueAsNumber })}
                    aria-invalid={planAgeInvalid || undefined}
                  />
                </Field>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2"><ShieldUser className="size-4 text-muted-foreground" /> {t('admin.settings.privilegedAccessMonitoring')}</CardTitle>
                <CardDescription>{t('admin.settings.thresholdsOfTheHygieneChecks')}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <Field
                label={t('admin.settings.inactiveAfterDaysWithoutSign')}
                htmlFor="st-stale"
                error={staleInvalid ? t('admin.settings.pleaseEnterAWholeNumber3') : undefined}
                hint={t('admin.settings.enabledAccountsThatHaveNot')}
              >
                <Input id="st-stale" type="number" min={1} max={3650} value={Number.isNaN(form.staleDays) ? '' : form.staleDays} onChange={(e) => setForm({ ...form, staleDays: e.target.valueAsNumber })} aria-invalid={staleInvalid || undefined} />
              </Field>
              <Field
                label={t('admin.settings.maximumPasswordAgeDays')}
                htmlFor="st-pwage"
                error={pwAgeInvalid ? t('admin.settings.pleaseEnterAWholeNumber3') : undefined}
                hint={t('admin.settings.olderPasswordsOfPrivilegedUsers')}
              >
                <Input id="st-pwage" type="number" min={1} max={3650} value={Number.isNaN(form.passwordMaxAgeDays) ? '' : form.passwordMaxAgeDays} onChange={(e) => setForm({ ...form, passwordMaxAgeDays: e.target.valueAsNumber })} aria-invalid={pwAgeInvalid || undefined} />
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">{t('admin.settings.environment')} <Lock className="size-3.5 text-muted-foreground" /></CardTitle>
                <CardDescription>{t('admin.settings.setInTheServiceConfiguration')}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              <ReadOnlyRow icon={<FolderCog />} label={t('admin.settings.frameworkPath')} value={form.frameworkPath} />
              <ReadOnlyRow icon={<Terminal />} label={t('admin.settings.powershellPath')} value={form.pwshPath} />
            </CardContent>
          </Card>
          <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border bg-card/95 px-4 py-3 shadow-lg shadow-black/5 backdrop-blur">
            <span className="mr-auto text-xs text-muted-foreground">{dirty ? t('common.unsavedChanges') : t('common.allChangesSaved')}</span>
            <Button type="button" variant="ghost" disabled={!dirty} onClick={() => q.data && setForm(q.data)}>{t('common.reset')}</Button>
            <Button type="submit" disabled={!dirty || invalid} loading={save.isPending}>{!save.isPending && <Save />} {t('common.save')}</Button>
          </div>
        </form>
      )}
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)]">
        <GitSettingsCard />
      </div>
    </Page>
  )
}

function publicUrlError(v: string): string | null {
  const tt = v.trim()
  if (!tt) return null
  try {
    const u = new URL(tt)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return t('admin.settings.theAddressMustStartWith')
    return null
  } catch {
    return t('admin.settings.pleaseEnterACompleteAddress')
  }
}

function formatDays(hours: number) {
  const d = hours / 24
  return Number.isInteger(d) ? t('admin.settings.days', { count: d }) : t('admin.settings.daysFraction', { value: d.toLocaleString(currentLocale(), { maximumFractionDigits: 1 }) })
}

function ReadOnlyRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
      <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate font-mono text-[13px]" title={value}>{value || '–'}</p>
      </div>
    </div>
  )
}
