import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { CalendarCheck2, CalendarClock, CalendarPlus, CalendarRange, Info, MoreHorizontal, OctagonX, Pencil, Snowflake, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { opsApi, type FreezePeriod, type FreezePeriodInput, type MaintenanceStatus, type MaintenanceWindow, type MaintenanceWindowInput } from '@/api/ops'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Combobox } from '@/components/ui/combobox'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Page, PageHeader } from '@/components/shared/page-header'
import { RequireAuth } from '@/features/auth/auth'
import { timeZones } from '@/features/runs/cron'
import { cn, formatDateTime, formatRelative } from '@/lib/utils'
import { dayPresets, describeDays, describeTimes, sameDays, weekdays } from './maintenance-model'

export function Component() {
  return (
    <RequireAuth role="Admin">
      <MaintenancePage />
    </RequireAuth>
  )
}

function MaintenancePage() {
  const q = useQuery({ queryKey: ['maintenance', 'overview'], queryFn: opsApi.maintenance.overview, refetchInterval: 60_000 })
  const [windowEdit, setWindowEdit] = React.useState<MaintenanceWindow | 'new' | null>(null)
  const [freezeEdit, setFreezeEdit] = React.useState<FreezePeriod | 'new' | null>(null)

  return (
    <Page>
      <PageHeader
        icon={<CalendarRange />}
        title="Wartungsfenster"
        description="Wann Änderungen im Active Directory angewendet werden dürfen – und wann nicht."
        actions={
          <>
            <Button variant="outline" onClick={() => setFreezeEdit('new')}><Snowflake /> Sperrzeit anlegen</Button>
            <Button onClick={() => setWindowEdit('new')}><CalendarPlus /> Fenster anlegen</Button>
          </>
        }
      />
      {q.isLoading || !q.data ? (
        <div className="grid gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <div className="grid gap-6">
          <StatusCard status={q.data.status} hasWindows={q.data.windows.length > 0} />
          <WindowsCard windows={q.data.windows} onEdit={setWindowEdit} />
          <FreezesCard freezes={q.data.freezes} onEdit={setFreezeEdit} />
        </div>
      )}
      <WindowSheet value={windowEdit} onClose={() => setWindowEdit(null)} />
      <FreezeSheet value={freezeEdit} onClose={() => setFreezeEdit(null)} />
    </Page>
  )
}

function StatusCard({ status: s, hasWindows }: { status: MaintenanceStatus; hasWindows: boolean }) {
  const tone = s.activeFreeze ? 'rose' : s.allowedNow ? 'emerald' : 'sky'
  return (
    <Card className="overflow-hidden">
      <div className={cn('h-1', tone === 'rose' ? 'bg-rose-500' : tone === 'emerald' ? 'bg-emerald-500' : 'bg-sky-500')} />
      <CardContent className="grid gap-5 pt-5 md:grid-cols-[1fr_auto]">
        <div className="flex gap-3">
          <span
            className={cn(
              'grid size-10 shrink-0 place-content-center rounded-lg [&_svg]:size-5',
              tone === 'rose' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-300' : tone === 'emerald' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' : 'bg-sky-500/10 text-sky-600 dark:text-sky-300',
            )}
          >
            {s.activeFreeze ? <OctagonX /> : s.allowedNow ? <CalendarCheck2 /> : <CalendarClock />}
          </span>
          <div className="grid min-w-0 gap-1">
            <p className="font-medium">
              {s.activeFreeze
                ? `Sperrzeit „${s.activeFreeze.reason}“ aktiv`
                : s.allowedNow
                  ? s.currentWindow ? `Wartungsfenster „${s.currentWindow.name}“ ist geöffnet` : 'Anwenden ist jederzeit möglich'
                  : 'Derzeit außerhalb der Wartungsfenster'}
            </p>
            <p className="text-[13px] text-muted-foreground">
              {s.activeFreeze ? (
                <>Bis {formatDateTime(s.activeFreeze.to)} ({formatRelative(s.activeFreeze.to)}) werden Anwenden-Läufe abgelehnt. Geplante Läufe starten im ersten Fenster danach{s.nextStart ? ` (${formatDateTime(s.nextStart)})` : ''}.</>
              ) : s.allowedNow ? (
                s.currentWindow ? <>Anwenden-Läufe starten sofort; das Fenster schließt {formatDateTime(s.currentWindow.end)}.</> : hasWindows
                  ? 'Alle Wartungsfenster sind deaktiviert – Anwenden ist daher jederzeit möglich (außer in Sperrzeiten).'
                  : 'Solange kein Wartungsfenster aktiv ist, dürfen Anwenden-Läufe jederzeit starten (außer in Sperrzeiten).'
              ) : (
                <>Neue Anwenden-Läufe werden geplant und starten automatisch {s.nextStart ? <strong className="text-foreground">{formatDateTime(s.nextStart)}</strong> : 'im nächsten Fenster'}.</>
              )}
            </p>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-px size-3.5 shrink-0" />
              Planungsläufe, Audits und Überwachungen sind nie eingeschränkt. Die Prüfung der Planung (Gültigkeit, Konfigurationsstand) erfolgt beim Einreichen.
            </p>
          </div>
        </div>
        <div className="grid content-start gap-2 text-[13px] md:min-w-64">
          {s.restricted && s.upcoming.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Nächste Fenster</p>
              <ul className="grid gap-1">
                {s.upcoming.slice(0, 3).map((w) => (
                  <li key={`${w.windowId}-${w.start}`} className="flex flex-wrap justify-between gap-x-3">
                    <span className="truncate">{w.name}</span>
                    <span className="text-muted-foreground tabular">{formatDateTime(w.start)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {s.scheduledRuns > 0 && (
            <Link to="/laeufe?status=Scheduled" className="inline-flex items-center gap-1.5 text-primary hover:underline">
              <CalendarClock className="size-3.5" /> {s.scheduledRuns === 1 ? '1 geplanter Lauf' : `${s.scheduledRuns} geplante Läufe`}
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function WindowsCard({ windows, onEdit }: { windows: MaintenanceWindow[]; onEdit: (w: MaintenanceWindow | 'new') => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['maintenance'] })
  const toggle = useMutation({
    mutationFn: (w: MaintenanceWindow) => opsApi.maintenance.updateWindow(w.id, { ...w, enabled: !w.enabled }),
    onSuccess: (w) => { toast.success(w.enabled ? `„${w.name}“ aktiviert` : `„${w.name}“ deaktiviert`); invalidate() },
  })
  const remove = useMutation({
    mutationFn: (w: MaintenanceWindow) => opsApi.maintenance.removeWindow(w.id),
    onSuccess: () => { toast.success('Wartungsfenster gelöscht'); invalidate() },
  })

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CalendarRange className="size-4 text-muted-foreground" />
          <CardTitle>Wartungsfenster</CardTitle>
        </div>
        <CardDescription>Wiederkehrende Zeiträume, in denen Anwenden-Läufe starten dürfen. Ein Lauf, der im Fenster startet, darf darüber hinaus laufen.</CardDescription>
      </CardHeader>
      {windows.length === 0 ? (
        <EmptyState
          compact
          icon={<CalendarRange />}
          title="Keine Wartungsfenster"
          description="Ohne Wartungsfenster dürfen Anwenden-Läufe jederzeit starten. Legen Sie ein Fenster an, um Änderungen auf feste Zeiten zu beschränken."
          action={<Button size="sm" onClick={() => onEdit('new')}><CalendarPlus /> Fenster anlegen</Button>}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Zeit</TH>
              <TH className="hidden md:table-cell">Zeitzone</TH>
              <TH className="w-20">Aktiv</TH>
              <TH className="w-10"><span className="sr-only">Aktionen</span></TH>
            </TR>
          </THead>
          <TBody>
            {windows.map((w) => (
              <TR key={w.id} className={cn(!w.enabled && 'text-muted-foreground')}>
                <TD>
                  <p className="font-medium text-foreground">{w.name}</p>
                  <div className="mt-1 flex flex-wrap gap-0.5">
                    {weekdays.map((d) => (
                      <span
                        key={d.value}
                        title={d.long}
                        className={cn(
                          'grid h-5 w-6 place-content-center rounded text-[10px] font-semibold',
                          w.days.includes(d.value) ? 'bg-primary/10 text-primary dark:bg-primary/20' : 'bg-muted text-muted-foreground/60',
                        )}
                      >
                        {d.short}
                      </span>
                    ))}
                  </div>
                </TD>
                <TD className="text-[13px]">
                  <p>{describeDays(w.days)}</p>
                  <p className="text-xs text-muted-foreground">{describeTimes(w.from, w.to)}</p>
                </TD>
                <TD className="hidden text-[13px] md:table-cell">{w.timeZone}</TD>
                <TD>
                  <Switch checked={w.enabled} onCheckedChange={() => toggle.mutate(w)} aria-label={`${w.name} aktiv`} />
                </TD>
                <TD>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-xs" aria-label={`Aktionen für ${w.name}`}><MoreHorizontal /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onEdit(w)}><Pencil /> Bearbeiten</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        destructive
                        onSelect={async () => {
                          if (await confirm({ title: `Wartungsfenster „${w.name}“ löschen?`, description: 'Geplante Läufe werden auf das nächste verbleibende Fenster verschoben.', confirmText: 'Löschen', destructive: true }))
                            remove.mutate(w)
                        }}
                      >
                        <Trash2 /> Löschen
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  )
}

function FreezeState({ f }: { f: FreezePeriod }) {
  if (!f.enabled) return <Badge variant="muted">Deaktiviert</Badge>
  if (f.active) return <Badge variant="danger"><OctagonX /> Aktiv</Badge>
  if (f.past) return <Badge variant="outline">Vorbei</Badge>
  return <Badge variant="info"><CalendarClock /> Bevorstehend</Badge>
}

function FreezesCard({ freezes, onEdit }: { freezes: FreezePeriod[]; onEdit: (f: FreezePeriod | 'new') => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['maintenance'] })
  const toggle = useMutation({
    mutationFn: (f: FreezePeriod) => opsApi.maintenance.updateFreeze(f.id, { from: f.from, to: f.to, reason: f.reason, enabled: !f.enabled }),
    onSuccess: (f) => { toast.success(f.enabled ? `Sperrzeit „${f.reason}“ aktiviert` : `Sperrzeit „${f.reason}“ deaktiviert`); invalidate() },
  })
  const remove = useMutation({
    mutationFn: (f: FreezePeriod) => opsApi.maintenance.removeFreeze(f.id),
    onSuccess: () => { toast.success('Sperrzeit gelöscht'); invalidate() },
  })

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Snowflake className="size-4 text-muted-foreground" />
          <CardTitle>Sperrzeiten</CardTitle>
        </div>
        <CardDescription>Zeiträume ohne Änderungen, z. B. Jahresabschluss oder Feiertage. Anwenden wird in dieser Zeit abgelehnt – auch innerhalb eines Wartungsfensters.</CardDescription>
      </CardHeader>
      {freezes.length === 0 ? (
        <EmptyState compact icon={<Snowflake />} title="Keine Sperrzeiten" action={<Button size="sm" variant="outline" onClick={() => onEdit('new')}><Snowflake /> Sperrzeit anlegen</Button>} />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Grund</TH>
              <TH>Zeitraum</TH>
              <TH className="hidden sm:table-cell">Status</TH>
              <TH className="w-20">Aktiv</TH>
              <TH className="w-10"><span className="sr-only">Aktionen</span></TH>
            </TR>
          </THead>
          <TBody>
            {freezes.map((f) => (
              <TR key={f.id} className={cn((!f.enabled || f.past) && 'text-muted-foreground')}>
                <TD>
                  <p className="font-medium text-foreground">{f.reason}</p>
                  <p className="text-xs text-muted-foreground">von {f.createdBy}</p>
                </TD>
                <TD className="text-[13px]">
                  <p>{formatDateTime(f.from)}</p>
                  <p className="text-xs text-muted-foreground">bis {formatDateTime(f.to)}</p>
                </TD>
                <TD className="hidden sm:table-cell"><FreezeState f={f} /></TD>
                <TD>
                  <Switch checked={f.enabled} onCheckedChange={() => toggle.mutate(f)} aria-label={`Sperrzeit ${f.reason} aktiv`} />
                </TD>
                <TD>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-xs" aria-label={`Aktionen für ${f.reason}`}><MoreHorizontal /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onEdit(f)}><Pencil /> Bearbeiten</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        destructive
                        onSelect={async () => {
                          if (await confirm({ title: `Sperrzeit „${f.reason}“ löschen?`, confirmText: 'Löschen', destructive: true })) remove.mutate(f)
                        }}
                      >
                        <Trash2 /> Löschen
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  )
}

const defaultWindow = (): MaintenanceWindowInput => ({ name: '', days: [1, 2, 3, 4, 5], from: '22:00', to: '04:00', timeZone: 'Europe/Berlin', enabled: true })

function WindowSheet({ value, onClose }: { value: MaintenanceWindow | 'new' | null; onClose: () => void }) {
  const open = value !== null
  const isNew = value === 'new'
  const [form, setForm] = React.useState<MaintenanceWindowInput>(defaultWindow)
  const tzOptions = React.useMemo(() => timeZones().map((z) => ({ value: z })), [])
  const qc = useQueryClient()

  React.useEffect(() => {
    if (!value) return
    setForm(value === 'new' ? defaultWindow() : { name: value.name, days: value.days, from: value.from, to: value.to, timeZone: value.timeZone, enabled: value.enabled })
  }, [value])

  const toggleDay = (d: number) => setForm((f) => ({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d] }))
  const error = !form.name.trim() ? 'Name ist erforderlich.' : !form.days.length ? 'Mindestens einen Wochentag wählen.' : !/^\d{2}:\d{2}$/.test(form.from) || !/^\d{2}:\d{2}$/.test(form.to) ? 'Uhrzeiten angeben.' : null

  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, name: form.name.trim() }
      return isNew ? opsApi.maintenance.createWindow(body) : opsApi.maintenance.updateWindow((value as MaintenanceWindow).id, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance'] })
      qc.invalidateQueries({ queryKey: ['runs'] })
      toast.success(isNew ? 'Wartungsfenster angelegt' : 'Wartungsfenster gespeichert')
      onClose()
    },
  })

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <form className="flex h-full flex-col" onSubmit={(e) => { e.preventDefault(); if (!error) save.mutate() }}>
          <SheetHeader>
            <SheetTitle>{isNew ? 'Neues Wartungsfenster' : 'Wartungsfenster bearbeiten'}</SheetTitle>
            <SheetDescription>Anwenden-Läufe starten nur innerhalb eines aktiven Fensters.</SheetDescription>
          </SheetHeader>
          <SheetBody className="grid content-start gap-6">
            <Field label="Name" htmlFor="mw-name" required>
              <Input id="mw-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="z. B. Nachtfenster werktags" autoFocus maxLength={100} />
            </Field>
            <div className="grid gap-2">
              <p className="text-[13px] font-medium">Wochentage <span className="text-destructive" aria-hidden>*</span></p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Wochentage">
                {weekdays.map((d) => {
                  const on = form.days.includes(d.value)
                  return (
                    <button
                      key={d.value}
                      type="button"
                      aria-pressed={on}
                      title={d.long}
                      onClick={() => toggleDay(d.value)}
                      className={cn(
                        'h-9 w-10 rounded-lg border text-[13px] font-medium transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                        on && 'border-primary/50 bg-primary/10 text-primary hover:bg-primary/15',
                      )}
                    >
                      {d.short}
                    </button>
                  )
                })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {dayPresets.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setForm({ ...form, days: p.days })}
                    className={cn('rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent', sameDays(form.days, p.days) && 'border-primary/50 bg-primary/10 text-primary')}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Von" htmlFor="mw-from" required>
                <Input id="mw-from" type="time" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
              </Field>
              <Field label="Bis" htmlFor="mw-to" required>
                <Input id="mw-to" type="time" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
              </Field>
            </div>
            <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-[13px]">
              <CalendarClock className="mt-0.5 size-4 shrink-0 opacity-70" />
              <span>
                {form.days.length ? describeDays(form.days) : 'Kein Tag gewählt'}, {describeTimes(form.from, form.to)}
                <span className="text-muted-foreground"> ({form.timeZone})</span>
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Zeitzone" htmlFor="mw-tz" hint="Sommer- und Winterzeit werden berücksichtigt.">
                <Combobox id="mw-tz" value={form.timeZone} onChange={(v) => setForm({ ...form, timeZone: v })} options={tzOptions} allowCustom={false} searchPlaceholder="Zeitzone suchen …" />
              </Field>
              <Field label="Status" htmlFor="mw-enabled">
                <label htmlFor="mw-enabled" className="flex h-9 items-center gap-3 text-[13px]">
                  <Switch id="mw-enabled" checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
                  {form.enabled ? 'Aktiv' : 'Deaktiviert'}
                </label>
              </Field>
            </div>
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

/** ISO timestamp → value of an <input type="datetime-local"> (browser time zone). */
function toLocalInput(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(v: string) {
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

function defaultFreeze() {
  const start = new Date()
  start.setDate(start.getDate() + 1)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return { reason: '', from: toLocalInput(start.toISOString()), to: toLocalInput(end.toISOString()), enabled: true }
}

function FreezeSheet({ value, onClose }: { value: FreezePeriod | 'new' | null; onClose: () => void }) {
  const open = value !== null
  const isNew = value === 'new'
  const [form, setForm] = React.useState(defaultFreeze)
  const qc = useQueryClient()

  React.useEffect(() => {
    if (!value) return
    setForm(value === 'new' ? defaultFreeze() : { reason: value.reason, from: toLocalInput(value.from), to: toLocalInput(value.to), enabled: value.enabled })
  }, [value])

  const from = fromLocalInput(form.from)
  const to = fromLocalInput(form.to)
  const error = !form.reason.trim() ? 'Grund ist erforderlich.' : !from || !to ? 'Beginn und Ende angeben.' : to <= from ? 'Das Ende muss nach dem Beginn liegen.' : null
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone

  const save = useMutation({
    mutationFn: () => {
      const body: FreezePeriodInput = { reason: form.reason.trim(), from: from!, to: to!, enabled: form.enabled }
      return isNew ? opsApi.maintenance.createFreeze(body) : opsApi.maintenance.updateFreeze((value as FreezePeriod).id, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance'] })
      qc.invalidateQueries({ queryKey: ['runs'] })
      toast.success(isNew ? 'Sperrzeit angelegt' : 'Sperrzeit gespeichert')
      onClose()
    },
  })

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <form className="flex h-full flex-col" onSubmit={(e) => { e.preventDefault(); if (!error) save.mutate() }}>
          <SheetHeader>
            <SheetTitle>{isNew ? 'Neue Sperrzeit' : 'Sperrzeit bearbeiten'}</SheetTitle>
            <SheetDescription>In einer Sperrzeit wird Anwenden abgelehnt; geplante Läufe starten im ersten Wartungsfenster danach.</SheetDescription>
          </SheetHeader>
          <SheetBody className="grid content-start gap-6">
            <Field label="Grund" htmlFor="fz-reason" required>
              <Input id="fz-reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="z. B. Jahresabschluss" autoFocus maxLength={200} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Beginn" htmlFor="fz-from" required>
                <Input id="fz-from" type="datetime-local" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
              </Field>
              <Field label="Ende" htmlFor="fz-to" required>
                <Input id="fz-to" type="datetime-local" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
              </Field>
            </div>
            <p className="-mt-3 text-xs text-muted-foreground">Zeiten in Ihrer Zeitzone ({zone}).</p>
            <Field label="Status" htmlFor="fz-enabled">
              <label htmlFor="fz-enabled" className="flex h-9 items-center gap-3 text-[13px]">
                <Switch id="fz-enabled" checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
                {form.enabled ? 'Aktiv' : 'Deaktiviert'}
              </label>
            </Field>
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
