import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Hourglass,
  Mail,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Rocket,
  Save,
  ScanSearch,
  Send,
  Server,
  Trash2,
  Undo2,
  Webhook,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/api/client'
import type { ChannelEvents, ChannelInput, ChannelType, NotificationChannel, SmtpSecurity, SmtpSettings, SmtpUpdate } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tooltip } from '@/components/ui/tooltip'
import { Page, PageHeader } from '@/components/shared/page-header'
import { RequireAuth } from '@/features/auth/auth'
import { errorMessage } from '@/lib/query'
import { cn, formatDateTime, formatRelative } from '@/lib/utils'

export function Component() {
  return (
    <RequireAuth role="Admin">
      <NotificationsPage />
    </RequireAuth>
  )
}

const channelsKey = ['notifications', 'channels'] as const
const smtpKey = ['notifications', 'smtp'] as const

const typeMeta: Record<ChannelType, { label: string; icon: React.ReactNode; tone: string; targetLabel: string }> = {
  Email: { label: 'E-Mail', icon: <Mail />, tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-300', targetLabel: 'Empfänger' },
  Teams: { label: 'Microsoft Teams', icon: <MessagesSquare />, tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-300', targetLabel: 'Webhook-URL' },
  Webhook: { label: 'Webhook', icon: <Webhook />, tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300', targetLabel: 'URL' },
}

const eventMeta: { key: keyof ChannelEvents; label: string; description: string; icon: React.ReactNode }[] = [
  { key: 'drift', label: 'Drift', description: 'Ein Audit hat Abweichungen vom Soll-Zustand gefunden.', icon: <ScanSearch /> },
  { key: 'failure', label: 'Fehler', description: 'Ein Deploy oder Audit ist fehlgeschlagen.', icon: <XCircle /> },
  { key: 'apply', label: 'Angewendet', description: 'Ein Deploy im Modus „Anwenden“ wurde erfolgreich abgeschlossen.', icon: <Rocket /> },
  { key: 'approval', label: 'Freigabe', description: 'Ein Deploy wartet auf die Freigabe durch eine zweite Person.', icon: <Hourglass /> },
]

function NotificationsPage() {
  const q = useQuery({ queryKey: channelsKey, queryFn: api.notifications.channels })
  const smtp = useQuery({ queryKey: smtpKey, queryFn: api.notifications.smtp })
  const [editing, setEditing] = React.useState<NotificationChannel | 'new' | null>(null)
  const smtpMissing = !!smtp.data && !smtp.data.host.trim()

  return (
    <Page wide className="max-w-[1400px]">
      <PageHeader
        icon={<Bell />}
        title="Benachrichtigungen"
        description="E-Mail, Microsoft Teams oder Webhooks bei Drift, Fehlern, Anwendungen und Freigaben."
        actions={<Button onClick={() => setEditing('new')}><Plus /> Kanal hinzufügen</Button>}
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-label="Kanäle" className="grid gap-3">
          {q.isLoading ? (
            Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-36" />)
          ) : !q.data?.length ? (
            <Card>
              <EmptyState
                icon={<Bell />}
                title="Noch keine Kanäle"
                description="Legen Sie einen Kanal an, um bei folgenden Ereignissen informiert zu werden:"
                action={
                  <div className="grid gap-4">
                    <ul className="mx-auto grid max-w-xl gap-2 text-left sm:grid-cols-2">
                      {eventMeta.map((e) => (
                        <li key={e.key} className="flex gap-2.5 rounded-lg border bg-muted/30 px-3 py-2.5">
                          <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{e.icon}</span>
                          <span className="grid">
                            <span className="text-[13px] font-medium">{e.label}</span>
                            <span className="text-xs text-muted-foreground">{e.description}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div><Button onClick={() => setEditing('new')}><Plus /> Ersten Kanal anlegen</Button></div>
                  </div>
                }
              />
            </Card>
          ) : (
            q.data.map((c) => <ChannelCard key={c.id} channel={c} onEdit={() => setEditing(c)} smtpMissing={smtpMissing} />)
          )}
        </section>
        <SmtpCard />
      </div>
      <ChannelSheet value={editing} onClose={() => setEditing(null)} />
    </Page>
  )
}

function ChannelCard({ channel: c, onEdit, smtpMissing }: { channel: NotificationChannel; onEdit: () => void; smtpMissing: boolean }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const meta = typeMeta[c.type]
  const invalidate = () => qc.invalidateQueries({ queryKey: channelsKey })

  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      api.notifications.updateChannel(c.id, { name: c.name, type: c.type, enabled, target: c.type === 'Email' ? c.target : null, events: c.events }),
    onSuccess: (u) => {
      toast.success(u.enabled ? `„${u.name}“ aktiviert` : `„${u.name}“ deaktiviert`)
      invalidate()
    },
  })
  const test = useMutation({
    mutationFn: () => api.notifications.testChannel(c.id),
    meta: { silent: true },
    onSuccess: () => toast.success('Testnachricht zugestellt', { description: `Kanal „${c.name}“ · ${meta.label}` }),
    onError: (e) =>
      toast.error('Testnachricht fehlgeschlagen', {
        description: e instanceof ApiError ? (e.detail || e.title) : errorMessage(e),
        duration: 10_000,
      }),
    onSettled: invalidate,
  })
  const remove = useMutation({
    mutationFn: () => api.notifications.removeChannel(c.id),
    onSuccess: () => {
      toast.success(`Kanal „${c.name}“ gelöscht`)
      invalidate()
    },
  })
  const active = eventMeta.filter((e) => c.events[e.key])

  return (
    <Card className={cn('overflow-hidden transition-opacity', !c.enabled && 'bg-muted/20')}>
      <div className="flex items-start gap-4 p-4 sm:p-5">
        <span className={cn('grid size-10 shrink-0 place-content-center rounded-lg [&_svg]:size-5', c.enabled ? meta.tone : 'bg-muted text-muted-foreground')}>{meta.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={cn('truncate text-sm font-semibold', !c.enabled && 'text-muted-foreground')}>{c.name}</h3>
            <Badge variant="outline">{meta.label}</Badge>
            {!c.enabled && <Badge variant="muted">Deaktiviert</Badge>}
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={c.target}>{c.target || '–'}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {active.length ? (
              active.map((e) => (
                <Tooltip key={e.key} content={e.description}>
                  <span className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs font-medium [&_svg]:size-3 [&_svg]:text-muted-foreground">
                    {e.icon}
                    {e.label}
                  </span>
                </Tooltip>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">Keine Ereignisse ausgewählt</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip content={c.enabled ? 'Deaktivieren' : 'Aktivieren'}>
            <span className="mr-1 inline-flex">
              <Switch checked={c.enabled} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate(v)} aria-label={`Kanal ${c.name} aktiv`} />
            </span>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={`Aktionen für ${c.name}`}><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}><Pencil /> Bearbeiten</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => test.mutate()}><Send /> Testnachricht senden</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                onSelect={async () => {
                  if (await confirm({ title: `Kanal „${c.name}“ löschen?`, description: 'Über diesen Kanal werden keine Benachrichtigungen mehr versendet.', confirmText: 'Löschen', destructive: true }))
                    remove.mutate()
                }}
              >
                <Trash2 /> Löschen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
        {c.lastError ? (
          <Tooltip content={c.lastError}>
            <span className="flex min-w-0 items-center gap-1.5 text-rose-600 dark:text-rose-400">
              <XCircle className="size-3.5 shrink-0" />
              <span className="truncate">Letzter Fehler: {c.lastError}</span>
            </span>
          </Tooltip>
        ) : c.lastSentAt ? (
          <span className="flex items-center gap-1.5" title={formatDateTime(c.lastSentAt)}>
            <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" /> Zuletzt gesendet {formatRelative(c.lastSentAt)}
          </span>
        ) : (
          <span>Noch nichts gesendet</span>
        )}
        {c.lastError && c.lastSentAt && <span title={formatDateTime(c.lastSentAt)}>Zuletzt erfolgreich {formatRelative(c.lastSentAt)}</span>}
        {c.type === 'Email' && smtpMissing && (
          <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-3.5" /> SMTP-Server nicht konfiguriert
          </span>
        )}
        <Button variant="outline" size="xs" className="ml-auto" loading={test.isPending} onClick={() => test.mutate()}>
          {!test.isPending && <Send />} Testnachricht senden
        </Button>
      </div>
    </Card>
  )
}

const emptyEvents: ChannelEvents = { drift: true, failure: true, apply: false, approval: false }

function targetError(type: ChannelType, target: string, required: boolean): string | null {
  const t = target.trim()
  if (!t) return required ? (type === 'Email' ? 'Mindestens einen Empfänger angeben.' : 'URL erforderlich.') : null
  if (type === 'Email') {
    const bad = t.split(/[,;]/).map((x) => x.trim()).filter(Boolean).find((x) => !/^[^\s@]+@[^\s@]+$/.test(x))
    return bad ? `„${bad}“ ist keine gültige E-Mail-Adresse.` : null
  }
  try {
    const u = new URL(t)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Die URL muss mit https:// beginnen.'
    return null
  } catch {
    return 'Bitte eine vollständige URL angeben (https://…).'
  }
}

function ChannelSheet({ value, onClose }: { value: NotificationChannel | 'new' | null; onClose: () => void }) {
  const isNew = value === 'new'
  const channel = value && value !== 'new' ? value : null
  const qc = useQueryClient()
  const [name, setName] = React.useState('')
  const [type, setType] = React.useState<ChannelType>('Email')
  const [enabled, setEnabled] = React.useState(true)
  const [target, setTarget] = React.useState('')
  const [events, setEvents] = React.useState<ChannelEvents>(emptyEvents)
  const [touched, setTouched] = React.useState(false)

  React.useEffect(() => {
    if (!value) return
    setName(channel?.name ?? '')
    setType(channel?.type ?? 'Email')
    setEnabled(channel?.enabled ?? true)
    // Teams/Webhook URLs are never returned in full: the field stays empty unless a new URL is typed.
    setTarget(channel?.type === 'Email' ? channel.target : '')
    setEvents(channel?.events ?? emptyEvents)
    setTouched(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const secretTarget = type !== 'Email'
  const typeChanged = !!channel && channel.type !== type
  // A kept URL is only meaningful for an unchanged Teams/Webhook channel.
  const keepsStoredUrl = !!channel && secretTarget && !typeChanged && !target.trim()
  const targetRequired = isNew || typeChanged || type === 'Email'
  const tError = targetError(type, target, targetRequired)
  const error = !name.trim() ? 'Name erforderlich.' : tError

  const save = useMutation({
    mutationFn: () => {
      const body: ChannelInput = {
        name: name.trim(),
        type,
        enabled,
        target: keepsStoredUrl ? null : target.trim(),
        events,
      }
      return isNew ? api.notifications.createChannel(body) : api.notifications.updateChannel(channel!.id, body)
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: channelsKey })
      toast.success(isNew ? `Kanal „${c.name}“ angelegt` : 'Änderungen gespeichert', {
        description: isNew ? 'Mit „Testnachricht senden“ können Sie die Zustellung prüfen.' : undefined,
      })
      onClose()
    },
  })

  const placeholder =
    type === 'Email'
      ? 'admin@contoso.com, tier0-team@contoso.com'
      : keepsStoredUrl || (channel && secretTarget && !typeChanged)
        ? channel!.target
        : type === 'Teams'
          ? 'https://contoso.webhook.office.com/…'
          : 'https://monitoring.contoso.com/hooks/tiermodel'

  return (
    <Sheet open={!!value} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <form
          className="flex h-full flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            setTouched(true)
            if (!error) save.mutate()
          }}
        >
          <SheetHeader>
            <SheetTitle>{isNew ? 'Kanal hinzufügen' : `„${channel?.name}“ bearbeiten`}</SheetTitle>
            <SheetDescription>Wohin und bei welchen Ereignissen benachrichtigt wird.</SheetDescription>
          </SheetHeader>
          <SheetBody className="grid content-start gap-5">
            <Field label="Name" htmlFor="ch-name" required error={touched && !name.trim() ? 'Name erforderlich.' : undefined}>
              <Input id="ch-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Tier-0-Team" autoFocus={isNew} autoComplete="off" />
            </Field>
            <div className="grid gap-1.5">
              <p className="text-[13px] font-medium">Typ</p>
              <Segmented<ChannelType>
                aria-label="Typ"
                value={type}
                onValueChange={(t) => {
                  setType(t)
                  setTarget(channel && channel.type === t && t === 'Email' ? channel.target : '')
                }}
                options={(Object.keys(typeMeta) as ChannelType[]).map((t) => ({ value: t, label: typeMeta[t].label, icon: typeMeta[t].icon }))}
              />
            </div>
            <Field
              label={typeMeta[type].targetLabel}
              htmlFor="ch-target"
              required={targetRequired}
              error={touched || target ? tError ?? undefined : undefined}
              hint={
                type === 'Email'
                  ? 'Mehrere Empfänger durch Komma trennen. Versand über den SMTP-Server rechts.'
                  : channel && !typeChanged
                    ? 'Die gespeicherte URL wird aus Sicherheitsgründen nur gekürzt angezeigt. Leer lassen, um sie beizubehalten.'
                    : type === 'Teams'
                      ? 'Webhook-URL eines Teams-Kanals (Workflows → „Beim Empfang einer Webhookanforderung posten“).'
                      : 'Der Dienst sendet ein JSON-Dokument per HTTP POST an diese Adresse.'
              }
            >
              <Input
                id="ch-target"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={placeholder}
                className="font-mono text-[13px]"
                autoComplete="off"
                spellCheck={false}
                inputMode={type === 'Email' ? 'email' : 'url'}
                aria-invalid={(touched || !!target) && !!tError ? true : undefined}
              />
            </Field>
            <div className="grid gap-2">
              <p className="text-[13px] font-medium">Ereignisse</p>
              <div className="grid gap-2">
                {eventMeta.map((e) => (
                  <label
                    key={e.key}
                    htmlFor={`ch-ev-${e.key}`}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-accent/40',
                      events[e.key] && 'border-primary/40 bg-primary/[0.04]',
                    )}
                  >
                    <Checkbox id={`ch-ev-${e.key}`} checked={events[e.key]} onCheckedChange={(v) => setEvents({ ...events, [e.key]: v === true })} className="mt-0.5" />
                    <span className="grid">
                      <span className="flex items-center gap-1.5 text-[13px] font-medium [&_svg]:size-3.5 [&_svg]:text-muted-foreground">{e.icon}{e.label}</span>
                      <span className="text-xs text-muted-foreground">{e.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <label htmlFor="ch-enabled" className="flex items-center justify-between gap-4 rounded-lg border px-3.5 py-3">
              <span className="grid">
                <span className="text-[13px] font-medium">Kanal aktiv</span>
                <span className="text-xs text-muted-foreground">Deaktivierte Kanäle erhalten keine Benachrichtigungen.</span>
              </span>
              <Switch id="ch-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </label>
          </SheetBody>
          <SheetFooter>
            {touched && error && <span className="mr-auto text-xs text-destructive">{error}</span>}
            <Button type="button" variant="outline" onClick={onClose}>Abbrechen</Button>
            <Button type="submit" loading={save.isPending}>{isNew ? <><Plus /> Anlegen</> : 'Speichern'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

const securityOptions: { value: SmtpSecurity; label: string; description: string; port: number }[] = [
  { value: 'StartTls', label: 'STARTTLS', description: 'Verschlüsselung nach Verbindungsaufbau (meist Port 587)', port: 587 },
  { value: 'SslOnConnect', label: 'SSL/TLS', description: 'Verschlüsselte Verbindung von Beginn an (meist Port 465)', port: 465 },
  { value: 'None', label: 'Keine', description: 'Unverschlüsselt (Port 25) – nur im internen Netz', port: 25 },
]

type PasswordAction = 'keep' | 'set' | 'clear'

function SmtpCard() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: smtpKey, queryFn: api.notifications.smtp })
  const [form, setForm] = React.useState<SmtpSettings | null>(null)
  const [pwAction, setPwAction] = React.useState<PasswordAction>('keep')
  const [password, setPassword] = React.useState('')

  const reset = React.useCallback((s: SmtpSettings) => {
    setForm(s)
    setPwAction('keep')
    setPassword('')
  }, [])
  React.useEffect(() => {
    if (q.data) reset(q.data)
  }, [q.data, reset])

  const save = useMutation({
    mutationFn: (f: SmtpSettings) => {
      const { hasPassword: _h, password: _p, ...rest } = f
      const body: SmtpUpdate = { ...rest, host: rest.host.trim(), username: rest.username.trim(), from: rest.from.trim() }
      if (pwAction === 'set') body.password = password
      else if (pwAction === 'clear') body.password = ''
      return api.notifications.updateSmtp(body)
    },
    onSuccess: (s) => {
      qc.setQueryData(smtpKey, s)
      reset(s)
      toast.success('SMTP-Einstellungen gespeichert')
    },
  })

  if (!form || !q.data) return <Skeleton className="h-[520px]" />

  const { hasPassword: _a, ...cmpForm } = form
  const { hasPassword: _b, ...cmpData } = q.data
  const dirty = JSON.stringify(cmpForm) !== JSON.stringify(cmpData) || pwAction !== 'keep'
  const portInvalid = !Number.isInteger(form.port) || form.port < 1 || form.port > 65535
  const fromInvalid = !!form.host.trim() && !form.from.trim()
  const set = <K extends keyof SmtpSettings>(k: K, v: SmtpSettings[K]) => setForm({ ...form, [k]: v })

  return (
    <Card className="xl:sticky xl:top-20">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (dirty && !portInvalid && !fromInvalid) save.mutate(form)
        }}
      >
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2"><Server className="size-4 text-muted-foreground" /> SMTP-Server</CardTitle>
            <CardDescription>Für Kanäle vom Typ E-Mail. Leer lassen, wenn kein E-Mail-Versand gewünscht ist.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
            <Field label="Server" htmlFor="smtp-host">
              <Input id="smtp-host" className="font-mono text-[13px]" placeholder="smtp.contoso.com" value={form.host} onChange={(e) => set('host', e.target.value)} autoComplete="off" spellCheck={false} />
            </Field>
            <Field label="Port" htmlFor="smtp-port" error={portInvalid ? '1–65535' : undefined}>
              <Input id="smtp-port" type="number" min={1} max={65535} value={Number.isNaN(form.port) ? '' : form.port} onChange={(e) => set('port', e.target.valueAsNumber)} aria-invalid={portInvalid || undefined} />
            </Field>
          </div>
          <Field label="Verschlüsselung" htmlFor="smtp-sec">
            <Select
              id="smtp-sec"
              value={form.security}
              onValueChange={(v) => {
                const next = securityOptions.find((o) => o.value === v)!
                const prevDefault = securityOptions.find((o) => o.value === form.security)?.port
                // Follow the conventional port unless the admin chose a custom one.
                setForm({ ...form, security: next.value, port: form.port === prevDefault || Number.isNaN(form.port) ? next.port : form.port })
              }}
              options={securityOptions.map((o) => ({ value: o.value, label: o.label, description: o.description }))}
            />
          </Field>
          <Field label="Absender" htmlFor="smtp-from" error={fromInvalid ? 'Absenderadresse erforderlich, wenn ein Server eingetragen ist.' : undefined} hint="z. B. tiermodel@contoso.com">
            <Input id="smtp-from" className="font-mono text-[13px]" placeholder="tiermodel@contoso.com" value={form.from} onChange={(e) => set('from', e.target.value)} autoComplete="off" aria-invalid={fromInvalid || undefined} />
          </Field>
          <Field label="Benutzername" htmlFor="smtp-user" hint="Leer lassen für anonymen Versand.">
            <Input id="smtp-user" className="font-mono text-[13px]" value={form.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="smtp-pw" className="text-[13px] font-medium">Passwort</label>
              {q.data.hasPassword && pwAction !== 'clear' && pwAction !== 'set' && (
                <Badge variant="success"><CheckCircle2 /> gespeichert</Badge>
              )}
            </div>
            {pwAction === 'clear' ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-rose-500/40 bg-rose-500/5 px-3 py-1.5 text-[13px] text-rose-700 dark:text-rose-300">
                Wird beim Speichern entfernt
                <Button type="button" variant="ghost" size="xs" onClick={() => setPwAction('keep')}><Undo2 /> Rückgängig</Button>
              </div>
            ) : (
              <Input
                id="smtp-pw"
                type="password"
                autoComplete="new-password"
                value={password}
                placeholder={q.data.hasPassword ? '•••••••• (unverändert)' : 'Kein Passwort gespeichert'}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setPwAction(e.target.value ? 'set' : 'keep')
                }}
              />
            )}
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Wird verschlüsselt gespeichert und nie angezeigt.</p>
              {q.data.hasPassword && pwAction !== 'clear' && (
                <Button type="button" variant="link" size="xs" className="h-auto px-0 text-rose-600 dark:text-rose-400" onClick={() => { setPassword(''); setPwAction('clear') }}>
                  Passwort entfernen
                </Button>
              )}
            </div>
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="button" variant="ghost" disabled={!dirty} onClick={() => reset(q.data!)}>Zurücksetzen</Button>
          <Button type="submit" disabled={!dirty || portInvalid || fromInvalid} loading={save.isPending}>{!save.isPending && <Save />} Speichern</Button>
        </CardFooter>
      </form>
    </Card>
  )
}
