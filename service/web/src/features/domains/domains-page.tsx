import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRightLeft,
  CheckCircle2,
  Globe,
  Info,
  MoreHorizontal,
  Network,
  PlugZap,
  Plus,
  Power,
  Server,
  Star,
  Trash2,
  Pencil,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/api/client'
import { domainsApi, type Domain, type DomainCheck, type DomainInput } from '@/api/domains'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Combobox } from '@/components/ui/combobox'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Input, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Page, PageHeader } from '@/components/shared/page-header'
import { RequireAuth } from '@/features/auth/auth'
import { cn, formatDateShort } from '@/lib/utils'
import { domainsQueryKey, useDomains } from './domain-context'

export function Component() {
  return (
    <RequireAuth role="Admin">
      <DomainsPage />
    </RequireAuth>
  )
}

const KEY_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/
const HOST_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})(?:\.[A-Za-z0-9-]{1,63})*$/
const LANGUAGE_PATTERN = /^[a-zA-Z]{2}-[a-zA-Z]{2}$/
const RESERVED = ['config', 'api', 'all', 'alle', 'default', 'versions']

/** Suggested short name from a DNS name: contoso.com → contoso. */
function keyFromDns(dns: string) {
  return dns.split('.')[0].toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 32)
}

function DomainsPage() {
  const { domains, current } = useDomains()
  const q = useQuery({ queryKey: domainsQueryKey, queryFn: domainsApi.list })
  const [edit, setEdit] = React.useState<Domain | 'new' | null>(null)
  const list = q.data ?? domains

  return (
    <Page>
      <PageHeader
        icon={<Network />}
        title="Domänen"
        description="Active-Directory-Domänen, die dieser Dienst verwaltet – jede mit eigener Soll-Konfiguration, eigenen Läufen und eigener Überwachung."
        actions={<Button onClick={() => setEdit('new')}><Plus /> Domäne anlegen</Button>}
      />
      <div className="mb-4 flex items-start gap-2.5 rounded-lg border bg-muted/40 px-3.5 py-3 text-[13px] text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          Benutzer, Rollen, Benachrichtigungen, API-Tokens, Wartungsfenster und Einstellungen gelten für alle Domänen. Das Dienstkonto braucht in jeder
          Domäne die nötigen Rechte – liegt eine Domäne in einer anderen Gesamtstruktur, ist dafür eine Vertrauensstellung nötig. Ein eigenes Dienstkonto
          je Gesamtstruktur wird nicht unterstützt.
        </p>
      </div>
      {q.isLoading && !list.length ? (
        <Skeleton className="h-48" />
      ) : (
        <Card className="overflow-hidden">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Globe className="size-4 text-muted-foreground" />
              <CardTitle>Verwaltete Domänen</CardTitle>
            </div>
            <CardDescription>
              Die Standard-Domäne gilt für Skripte und Integrationen, die keine Domäne angeben (Header <span className="font-mono text-xs">X-TierModel-Domain</span>).
            </CardDescription>
          </CardHeader>
          {list.length === 0 ? (
            <EmptyState compact icon={<Network />} title="Keine Domänen" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Domäne</TH>
                  <TH className="hidden md:table-cell">Domänencontroller</TH>
                  <TH className="hidden lg:table-cell">ADML</TH>
                  <TH className="w-28">Status</TH>
                  <TH className="w-10"><span className="sr-only">Aktionen</span></TH>
                </TR>
              </THead>
              <TBody>
                {list.map((d) => (
                  <DomainRow key={d.id} domain={d} isCurrent={d.key === current?.key} onEdit={() => setEdit(d)} />
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}
      <DomainSheet value={edit} onClose={() => setEdit(null)} />
    </Page>
  )
}

function DomainRow({ domain: d, isCurrent, onEdit }: { domain: Domain; isCurrent: boolean; onEdit: () => void }) {
  const { switchTo } = useDomains()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const remove = useMutation({
    mutationFn: () => domainsApi.remove(d.id),
    onSuccess: () => {
      toast.success(`Domäne „${d.displayName}“ gelöscht`)
      qc.invalidateQueries({ queryKey: domainsQueryKey })
    },
  })
  const disable = useMutation({
    mutationFn: () => domainsApi.update(d.id, { ...toInput(d), enabled: !d.enabled }),
    onSuccess: (u) => {
      toast.success(u.enabled ? `„${u.displayName}“ aktiviert` : `„${u.displayName}“ deaktiviert`)
      qc.invalidateQueries({ queryKey: domainsQueryKey })
    },
  })

  const askDelete = async () => {
    const check = await domainsApi.deletion(d.id)
    if (check.canDelete) {
      if (await confirm({ title: `Domäne „${d.displayName}“ löschen?`, description: 'Die (unveränderte) Beispielkonfiguration der Domäne wird entfernt.', confirmText: 'Löschen', destructive: true }))
        remove.mutate()
      return
    }
    if (!d.enabled || d.isDefault) {
      await confirm({ title: 'Löschen nicht möglich', description: check.reason, confirmText: 'Verstanden' })
      return
    }
    if (await confirm({ title: 'Löschen nicht möglich', description: `${check.reason} Stattdessen deaktivieren? Läufe und Protokoll bleiben lesbar.`, confirmText: 'Deaktivieren' }))
      disable.mutate()
  }

  return (
    <TR className={cn(!d.enabled && 'text-muted-foreground')}>
      <TD>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn('grid size-8 shrink-0 place-content-center rounded-lg [&_svg]:size-4', d.enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
            <Network />
          </span>
          <div className="grid min-w-0">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="truncate font-medium text-foreground">{d.displayName}</span>
              {isCurrent && <Badge variant="info">Aktuell</Badge>}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {d.dnsName || 'DNS-Name nicht hinterlegt'} · <span className="font-mono">{d.key}</span>
            </span>
            <span className="truncate text-xs text-muted-foreground md:hidden">{d.preferredDc || 'kein Standard-DC'}</span>
          </div>
        </div>
      </TD>
      <TD className="hidden text-[13px] md:table-cell">
        {d.preferredDc ? <span className="font-mono text-xs">{d.preferredDc}</span> : <span className="text-muted-foreground">–</span>}
      </TD>
      <TD className="hidden text-[13px] lg:table-cell">{d.admlLanguage}</TD>
      <TD>
        <div className="flex flex-wrap gap-1">
          {d.isDefault && <Badge variant="default"><Star /> Standard</Badge>}
          {d.enabled ? !d.isDefault && <Badge variant="success">Aktiv</Badge> : <Badge variant="muted">Deaktiviert</Badge>}
        </div>
      </TD>
      <TD>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={`Aktionen für ${d.displayName}`}><MoreHorizontal /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}><Pencil /> Bearbeiten</DropdownMenuItem>
            {d.enabled && !isCurrent && (
              <DropdownMenuItem onSelect={() => void switchTo(d.key)}><ArrowRightLeft /> Zu dieser Domäne wechseln</DropdownMenuItem>
            )}
            {!d.isDefault && (
              <DropdownMenuItem onSelect={() => disable.mutate()}><Power /> {d.enabled ? 'Deaktivieren' : 'Aktivieren'}</DropdownMenuItem>
            )}
            {!d.isDefault && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => void askDelete()}><Trash2 /> Löschen …</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TD>
    </TR>
  )
}

function toInput(d: Domain): DomainInput {
  return { key: d.key, displayName: d.displayName, dnsName: d.dnsName, preferredDc: d.preferredDc, admlLanguage: d.admlLanguage, enabled: d.enabled, isDefault: d.isDefault, notes: d.notes }
}

const emptyInput = (): DomainInput => ({ key: '', displayName: '', dnsName: '', preferredDc: '', admlLanguage: 'en-US', enabled: true, isDefault: false, notes: '' })

function DomainSheet({ value, onClose }: { value: Domain | 'new' | null; onClose: () => void }) {
  const open = value !== null
  const isNew = value === 'new'
  const existing = value && value !== 'new' ? value : null
  const [form, setForm] = React.useState<DomainInput>(emptyInput)
  const [keyTouched, setKeyTouched] = React.useState(false)
  const [check, setCheck] = React.useState<DomainCheck | null>(null)
  const [serverErrors, setServerErrors] = React.useState<Record<string, string[]>>({})
  const qc = useQueryClient()
  const { switchTo } = useDomains()

  React.useEffect(() => {
    if (!value) return
    setForm(value === 'new' ? emptyInput() : { ...toInput(value), notes: value.notes ?? '' })
    setKeyTouched(value !== 'new')
    setCheck(null)
    setServerErrors({})
  }, [value])

  const set = (patch: Partial<DomainInput>) => {
    setForm((f) => {
      const next = { ...f, ...patch }
      // New domain: the short name follows the DNS name until it is edited.
      if (!keyTouched && patch.dnsName !== undefined) next.key = keyFromDns(patch.dnsName)
      if (!keyTouched && patch.displayName !== undefined && !next.dnsName) next.key = keyFromDns(patch.displayName.replace(/\s+/g, '-'))
      return next
    })
    setServerErrors({})
  }

  // DC suggestions: live DCs of a saved domain, plus the ones found by "Verbindung prüfen".
  const dcs = useQuery({
    queryKey: ['domains', 'dcs', existing?.key ?? ''],
    queryFn: () => api.lookup.domainControllers(existing!.key),
    enabled: open && !!existing,
    staleTime: 5 * 60_000,
    meta: { silent: true },
  })
  const templates = useQuery({ queryKey: ['lookup', 'template-files'], queryFn: api.lookup.templateFiles, enabled: open, staleTime: 5 * 60_000, meta: { silent: true } })

  const dcOptions = React.useMemo(() => {
    const map = new Map<string, { value: string; hint?: string }>()
    for (const dc of check?.domain?.domainControllers ?? []) map.set(dc.name.toLowerCase(), { value: dc.name, hint: dc.site ? `Standort ${dc.site}` : undefined })
    for (const dc of dcs.data?.items ?? []) map.set(dc.name.toLowerCase(), { value: dc.name, hint: dc.site ? `Standort ${dc.site}` : undefined })
    for (const dc of dcs.data?.recent ?? []) if (!map.has(dc.toLowerCase())) map.set(dc.toLowerCase(), { value: dc, hint: 'zuletzt verwendet' })
    return [...map.values()]
  }, [check, dcs.data])

  const languageOptions = React.useMemo(() => {
    const langs = new Set(['en-US', 'de-DE', ...(templates.data?.languages ?? [])])
    return [...langs].sort().map((l) => ({ value: l }))
  }, [templates.data])

  const keyError = !form.key ? 'Kurzname angeben.' : !KEY_PATTERN.test(form.key) ? 'Nur Kleinbuchstaben, Ziffern und Bindestriche.' : RESERVED.includes(form.key) ? `„${form.key}“ ist reserviert.` : null
  const dnsError = form.dnsName && (!HOST_PATTERN.test(form.dnsName) || !form.dnsName.includes('.')) ? 'Vollständigen DNS-Namen angeben, z. B. fabrikam.com.' : null
  const dcError = form.preferredDc && !HOST_PATTERN.test(form.preferredDc) ? 'Ungültiger Hostname.' : null
  const error = !form.displayName.trim() ? 'Anzeigename ist erforderlich.' : keyError ?? dnsError ?? dcError ?? (!LANGUAGE_PATTERN.test(form.admlLanguage) ? 'ADML-Sprache im Format xx-XX.' : null)
  const fieldError = (k: string) => serverErrors[k]?.[0]

  const save = useMutation({
    mutationFn: () => {
      const body: DomainInput = { ...form, displayName: form.displayName.trim(), dnsName: form.dnsName.trim(), preferredDc: form.preferredDc.trim(), notes: form.notes?.trim() || null }
      return isNew ? domainsApi.create(body) : domainsApi.update(existing!.id, body)
    },
    meta: { silent: true },
    onSuccess: async (d) => {
      await qc.invalidateQueries({ queryKey: domainsQueryKey })
      if (isNew) {
        toast.success(`Domäne „${d.displayName}“ angelegt`, {
          description: 'Sie startet mit der Beispielkonfiguration – der Einrichtungsassistent passt sie an.',
          action: { label: 'Wechseln', onClick: () => void switchTo(d.key) },
          duration: 8000,
        })
      } else toast.success('Domäne gespeichert')
      onClose()
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setServerErrors(e.errors)
      else toast.error('Speichern fehlgeschlagen', { description: e instanceof ApiError ? e.userMessage : String(e) })
    },
  })

  const probe = useMutation({
    mutationFn: () => domainsApi.check(form.dnsName.trim(), form.preferredDc.trim()),
    onSuccess: (r) => setCheck(r),
  })

  const adopt = () => {
    const info = check?.domain
    if (!info) return
    set({
      dnsName: form.dnsName || info.dnsName,
      displayName: form.displayName || info.netBiosName || info.dnsName,
      preferredDc: form.preferredDc || info.domainControllers[0]?.name || '',
    })
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-xl">
        <form className="flex h-full flex-col" onSubmit={(e) => { e.preventDefault(); if (!error) save.mutate() }}>
          <SheetHeader>
            <SheetTitle>{isNew ? 'Neue Domäne' : `Domäne „${existing?.displayName}“ bearbeiten`}</SheetTitle>
            <SheetDescription>
              {isNew
                ? 'Die Domäne erhält eine eigene Soll-Konfiguration (zunächst die mitgelieferte Beispielkonfiguration), eigene Läufe und eigene Überwachung.'
                : 'Änderungen am Domänencontroller gelten für neue Läufe; laufende und geplante Läufe behalten ihren DC.'}
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="grid content-start gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Anzeigename" htmlFor="dm-name" required error={fieldError('displayName')}>
                <Input id="dm-name" value={form.displayName} onChange={(e) => set({ displayName: e.target.value })} placeholder="z. B. Fabrikam Produktion" maxLength={100} autoFocus={isNew} />
              </Field>
              <Field
                label="Kurzname"
                htmlFor="dm-key"
                required
                error={fieldError('key') ?? (form.key && keyError ? keyError : undefined)}
                hint={!isNew && existing?.key !== form.key ? 'Skripte mit -Domain und die Git-Ablage verwenden den Kurznamen.' : 'Für Skripte (-Domain) und die Git-Ablage.'}
              >
                <Input
                  id="dm-key"
                  value={form.key}
                  onChange={(e) => { setKeyTouched(true); set({ key: e.target.value.toLowerCase() }) }}
                  placeholder="fabrikam"
                  className="font-mono"
                  maxLength={32}
                  aria-invalid={!!(form.key && keyError) || !!fieldError('key')}
                />
              </Field>
            </div>
            <Field label="DNS-Name der Domäne" htmlFor="dm-dns" error={fieldError('dnsName') ?? dnsError ?? undefined} hint="Wird aus dem Domänencontroller abgeleitet, wenn leer.">
              <Input id="dm-dns" value={form.dnsName} onChange={(e) => set({ dnsName: e.target.value.trim() })} placeholder="fabrikam.com" className="font-mono" />
            </Field>
            <Field
              label="Bevorzugter Domänencontroller"
              htmlFor="dm-dc"
              error={fieldError('preferredDc') ?? dcError ?? undefined}
              hint="Vorschlag für Läufe dieser Domäne und Server der Ist-Ansicht. Die Skripte ermitteln die Domäne über diesen DC."
            >
              <Combobox
                id="dm-dc"
                value={form.preferredDc}
                onChange={(v) => set({ preferredDc: v })}
                options={dcOptions}
                placeholder="DC wählen oder eingeben …"
                searchPlaceholder="DC suchen oder vollständigen Namen eingeben …"
                emptyText={isNew ? 'Mit „Verbindung prüfen“ werden die DCs der Domäne gesucht.' : 'Keine DCs gefunden'}
                loading={dcs.isFetching}
                mono
                validateCustom={(v) => (HOST_PATTERN.test(v) ? null : 'Ungültiger Hostname')}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ADML-Sprache" htmlFor="dm-lang" required error={fieldError('admlLanguage')} hint="Standard für Läufe dieser Domäne.">
                <Combobox
                  id="dm-lang"
                  value={form.admlLanguage}
                  onChange={(v) => set({ admlLanguage: v })}
                  options={languageOptions}
                  searchPlaceholder="Sprache suchen, z. B. de-DE …"
                  validateCustom={(v) => (LANGUAGE_PATTERN.test(v) ? null : 'Format xx-XX')}
                />
              </Field>
              <div className="grid content-start gap-3 pt-0.5">
                <label htmlFor="dm-enabled" className="flex items-center gap-3 text-[13px]">
                  <Switch id="dm-enabled" checked={form.enabled} disabled={existing?.isDefault} onCheckedChange={(v) => set({ enabled: v, isDefault: v ? form.isDefault : false })} />
                  <span>{form.enabled ? 'Aktiv' : 'Deaktiviert (nur lesbar)'}</span>
                </label>
                <label htmlFor="dm-default" className="flex items-center gap-3 text-[13px]">
                  <Switch id="dm-default" checked={form.isDefault} disabled={existing?.isDefault || !form.enabled} onCheckedChange={(v) => set({ isDefault: v })} />
                  <span>Standard-Domäne</span>
                </label>
                {fieldError('enabled') && <p className="text-xs text-destructive">{fieldError('enabled')}</p>}
                {fieldError('isDefault') && <p className="text-xs text-destructive">{fieldError('isDefault')}</p>}
              </div>
            </div>
            <Field label="Notizen" htmlFor="dm-notes" error={fieldError('notes')}>
              <Textarea id="dm-notes" value={form.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} placeholder="z. B. Ansprechpartner, Vertrauensstellung, Besonderheiten" maxLength={1000} rows={3} />
            </Field>

            <div className="grid gap-3 rounded-lg border p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  <PlugZap className="size-4 text-muted-foreground" /> Verbindung
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => probe.mutate()}
                  loading={probe.isPending}
                  disabled={!form.dnsName.trim() && !form.preferredDc.trim()}
                >
                  <PlugZap /> Verbindung prüfen
                </Button>
              </div>
              {!check ? (
                <p className="text-xs text-muted-foreground">Liest Domäne, Gesamtstruktur und Domänencontroller über den angegebenen DC bzw. DNS-Namen – mit dem Dienstkonto, nur lesend.</p>
              ) : (
                <div className={cn('grid gap-2 rounded-md px-3 py-2.5 text-[13px]', check.ok ? 'bg-emerald-500/10' : 'bg-rose-500/10')}>
                  <p className={cn('flex items-start gap-2', check.ok ? 'text-emerald-800 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300')}>
                    {check.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
                    <span className="min-w-0 break-words">{check.message}</span>
                  </p>
                  {check.domain && (
                    <>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                        <dt className="text-muted-foreground">NetBIOS</dt><dd className="min-w-0 truncate font-mono">{check.domain.netBiosName}</dd>
                        <dt className="text-muted-foreground">Gesamtstruktur</dt><dd className="min-w-0 truncate font-mono">{check.domain.forestName}</dd>
                        <dt className="text-muted-foreground">Funktionsebene</dt><dd className="min-w-0 truncate">{check.domain.domainFunctionalLevel}</dd>
                        <dt className="text-muted-foreground">DCs</dt>
                        <dd className="flex min-w-0 flex-wrap gap-1">
                          {check.domain.domainControllers.map((dc) => (
                            <span key={dc.name} className="inline-flex items-center gap-1 rounded bg-background/70 px-1.5 py-0.5 font-mono text-[11px]">
                              <Server className="size-3" /> {dc.name}
                            </span>
                          ))}
                        </dd>
                      </dl>
                      {(!form.dnsName || !form.preferredDc || !form.displayName) && (
                        <Button type="button" size="xs" variant="outline" className="justify-self-start" onClick={adopt}>Angaben übernehmen</Button>
                      )}
                    </>
                  )}
                  <p className="text-[11px] text-muted-foreground">Quelle: {check.source}</p>
                </div>
              )}
            </div>
            {existing && (
              <p className="text-xs text-muted-foreground">Angelegt am {formatDateShort(existing.createdAt)} · Nummer {existing.id}</p>
            )}
          </SheetBody>
          <SheetFooter>
            {error && <span className="mr-auto text-xs text-muted-foreground">{error}</span>}
            <Button type="button" variant="outline" onClick={onClose}>Abbrechen</Button>
            <Button type="submit" disabled={!!error} loading={save.isPending}>{isNew ? 'Anlegen' : 'Speichern'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
