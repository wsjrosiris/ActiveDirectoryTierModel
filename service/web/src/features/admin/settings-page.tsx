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
import { settingsQuery } from '@/features/runs/run-request-form'
import { languageError, useDomainControllerOptions, useLanguageOptions } from '@/features/config/lookups'

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
  const [form, setForm] = React.useState<Settings | null>(null)
  React.useEffect(() => {
    if (q.data) setForm(q.data)
  }, [q.data])

  const save = useMutation({
    // PUT sends every field except the two read-only paths.
    mutationFn: ({ frameworkPath: _f, pwshPath: _p, ...rest }: Settings) => api.settings.update(rest satisfies SettingsUpdate),
    onSuccess: (s) => {
      qc.setQueryData(settingsQuery.queryKey, s)
      toast.success('Einstellungen gespeichert')
    },
  })

  const dirty = form && q.data && JSON.stringify(form) !== JSON.stringify(q.data)
  const retentionInvalid = form ? !Number.isInteger(form.runRetentionDays) || (form.runRetentionDays < 0 || form.runRetentionDays > 3650) : false
  const timeoutInvalid = form ? !Number.isInteger(form.approvalTimeoutHours) || form.approvalTimeoutHours < 1 || form.approvalTimeoutHours > 720 : false
  const planAgeInvalid = form ? !Number.isInteger(form.planMaxAgeHours) || form.planMaxAgeHours < 1 || form.planMaxAgeHours > 720 : false
  const staleInvalid = form ? !Number.isInteger(form.staleDays) || form.staleDays < 1 || form.staleDays > 3650 : false
  const pwAgeInvalid = form ? !Number.isInteger(form.passwordMaxAgeDays) || form.passwordMaxAgeDays < 1 || form.passwordMaxAgeDays > 3650 : false
  const urlError = form ? publicUrlError(form.publicBaseUrl) : null
  const langError = form ? (form.admlLanguage.trim() ? languageError(form.admlLanguage.trim()) : 'Bitte eine Sprache wählen.') : null
  const invalid = retentionInvalid || timeoutInvalid || planAgeInvalid || staleInvalid || pwAgeInvalid || !!urlError || !!langError

  return (
    <Page className="max-w-3xl">
      <PageHeader icon={<Settings2 />} title="Einstellungen" description="Standardwerte für Läufe, Aufbewahrung und Freigaben." />
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
                <CardTitle>Läufe</CardTitle>
                <CardDescription>Werden in Deploy- und Audit-Formularen vorausgefüllt.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5">
              <Field label="Standard-Domain-Controller" htmlFor="st-dc" hint="FQDN des bevorzugten DCs, z. B. dc01.contoso.local">
                <Combobox
                  id="st-dc"
                  mono
                  value={form.defaultPreferredDc}
                  onChange={(v) => setForm({ ...form, defaultPreferredDc: v })}
                  options={dcOptions}
                  placeholder="dc01.contoso.local"
                  searchPlaceholder="DC suchen oder FQDN eingeben …"
                  emptyText="Keine Domain Controller gefunden – FQDN eingeben"
                />
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="ADML-Sprache" htmlFor="st-lang" error={langError ?? undefined} hint="Sprachen mit vorhandenen ADML-Dateien stehen oben">
                  <Combobox
                    id="st-lang"
                    mono
                    value={form.admlLanguage}
                    onChange={(v) => setForm({ ...form, admlLanguage: v })}
                    options={languageOptions}
                    placeholder="Sprache wählen"
                    searchPlaceholder="Sprache suchen, z. B. de-DE …"
                    validateCustom={languageError}
                    invalid={!!langError}
                  />
                </Field>
                <Field label="Aufbewahrung von Läufen (Tage)" htmlFor="st-ret" error={retentionInvalid ? 'Bitte eine ganze Zahl von 0 bis 3650 angeben (0 = unbegrenzt).' : undefined}>
                  <Input id="st-ret" type="number" min={0} max={3650} value={Number.isNaN(form.runRetentionDays) ? '' : form.runRetentionDays} onChange={(e) => setForm({ ...form, runRetentionDays: e.target.valueAsNumber })} aria-invalid={retentionInvalid || undefined} />
                </Field>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2"><UsersRound className="size-4 text-muted-foreground" /> Freigaben (Vier-Augen-Prinzip)</CardTitle>
                <CardDescription>Deploys im Modus „Anwenden“ müssen von einer zweiten Person freigegeben werden, bevor sie das AD verändern.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5">
              <label htmlFor="st-approval" className="flex items-center justify-between gap-4 rounded-lg border px-3.5 py-3">
                <span className="grid">
                  <span className="text-[13px] font-medium">Freigabe für Anwenden erforderlich</span>
                  <span className="text-xs text-muted-foreground">
                    Ein zweiter Operator prüft den Antrag; die Konfigurationsversionen werden beim Einreichen festgeschrieben.
                  </span>
                </span>
                <Switch id="st-approval" checked={form.requireApproval} onCheckedChange={(v) => setForm({ ...form, requireApproval: v })} />
              </label>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="Frist für Freigaben (Stunden)"
                  htmlFor="st-timeout"
                  error={timeoutInvalid ? 'Bitte eine ganze Zahl von 1 bis 720 angeben.' : undefined}
                  hint={`Danach verfällt ein Antrag automatisch${form.approvalTimeoutHours >= 24 && Number.isInteger(form.approvalTimeoutHours) ? ` (≈ ${formatDays(form.approvalTimeoutHours)})` : ''}.`}
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
                label={<span className="inline-flex items-center gap-1.5"><Globe className="size-3.5 text-muted-foreground" /> Öffentliche Adresse</span>}
                htmlFor="st-url"
                error={urlError ?? undefined}
                hint="Für Links in Benachrichtigungen, z. B. https://tiermodel01.contoso.com:8443 – leer lassen, wenn keine Links gewünscht sind."
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
                <CardTitle className="flex items-center gap-2"><FlaskConical className="size-4 text-muted-foreground" /> Planung vor dem Anwenden</CardTitle>
                <CardDescription>Angewendet wird nur, was vorher in einem Planungslauf sichtbar war – mit denselben Parametern und demselben Konfigurationsstand.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5">
              <label htmlFor="st-require-plan" className="flex items-center justify-between gap-4 rounded-lg border px-3.5 py-3">
                <span className="grid">
                  <span className="text-[13px] font-medium">Anwenden nur nach geprüfter Planung</span>
                  <span className="text-xs text-muted-foreground">
                    „Anwenden“ ist nur aus einem erfolgreichen Planungslauf mit gleichem Bereich, Domain Controller und gleichen Konfigurationsversionen möglich.
                  </span>
                </span>
                <Switch id="st-require-plan" checked={form.requirePlanBeforeApply} onCheckedChange={(v) => setForm({ ...form, requirePlanBeforeApply: v })} />
              </label>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="Gültigkeit einer Planung (Stunden)"
                  htmlFor="st-plan-age"
                  error={planAgeInvalid ? 'Bitte eine ganze Zahl von 1 bis 720 angeben.' : undefined}
                  hint={`Ältere Planungen können nicht mehr angewendet werden${form.planMaxAgeHours >= 24 && Number.isInteger(form.planMaxAgeHours) ? ` (≈ ${formatDays(form.planMaxAgeHours)})` : ''}.`}
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
                <CardTitle className="flex items-center gap-2"><ShieldUser className="size-4 text-muted-foreground" /> Überwachung privilegierter Zugriffe</CardTitle>
                <CardDescription>Schwellwerte der Hygiene-Prüfungen für Admin-Konten in Tier 0 und Tier 1. Sie gelten ab der nächsten Überwachung.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Inaktiv ab (Tage ohne Anmeldung)"
                htmlFor="st-stale"
                error={staleInvalid ? 'Bitte eine ganze Zahl von 1 bis 3650 angeben.' : undefined}
                hint="Aktivierte Konten, die sich länger nicht angemeldet haben, werden gemeldet. Standard: 90."
              >
                <Input id="st-stale" type="number" min={1} max={3650} value={Number.isNaN(form.staleDays) ? '' : form.staleDays} onChange={(e) => setForm({ ...form, staleDays: e.target.valueAsNumber })} aria-invalid={staleInvalid || undefined} />
              </Field>
              <Field
                label="Maximales Passwortalter (Tage)"
                htmlFor="st-pwage"
                error={pwAgeInvalid ? 'Bitte eine ganze Zahl von 1 bis 3650 angeben.' : undefined}
                hint="Ältere Passwörter privilegierter Benutzer werden gemeldet. Standard: 365."
              >
                <Input id="st-pwage" type="number" min={1} max={3650} value={Number.isNaN(form.passwordMaxAgeDays) ? '' : form.passwordMaxAgeDays} onChange={(e) => setForm({ ...form, passwordMaxAgeDays: e.target.valueAsNumber })} aria-invalid={pwAgeInvalid || undefined} />
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">Umgebung <Lock className="size-3.5 text-muted-foreground" /></CardTitle>
                <CardDescription>Wird in der Dienstkonfiguration (appsettings.json) festgelegt und ist hier schreibgeschützt.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              <ReadOnlyRow icon={<FolderCog />} label="Framework-Pfad" value={form.frameworkPath} />
              <ReadOnlyRow icon={<Terminal />} label="PowerShell-Pfad" value={form.pwshPath} />
            </CardContent>
          </Card>
          <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border bg-card/95 px-4 py-3 shadow-lg shadow-black/5 backdrop-blur">
            <span className="mr-auto text-xs text-muted-foreground">{dirty ? 'Ungespeicherte Änderungen' : 'Alle Änderungen gespeichert'}</span>
            <Button type="button" variant="ghost" disabled={!dirty} onClick={() => q.data && setForm(q.data)}>Zurücksetzen</Button>
            <Button type="submit" disabled={!dirty || invalid} loading={save.isPending}>{!save.isPending && <Save />} Speichern</Button>
          </div>
        </form>
      )}
    </Page>
  )
}

function publicUrlError(v: string): string | null {
  const t = v.trim()
  if (!t) return null
  try {
    const u = new URL(t)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Die Adresse muss mit https:// oder http:// beginnen.'
    return null
  } catch {
    return 'Bitte eine vollständige Adresse angeben, z. B. https://tiermodel01.contoso.com:8443'
  }
}

function formatDays(hours: number) {
  const d = hours / 24
  return Number.isInteger(d) ? `${d} ${d === 1 ? 'Tag' : 'Tage'}` : `${d.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Tage`
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
