import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderCog, Lock, Save, Settings2, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { Settings } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Page, PageHeader } from '@/components/shared/page-header'
import { RequireAuth } from '@/features/auth/auth'
import { settingsQuery } from '@/features/runs/run-request-form'

export function Component() {
  return (
    <RequireAuth role="Admin">
      <SettingsPage />
    </RequireAuth>
  )
}

function SettingsPage() {
  const q = useQuery(settingsQuery)
  const qc = useQueryClient()
  const [form, setForm] = React.useState<Settings | null>(null)
  React.useEffect(() => {
    if (q.data) setForm(q.data)
  }, [q.data])

  const save = useMutation({
    mutationFn: (s: Settings) => api.settings.update(s),
    onSuccess: (s) => {
      qc.setQueryData(settingsQuery.queryKey, s)
      toast.success('Einstellungen gespeichert')
    },
  })

  const dirty = form && q.data && JSON.stringify(form) !== JSON.stringify(q.data)
  const retentionInvalid = form ? !Number.isInteger(form.runRetentionDays) || form.runRetentionDays < 1 : false

  return (
    <Page className="max-w-3xl">
      <PageHeader icon={<Settings2 />} title="Einstellungen" description="Standardwerte für Läufe und Aufbewahrung." />
      {!form ? (
        <Skeleton className="h-80" />
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!retentionInvalid) save.mutate(form)
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
                <Input id="st-dc" className="font-mono" value={form.defaultPreferredDc} onChange={(e) => setForm({ ...form, defaultPreferredDc: e.target.value })} />
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="ADML-Sprache" htmlFor="st-lang" hint="z. B. en-US oder de-DE">
                  <Input id="st-lang" className="font-mono" value={form.admlLanguage} onChange={(e) => setForm({ ...form, admlLanguage: e.target.value })} />
                </Field>
                <Field label="Aufbewahrung von Läufen (Tage)" htmlFor="st-ret" error={retentionInvalid ? 'Bitte eine ganze Zahl ≥ 1 angeben.' : undefined}>
                  <Input id="st-ret" type="number" min={1} value={Number.isNaN(form.runRetentionDays) ? '' : form.runRetentionDays} onChange={(e) => setForm({ ...form, runRetentionDays: e.target.valueAsNumber })} aria-invalid={retentionInvalid || undefined} />
                </Field>
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button type="button" variant="ghost" disabled={!dirty} onClick={() => q.data && setForm(q.data)}>Zurücksetzen</Button>
              <Button type="submit" disabled={!dirty || retentionInvalid} loading={save.isPending}>{!save.isPending && <Save />} Speichern</Button>
            </CardFooter>
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
        </form>
      )}
    </Page>
  )
}

function ReadOnlyRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
      <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate font-mono text-[13px]" title={value}>{value || '–'}</p>
      </div>
    </div>
  )
}
