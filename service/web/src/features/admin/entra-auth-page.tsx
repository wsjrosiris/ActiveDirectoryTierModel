import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Cloud, Copy, Info, Plus, Save, SearchCheck, UsersRound, X, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/api/client'
import type { EntraAuthSettings, EntraEntryKind, EntraMetadataCheck, EntraRoleEntry, Role } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tooltip } from '@/components/ui/tooltip'
import { Page, PageHeader } from '@/components/shared/page-header'
import { RequireAuth } from '@/features/auth/auth'
import { settingsQuery } from '@/features/runs/run-request-form'
import { errorMessage } from '@/lib/query'
import { roleDescriptions, roleLabels, roles } from '@/lib/roles'
import { cn } from '@/lib/utils'

export function Component() {
  return (
    <RequireAuth role="Admin">
      <EntraAuthPage />
    </RequireAuth>
  )
}

const queryKey = ['settings', 'entra-auth'] as const

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const APP_ROLE_RE = /^[A-Za-z0-9._:-]{1,120}$/

interface FormState {
  enabled: boolean
  tenantId: string
  clientId: string
  clientSecret: string
  mappings: Record<Role, EntraRoleEntry[]>
}

function toForm(s: EntraAuthSettings): FormState {
  const mappings = {} as Record<Role, EntraRoleEntry[]>
  for (const r of roles) mappings[r] = (s.roleMappings?.[r] ?? []).map((e) => ({ ...e }))
  return { enabled: s.enabled, tenantId: s.tenantId, clientId: s.clientId, clientSecret: '', mappings }
}

function serialize(f: FormState) {
  return JSON.stringify([f.enabled, f.tenantId.trim(), f.clientId.trim(), f.clientSecret, roles.map((r) => f.mappings[r].map((e) => [e.kind, e.value, e.displayName ?? '']))])
}

const roleTone: Record<Role, string> = {
  Viewer: 'bg-muted text-muted-foreground',
  Editor: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  Operator: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  Admin: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
}

function EntraAuthPage() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey, queryFn: api.settings.entraAuth })
  const settings = useQuery(settingsQuery)
  const [form, setForm] = React.useState<FormState | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [check, setCheck] = React.useState<EntraMetadataCheck | null>(null)
  React.useEffect(() => {
    if (q.data) setForm(toForm(q.data))
  }, [q.data])

  const save = useMutation({
    mutationFn: (f: FormState) =>
      api.settings.updateEntraAuth({
        enabled: f.enabled,
        tenantId: f.tenantId.trim(),
        clientId: f.clientId.trim(),
        clientSecret: f.clientSecret || null,
        roleMappings: f.mappings,
      }),
    meta: { silent: true },
    onSuccess: (s) => {
      setErrors({})
      qc.setQueryData(queryKey, s)
      qc.invalidateQueries({ queryKey: ['auth', 'options'] })
      toast.success('Entra-ID-Anmeldung gespeichert', {
        description: s.enabled ? 'Die Anmeldeseite zeigt jetzt „Mit Microsoft anmelden“.' : 'Die Anmeldung mit Microsoft ist ausgeschaltet.',
      })
    },
    onError: (e) => {
      const next: Record<string, string> = {}
      if (e instanceof ApiError && e.errors) for (const [k, v] of Object.entries(e.errors)) next[k.toLowerCase()] = v.join(' ')
      setErrors(next)
      toast.error('Nicht gespeichert', { description: Object.values(next)[0] ?? errorMessage(e) })
    },
  })

  const verify = useMutation({
    mutationFn: (tenantId: string) => api.settings.checkEntraAuth(tenantId),
    onSuccess: setCheck,
    onError: () => setCheck(null),
  })

  const data = q.data
  const redirectUri = React.useMemo(() => {
    const base = (settings.data?.publicBaseUrl || window.location.origin).replace(/\/+$/, '')
    return base + (data?.callbackPath ?? '/signin-oidc')
  }, [settings.data, data])

  if (!form || !data)
    return (
      <Page className="max-w-4xl">
        <PageHeader icon={<Cloud />} title="Entra-ID-Anmeldung" description="Anmeldung mit Microsoft-Geschäftskonten (OpenID Connect)." />
        <div className="grid gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-72" />
          <Skeleton className="h-96" />
        </div>
      </Page>
    )

  const dirty = serialize(form) !== serialize(toForm(data))
  const total = roles.reduce((n, r) => n + form.mappings[r].length, 0)
  const tenantError = form.tenantId.trim() && !GUID_RE.test(form.tenantId.trim()) ? 'Die Mandanten-ID ist eine GUID.' : errors['tenantid']
  const clientError = form.clientId.trim() && !GUID_RE.test(form.clientId.trim()) ? 'Die Anwendungs-ID ist eine GUID.' : errors['clientid']
  const secretMissing = form.enabled && !data.hasClientSecret && !form.clientSecret
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm({ ...form, [k]: v })

  return (
    <Page className="max-w-4xl">
      <PageHeader
        icon={<Cloud />}
        title="Entra-ID-Anmeldung"
        description="Anmeldung mit Microsoft-Geschäftskonten (OpenID Connect mit PKCE) – die Rolle ergibt sich aus Entra-Gruppen oder App-Rollen."
      />
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (dirty && !tenantError && !clientError) save.mutate(form)
        }}
      >
        <Card>
          <CardContent className="pt-5">
            <label htmlFor="ea-enabled" className="flex items-center justify-between gap-4">
              <span className="flex min-w-0 items-center gap-3">
                <span className={cn('grid size-10 shrink-0 place-content-center rounded-lg [&_svg]:size-5', form.enabled ? 'bg-blue-500/10 text-blue-600 dark:text-blue-300' : 'bg-muted text-muted-foreground')}>
                  <Cloud />
                </span>
                <span className="grid min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    Anmeldung mit Microsoft aktivieren
                    {data.enabled ? <Badge variant="success">Aktiv</Badge> : <Badge variant="muted">Aus</Badge>}
                  </span>
                  <span className="text-xs text-muted-foreground">Zeigt auf der Anmeldeseite „Mit Microsoft anmelden“. Lokale Konten funktionieren weiterhin.</span>
                </span>
              </span>
              <Switch id="ea-enabled" checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} />
            </label>
            {form.enabled && total === 0 && (
              <p className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                <AlertTriangle className="size-3.5 shrink-0" /> Ohne Zuordnung von Gruppen oder App-Rollen kann sich niemand mit Microsoft anmelden.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>App-Registrierung</CardTitle>
              <CardDescription>Werte aus dem Microsoft Entra Admin Center (App-Registrierungen → Übersicht).</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Mandanten-ID (Verzeichnis-ID)" htmlFor="ea-tenant" required={form.enabled} error={tenantError}>
                <Input
                  id="ea-tenant"
                  value={form.tenantId}
                  onChange={(e) => { set('tenantId', e.target.value); setCheck(null) }}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  className="font-mono text-[12.5px]"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!!tenantError || undefined}
                />
              </Field>
              <Field label="Anwendungs-ID (Client-ID)" htmlFor="ea-client" required={form.enabled} error={clientError}>
                <Input
                  id="ea-client"
                  value={form.clientId}
                  onChange={(e) => set('clientId', e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  className="font-mono text-[12.5px]"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!!clientError || undefined}
                />
              </Field>
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="ea-secret" className="text-[13px] font-medium">
                  Geheimer Clientschlüssel{form.enabled && !data.hasClientSecret && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
                </label>
                {data.hasClientSecret && !form.clientSecret && <Badge variant="success"><CheckCircle2 /> gespeichert</Badge>}
              </div>
              <Input
                id="ea-secret"
                type="password"
                autoComplete="new-password"
                value={form.clientSecret}
                onChange={(e) => set('clientSecret', e.target.value)}
                placeholder={data.hasClientSecret ? '•••••••• (unverändert)' : 'Wert des geheimen Schlüssels'}
                aria-invalid={secretMissing || !!errors['clientsecret'] || undefined}
              />
              <p className={cn('text-xs', errors['clientsecret'] ? 'text-destructive' : 'text-muted-foreground')}>
                {errors['clientsecret'] ?? 'Den „Wert“ (nicht die ID) des Schlüssels eintragen. Er wird verschlüsselt gespeichert und nie angezeigt; Ablaufdatum in Entra ID beachten.'}
              </p>
            </div>
            <div className="grid gap-1.5">
              <p className="text-[13px] font-medium">Umleitungs-URI (Plattform „Web“)</p>
              <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/40 py-1 pr-1 pl-3">
                <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]" title={redirectUri} data-testid="redirect-uri">{redirectUri}</code>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(redirectUri)
                      toast.success('Umleitungs-URI kopiert')
                    } catch {
                      toast.error('Kopieren nicht möglich', { description: 'Bitte die Adresse markieren und manuell kopieren.' })
                    }
                  }}
                >
                  <Copy /> Kopieren
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                In der App-Registrierung unter „Authentifizierung“ eintragen. Die Adresse folgt der öffentlichen Adresse aus den Einstellungen; in Produktion nur https.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                loading={verify.isPending}
                disabled={!GUID_RE.test(form.tenantId.trim())}
                onClick={() => verify.mutate(form.tenantId.trim())}
              >
                {!verify.isPending && <SearchCheck />} Konfiguration prüfen
              </Button>
              <span className="text-xs text-muted-foreground">Ruft das OpenID-Metadatendokument des Mandanten ab.</span>
            </div>
            {check && (
              <div
                role="status"
                className={cn(
                  'flex gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]',
                  check.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200' : 'border-destructive/25 bg-destructive/10 text-destructive',
                )}
              >
                {check.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
                <div className="grid min-w-0 gap-0.5">
                  <p className="font-medium">{check.message}</p>
                  {check.issuer && <p className="truncate text-xs opacity-90" title={check.issuer}>Aussteller: <span className="font-mono">{check.issuer}</span></p>}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2"><UsersRound className="size-4 text-muted-foreground" /> Rollen aus Gruppen oder App-Rollen</CardTitle>
              <CardDescription>
                Je Rolle Entra-Gruppen (Objekt-ID) oder App-Rollen (Wert) eintragen. Bei mehreren Treffern gilt die höchste Rolle; ohne Treffer wird die Anmeldung abgelehnt.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-0 divide-y p-0">
            {roles.map((r) => (
              <RoleRow
                key={r}
                role={r}
                entries={form.mappings[r]}
                error={errors[`rolemappings.${r.toLowerCase()}`]}
                onChange={(entries) => {
                  setForm({ ...form, mappings: { ...form.mappings, [r]: entries } })
                  setErrors((e) => ({ ...e, [`rolemappings.${r.toLowerCase()}`]: '' }))
                }}
              />
            ))}
          </CardContent>
        </Card>

        <div className="flex gap-3 rounded-xl border bg-muted/30 px-4 py-3.5 text-[13px] text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" />
          <div className="grid min-w-0 gap-1.5">
            <p className="font-medium text-foreground">Einrichtung in Microsoft Entra ID</p>
            <ol className="grid list-decimal gap-1 pl-4">
              <li>App-Registrierung anlegen (nur Konten dieses Verzeichnisses), Plattform „Web“ mit der Umleitungs-URI oben.</li>
              <li>Unter „Zertifikate &amp; Geheimnisse“ einen geheimen Clientschlüssel erstellen und hier eintragen.</li>
              <li>
                Gruppen: unter „Tokenkonfiguration“ den Anspruch <span className="font-mono text-foreground">groups</span> (Sicherheitsgruppen, als Gruppen-ID) hinzufügen.
                Bei mehr als 200 Gruppen je Benutzer lieber App-Rollen verwenden.
              </li>
              <li>App-Rollen: unter „App-Rollen“ anlegen und in „Unternehmensanwendungen“ Benutzern oder Gruppen zuweisen.</li>
            </ol>
          </div>
        </div>

        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border bg-card/95 px-4 py-3 shadow-lg shadow-black/5 backdrop-blur">
          <span className="mr-auto text-xs text-muted-foreground">
            {secretMissing ? 'Zum Aktivieren den geheimen Clientschlüssel eintragen.' : dirty ? 'Ungespeicherte Änderungen' : 'Alle Änderungen gespeichert'}
          </span>
          <Button type="button" variant="ghost" disabled={!dirty} onClick={() => { setForm(toForm(data)); setErrors({}) }}>Zurücksetzen</Button>
          <Button type="submit" disabled={!dirty || !!tenantError || !!clientError} loading={save.isPending}>{!save.isPending && <Save />} Speichern</Button>
        </div>
      </form>
    </Page>
  )
}

function RoleRow({ role, entries, onChange, error }: { role: Role; entries: EntraRoleEntry[]; onChange: (e: EntraRoleEntry[]) => void; error?: string }) {
  const [kind, setKind] = React.useState<EntraEntryKind>('Group')
  const [value, setValue] = React.useState('')
  const [name, setName] = React.useState('')
  const [hint, setHint] = React.useState<string | null>(null)
  const id = `ea-${role}`

  const valueError = (v: string) =>
    kind === 'Group'
      ? GUID_RE.test(v) ? null : 'Objekt-ID der Gruppe als GUID eingeben (z. B. 3f2a…-…).'
      : APP_ROLE_RE.test(v) ? null : 'Wert der App-Rolle ohne Leerzeichen (z. B. TierModel.Admin).'

  const add = () => {
    const v = value.trim()
    if (!v) return
    const bad = valueError(v)
    if (bad) {
      setHint(bad)
      return
    }
    if (entries.some((e) => e.kind === kind && e.value.toLowerCase() === v.toLowerCase())) {
      setHint('Dieser Eintrag ist bereits zugeordnet.')
      return
    }
    onChange([...entries, { kind, value: kind === 'Group' ? v.toLowerCase() : v, displayName: name.trim() || null }])
    setValue('')
    setName('')
    setHint(null)
  }

  const typed = value.trim()
  const typedError = typed ? valueError(typed) : null

  return (
    <div className="grid gap-3 px-5 py-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-6">
      <div>
        <label htmlFor={id} className="flex items-center gap-2 text-[13px] font-medium">
          <span className={cn('rounded-md px-1.5 py-0.5 text-xs font-semibold', roleTone[role])}>{roleLabels[role]}</span>
          {entries.length > 0 && <span className="text-xs font-normal text-muted-foreground tabular">{entries.length}</span>}
        </label>
        <p className="mt-1 text-xs text-muted-foreground">{roleDescriptions[role]}</p>
      </div>
      <div className="grid min-w-0 gap-2">
        {entries.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={`Zuordnungen für ${roleLabels[role]}`}>
            {entries.map((e, i) => (
              <li key={`${e.kind}-${e.value}`} className="flex max-w-full items-center gap-2 rounded-lg border bg-card py-1 pr-1 pl-2.5 shadow-xs">
                <span className="grid min-w-0">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Badge variant={e.kind === 'Group' ? 'info' : 'default'} className="shrink-0 px-1.5 py-0 text-[10px]">{e.kind === 'Group' ? 'Gruppe' : 'App-Rolle'}</Badge>
                    <span className="truncate text-[13px] font-medium" title={e.displayName || e.value}>{e.displayName || e.value}</span>
                  </span>
                  {e.displayName && <span className="truncate font-mono text-[10.5px] text-muted-foreground" title={e.value}>{e.value}</span>}
                </span>
                <Tooltip content="Entfernen">
                  <button
                    type="button"
                    onClick={() => onChange(entries.filter((_, j) => j !== i))}
                    className="grid size-6 shrink-0 place-content-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`${e.displayName || e.value} entfernen`}
                  >
                    <X className="size-3.5" />
                  </button>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-2 rounded-lg border border-dashed p-2.5">
          <Segmented<EntraEntryKind>
            aria-label={`Art der Zuordnung für ${roleLabels[role]}`}
            value={kind}
            onValueChange={(k) => { setKind(k); setHint(null) }}
            options={[
              { value: 'Group', label: 'Gruppe (Objekt-ID)' },
              { value: 'AppRole', label: 'App-Rolle' },
            ]}
          />
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]">
            <Input
              id={id}
              value={value}
              onChange={(e) => { setValue(e.target.value); setHint(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
              placeholder={kind === 'Group' ? '00000000-0000-0000-0000-000000000000' : 'TierModel.Admin'}
              className="font-mono text-[12.5px]"
              autoComplete="off"
              spellCheck={false}
              aria-label={kind === 'Group' ? 'Objekt-ID der Gruppe' : 'Wert der App-Rolle'}
              aria-invalid={!!typedError || undefined}
            />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
              placeholder="Anzeigename (optional)"
              aria-label="Anzeigename (optional)"
              autoComplete="off"
            />
            <Button type="button" variant="outline" onClick={add} disabled={!typed || !!typedError}>
              <Plus /> Hinzufügen
            </Button>
          </div>
        </div>
        {error ? (
          <p role="alert" className="text-xs text-destructive">{error}</p>
        ) : hint || typedError ? (
          <p className="text-xs text-muted-foreground">{hint ?? typedError}</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">Keine Gruppe oder App-Rolle zugeordnet.</p>
        ) : null}
      </div>
    </div>
  )
}
