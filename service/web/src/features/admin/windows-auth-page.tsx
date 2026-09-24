import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Info, KeyRound, Plus, Save, ShieldAlert, UsersRound, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/api/client'
import type { GroupRef, Role, WindowsAuthSettings } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tooltip } from '@/components/ui/tooltip'
import { Page, PageHeader } from '@/components/shared/page-header'
import { RequireAuth } from '@/features/auth/auth'
import { errorMessage } from '@/lib/query'
import { roleDescriptions, roleLabels, roles } from '@/lib/roles'
import { cn } from '@/lib/utils'

export function Component() {
  return (
    <RequireAuth role="Admin">
      <WindowsAuthPage />
    </RequireAuth>
  )
}

const queryKey = ['settings', 'windows-auth'] as const

/** A saved entry carries the resolved group; a new one only the text the admin typed. */
interface Entry {
  value: string
  ref?: GroupRef
}

interface FormState {
  enabled: boolean
  groups: Record<Role, Entry[]>
}

function toForm(s: WindowsAuthSettings): FormState {
  const groups = {} as Record<Role, Entry[]>
  for (const r of roles) groups[r] = (s.roleGroups?.[r] ?? []).map((g) => ({ value: g.sid || g.name, ref: g }))
  return { enabled: s.enabled, groups }
}

/** What goes into the PUT body: saved entries by SID (stable across renames), new ones as typed. */
function entryValue(e: Entry) {
  return e.ref?.sid || e.ref?.name || e.value
}

function serialize(f: FormState) {
  return JSON.stringify({ enabled: f.enabled, groups: roles.map((r) => f.groups[r].map(entryValue)) })
}

/** The service could not translate the SID into a name (e.g. not running on a domain member). */
function sidOnly(g: GroupRef) {
  return !g.name || g.name.toLowerCase() === g.sid.toLowerCase()
}

const SID_RE = /^S-1-\d+(-\d+)+$/i

function entryFormatError(v: string): string | null {
  if (SID_RE.test(v)) return null
  const i = v.indexOf('\\')
  if (i > 0 && i < v.length - 1 && !v.slice(i + 1).includes('\\')) return null
  return 'Format: DOMÄNE\\Gruppe oder SID (S-1-5-…)'
}

const roleTone: Record<Role, string> = {
  Viewer: 'bg-muted text-muted-foreground',
  Editor: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  Operator: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  Admin: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
}

function WindowsAuthPage() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey, queryFn: api.settings.windowsAuth })
  const [form, setForm] = React.useState<FormState | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Partial<Record<Role, string[]>>>({})
  React.useEffect(() => {
    if (q.data) setForm(toForm(q.data))
  }, [q.data])

  const save = useMutation({
    mutationFn: (f: FormState) => {
      const roleGroups = {} as Record<Role, string[]>
      for (const r of roles) roleGroups[r] = f.groups[r].map(entryValue)
      return api.settings.updateWindowsAuth({ enabled: f.enabled, roleGroups })
    },
    meta: { silent: true },
    onSuccess: (s) => {
      setFieldErrors({})
      qc.setQueryData(queryKey, s)
      qc.invalidateQueries({ queryKey: ['auth', 'options'] })
      toast.success('Windows-Anmeldung gespeichert', { description: s.enabled ? 'Die Gruppenzuordnung gilt ab der nächsten Anmeldung.' : 'Die Windows-Anmeldung ist ausgeschaltet.' })
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 400 && e.errors) {
        const next: Partial<Record<Role, string[]>> = {}
        const rest: string[] = []
        for (const [k, msgs] of Object.entries(e.errors)) {
          const role = roles.find((r) => k.toLowerCase() === `rolegroups.${r.toLowerCase()}` || k.toLowerCase().startsWith(`rolegroups.${r.toLowerCase()}[`))
          if (role) next[role] = [...(next[role] ?? []), ...msgs]
          else rest.push(...msgs)
        }
        setFieldErrors(next)
        const first = roles.find((r) => next[r])
        if (first) requestAnimationFrame(() => document.getElementById(`wa-${first}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
        toast.error('Nicht gespeichert', { description: rest[0] ?? 'Einige Einträge konnten nicht aufgelöst werden. Bitte die markierten Rollen prüfen.' })
        return
      }
      toast.error(e instanceof ApiError ? e.title : 'Fehler', { description: e instanceof ApiError ? e.detail : errorMessage(e) })
    },
  })

  const data = q.data
  const available = data?.available ?? false
  const dirty = !!form && !!data && serialize(form) !== serialize(toForm(data))
  const total = form ? roles.reduce((n, r) => n + form.groups[r].length, 0) : 0

  const setGroups = (role: Role, entries: Entry[]) => {
    if (!form) return
    setForm({ ...form, groups: { ...form.groups, [role]: entries } })
    if (fieldErrors[role]) setFieldErrors({ ...fieldErrors, [role]: undefined })
  }

  return (
    <Page className="max-w-4xl">
      <PageHeader
        icon={<KeyRound />}
        title="Windows-Anmeldung"
        description="Einmalige Anmeldung mit Domänenkonten (Kerberos/NTLM) – die Rolle ergibt sich aus AD-Gruppen."
      />
      {!form || !data ? (
        <div className="grid gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-96" />
        </div>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (dirty) save.mutate(form)
          }}
        >
          {!available && (
            <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-200">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Auf diesem Server nicht verfügbar</p>
                <p className="mt-0.5 opacity-90">
                  Der Dienst kann Windows-Anmeldungen (Negotiate) hier nicht annehmen – etwa weil er nicht auf einem Windows-Server in der Domäne läuft.
                  Die Gruppenzuordnung lässt sich trotzdem vorbereiten.
                </p>
              </div>
            </div>
          )}

          <Card>
            <CardContent className="pt-5">
              <label htmlFor="wa-enabled" className={cn('flex items-center justify-between gap-4', !available && 'cursor-not-allowed')}>
                <span className="flex items-center gap-3">
                  <span className={cn('grid size-10 shrink-0 place-content-center rounded-lg [&_svg]:size-5', form.enabled && available ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground')}>
                    <KeyRound />
                  </span>
                  <span className="grid">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      Windows-Anmeldung aktivieren
                      {data.enabled && available ? <Badge variant="success">Aktiv</Badge> : <Badge variant="muted">Aus</Badge>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Zeigt auf der Anmeldeseite „Mit Windows-Konto anmelden“. Lokale Konten funktionieren weiterhin.
                    </span>
                  </span>
                </span>
                <Tooltip content={available ? undefined : 'Auf diesem Server nicht verfügbar'} disabled={available}>
                  <span>
                    <Switch id="wa-enabled" checked={form.enabled} disabled={!available} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
                  </span>
                </Tooltip>
              </label>
              {form.enabled && total === 0 && (
                <p className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="size-3.5 shrink-0" /> Ohne zugeordnete Gruppen kann sich niemand per Windows anmelden.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2"><UsersRound className="size-4 text-muted-foreground" /> Rollen aus AD-Gruppen</CardTitle>
                <CardDescription>
                  Je Rolle Gruppen als <span className="font-mono text-foreground">DOMÄNE\Gruppe</span> oder SID eintragen. Bei Mitgliedschaft in mehreren Gruppen gilt die höchste Rolle.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-0 divide-y p-0">
              {roles.map((r) => (
                <RoleGroupsRow key={r} role={r} entries={form.groups[r]} onChange={(e) => setGroups(r, e)} errors={fieldErrors[r]} />
              ))}
            </CardContent>
          </Card>

          <div className="flex gap-3 rounded-xl border bg-muted/30 px-4 py-3.5 text-[13px] text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" />
            <div className="grid gap-1.5">
              <p className="font-medium text-foreground">Voraussetzungen für die einmalige Anmeldung (SSO)</p>
              <ul className="grid list-disc gap-1 pl-4">
                <li>
                  Für das Dienstkonto muss der SPN <span className="font-mono text-foreground">HTTP/&lt;FQDN des Servers&gt;</span> registriert sein, z. B.{' '}
                  <span className="rounded bg-card px-1 py-0.5 font-mono text-[12px] text-foreground ring-1 ring-border">setspn -S HTTP/tiermodel01.contoso.com CONTOSO\svc-tiermodel</span>.
                  Ohne passenden SPN fällt die Anmeldung auf NTLM zurück oder schlägt fehl.
                </li>
                <li>
                  Die Adresse der Oberfläche muss im Browser zur Zone „Lokales Intranet“ gehören (z. B. per Gruppenrichtlinie
                  „Liste der Site-zu-Zonen-Zuweisungen“), sonst fragt der Browser nach Anmeldedaten.
                </li>
                <li>Windows-Konten werden bei der ersten Anmeldung automatisch angelegt und können unter „Benutzer“ deaktiviert werden.</li>
                <li>Details stehen in der Betriebsdokumentation des Dienstes (Abschnitt „Windows-Anmeldung“).</li>
              </ul>
            </div>
          </div>

          <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border bg-card/95 px-4 py-3 shadow-lg shadow-black/5 backdrop-blur">
            <span className="mr-auto text-xs text-muted-foreground">
              {dirty ? 'Ungespeicherte Änderungen – Namen werden beim Speichern in SIDs aufgelöst.' : 'Alle Änderungen gespeichert'}
            </span>
            <Button type="button" variant="ghost" disabled={!dirty} onClick={() => { setForm(toForm(data)); setFieldErrors({}) }}>Zurücksetzen</Button>
            <Button type="submit" disabled={!dirty} loading={save.isPending}>{!save.isPending && <Save />} Speichern</Button>
          </div>
        </form>
      )}
    </Page>
  )
}

function RoleGroupsRow({ role, entries, onChange, errors }: { role: Role; entries: Entry[]; onChange: (e: Entry[]) => void; errors?: string[] }) {
  const [text, setText] = React.useState('')
  const [hint, setHint] = React.useState<string | null>(null)
  const id = `wa-${role}`

  const add = (raw: string) => {
    const parts = raw.split(/[\n;,]+/).map((p) => p.trim()).filter(Boolean)
    if (!parts.length) return
    const bad = parts.find((p) => entryFormatError(p))
    if (bad) {
      setHint(`„${bad}“ – ${entryFormatError(bad)}`)
      return
    }
    const known = new Set(entries.flatMap((e) => [e.value.toLowerCase(), e.ref?.name.toLowerCase(), e.ref?.sid.toLowerCase()].filter(Boolean) as string[]))
    const fresh = parts.filter((p, i) => !known.has(p.toLowerCase()) && parts.findIndex((x) => x.toLowerCase() === p.toLowerCase()) === i)
    if (fresh.length) onChange([...entries, ...fresh.map((value) => ({ value }))])
    setText('')
    setHint(fresh.length < parts.length ? 'Bereits vorhandene Einträge wurden übersprungen.' : null)
  }

  return (
    <div className="grid gap-3 px-5 py-4 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-6">
      <div>
        <label htmlFor={id} className="flex items-center gap-2 text-[13px] font-medium">
          <span className={cn('rounded-md px-1.5 py-0.5 text-xs font-semibold', roleTone[role])}>{roleLabels[role]}</span>
          {entries.length > 0 && <span className="text-xs font-normal text-muted-foreground tabular">{entries.length}</span>}
        </label>
        <p className="mt-1 text-xs text-muted-foreground">{roleDescriptions[role]}</p>
      </div>
      <div className="grid min-w-0 gap-2">
        {entries.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={`Gruppen für ${roleLabels[role]}`}>
            {entries.map((e, i) => (
              <li
                key={`${e.value}-${i}`}
                className={cn(
                  'group flex max-w-full items-center gap-2 rounded-lg border bg-card py-1 pr-1 pl-2.5 shadow-xs',
                  !e.ref && 'border-dashed border-primary/40 bg-primary/[0.03]',
                )}
              >
                <span className="grid min-w-0">
                  {e.ref && sidOnly(e.ref) ? (
                    <span className="truncate font-mono text-[12px] font-medium" title={e.ref.sid}>{e.ref.sid}</span>
                  ) : (
                    <span className="truncate text-[13px] font-medium" title={e.ref?.name || e.value}>{e.ref?.name || e.value}</span>
                  )}
                  {e.ref ? (
                    sidOnly(e.ref) ? (
                      <span className="text-[10.5px] text-muted-foreground">SID · Name nicht aufgelöst</span>
                    ) : (
                      <span className="truncate font-mono text-[10.5px] text-muted-foreground" title={e.ref.sid}>{e.ref.sid}</span>
                    )
                  ) : (
                    <span className="text-[10.5px] text-primary">neu – wird beim Speichern aufgelöst</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => onChange(entries.filter((_, j) => j !== i))}
                  className="grid size-6 shrink-0 place-content-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`${e.ref?.name || e.value} entfernen`}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input
            id={id}
            value={text}
            placeholder={entries.length ? 'Weitere Gruppe hinzufügen …' : 'CONTOSO\\Tier0-Admins oder S-1-5-21-…'}
            className="h-8 font-mono text-[13px] placeholder:font-sans"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!errors?.length || undefined}
            onChange={(e) => { setText(e.target.value); setHint(null) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add(text)
              } else if (e.key === 'Backspace' && !text && entries.length) {
                onChange(entries.slice(0, -1))
              }
            }}
            onPaste={(e) => {
              const t = e.clipboardData.getData('text')
              if (/[\n;,]/.test(t)) {
                e.preventDefault()
                add(t)
              }
            }}
          />
          <Button type="button" variant="outline" size="sm" disabled={!text.trim()} onClick={() => add(text)}>
            <Plus /> Hinzufügen
          </Button>
        </div>
        {errors?.length ? (
          <div role="alert" className="grid gap-0.5 text-xs text-destructive">
            {errors.map((m, i) => <p key={i}>{m}</p>)}
          </div>
        ) : hint ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">Keine Gruppe zugeordnet.</p>
        ) : null}
      </div>
    </div>
  )
}
