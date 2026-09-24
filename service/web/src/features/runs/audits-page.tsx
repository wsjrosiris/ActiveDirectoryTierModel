import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import {
  CalendarClock,
  CalendarPlus,
  Clock,
  History,
  MoreHorizontal,
  Pencil,
  Play,
  ScanSearch,
  ShieldUser,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { RunRequest, Schedule, ScheduleInput, ScheduleKind } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Combobox } from '@/components/ui/combobox'
import { Segmented } from '@/components/ui/segmented'
import { useDomainControllerOptions } from '@/features/config/lookups'
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
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip } from '@/components/ui/tooltip'
import { Page, PageHeader } from '@/components/shared/page-header'
import { useCan } from '@/features/auth/auth'
import { scopeLabels } from '@/lib/labels'
import { cn, formatDateTime, formatRelative } from '@/lib/utils'
import { cronPresets, describeCron, timeZones } from './cron'
import { emptyRunRequest, includesFromRequest, RunRequestFields, runRequestError, settingsQuery } from './run-request-form'
import { RunsTable } from './runs-table'

export function Component() {
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = location.pathname.endsWith('/zeitplaene') ? 'schedules' : 'history'
  const canEdit = useCan('Editor')
  const canOperate = useCan('Operator')
  const [startOpen, setStartOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Schedule | 'new' | 'new-monitor' | null>(null)

  React.useEffect(() => {
    if (params.get('start') === '1') {
      if (canEdit) setStartOpen(true)
      const p = new URLSearchParams(params)
      p.delete('start')
      setParams(p, { replace: true })
    }
    // From "Privilegierte Zugriffe": create a monitor schedule.
    if (params.get('neu') === 'ueberwachung') {
      if (canOperate) setEditing('new-monitor')
      const p = new URLSearchParams(params)
      p.delete('neu')
      setParams(p, { replace: true })
    }
  }, [params, setParams, canEdit, canOperate])

  return (
    <Page wide>
      <PageHeader
        icon={<ScanSearch />}
        title="Audits"
        description="Soll/Ist-Vergleich zwischen Konfiguration und Active Directory – manuell oder zeitgesteuert."
        actions={
          <>
            {tab === 'schedules' && canOperate && (
              <Button variant="outline" onClick={() => setEditing('new')}>
                <CalendarPlus /> Neuer Zeitplan
              </Button>
            )}
            {canEdit && (
              <Button onClick={() => setStartOpen(true)}>
                <Play /> Audit starten
              </Button>
            )}
          </>
        }
      />
      <Tabs value={tab} onValueChange={(v) => navigate(v === 'schedules' ? '/audits/zeitplaene' : '/audits')}>
        <TabsList className="mb-4">
          <TabsTrigger value="history"><History /> Verlauf</TabsTrigger>
          <TabsTrigger value="schedules"><CalendarClock /> Zeitpläne</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'history' ? (
        <RunsTable kind="Audit" hideKind emptyAction={canEdit && <Button size="sm" onClick={() => setStartOpen(true)}><Play /> Erstes Audit starten</Button>} />
      ) : (
        <Schedules onEdit={setEditing} />
      )}
      <StartAuditSheet open={startOpen} onOpenChange={setStartOpen} />
      <ScheduleSheet value={editing} onClose={() => setEditing(null)} />
    </Page>
  )
}

function StartAuditSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [req, setReq] = React.useState<RunRequest>(emptyRunRequest)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const error = runRequestError(req)
  const start = useMutation({
    mutationFn: () => api.runs.audit({ ...req, preferredDc: req.preferredDc.trim() }),
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(`Audit #${run.id} eingereiht`)
      onOpenChange(false)
      navigate(`/laeufe/${run.id}`)
    },
  })
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl">
        <form className="flex h-full flex-col" onSubmit={(e) => { e.preventDefault(); if (!error) start.mutate() }}>
          <SheetHeader>
            <SheetTitle>Audit starten</SheetTitle>
            <SheetDescription>Vergleicht das Active Directory mit der gespeicherten Soll-Konfiguration. Es werden keine Änderungen vorgenommen.</SheetDescription>
          </SheetHeader>
          <SheetBody>
            <RunRequestFields value={req} onChange={setReq} idPrefix="audit" compact />
          </SheetBody>
          <SheetFooter>
            {error && <span className="mr-auto text-xs text-muted-foreground">{error}</span>}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
            <Button type="submit" disabled={!!error} loading={start.isPending}>{!start.isPending && <Play />} Audit starten</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function toInput(s: Schedule): ScheduleInput {
  return {
    kind: s.kind ?? 'Audit', name: s.name, cron: s.cron, timeZone: s.timeZone, enabled: s.enabled,
    preferredDc: s.preferredDc, scope: s.scope, includeMsa: s.includeMsa, includeGmsa: s.includeGmsa,
    includeDmsa: s.includeDmsa, includeWinLaps: s.includeWinLaps,
    ...(s.admlLanguage ? { admlLanguage: s.admlLanguage } : {}),
  }
}

function Schedules({ onEdit }: { onEdit: (s: Schedule) => void }) {
  const canOperate = useCan('Operator')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const q = useQuery({ queryKey: ['schedules'], queryFn: api.schedules.list, refetchInterval: 30_000 })

  const toggle = useMutation({
    mutationFn: (s: Schedule) => api.schedules.update(s.id, { ...toInput(s), enabled: !s.enabled }),
    onMutate: async (s) => {
      await qc.cancelQueries({ queryKey: ['schedules'] })
      const prev = qc.getQueryData<Schedule[]>(['schedules'])
      qc.setQueryData<Schedule[]>(['schedules'], (list) => list?.map((x) => (x.id === s.id ? { ...x, enabled: !s.enabled } : x)))
      return { prev }
    },
    onError: (_e, _s, ctx) => ctx?.prev && qc.setQueryData(['schedules'], ctx.prev),
    onSuccess: (s) => toast.success(s.enabled ? `„${s.name}“ aktiviert` : `„${s.name}“ pausiert`),
    onSettled: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  })
  const runNow = useMutation({
    mutationFn: (s: Schedule) => api.schedules.run(s.id),
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      toast.success(`${run.kind === 'Monitor' ? 'Überwachung' : 'Audit'} #${run.id} eingereiht`, { action: { label: 'Öffnen', onClick: () => navigate(`/laeufe/${run.id}`) } })
    },
  })
  const remove = useMutation({
    mutationFn: (s: Schedule) => api.schedules.remove(s.id),
    onSuccess: () => {
      toast.success('Zeitplan gelöscht')
      qc.invalidateQueries({ queryKey: ['schedules'] })
    },
  })

  if (q.isLoading) return <Card className="grid gap-2 p-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)}</Card>
  const list = q.data ?? []
  if (!list.length)
    return (
      <Card>
        <EmptyState
          icon={<CalendarClock />}
          title="Keine Zeitpläne"
          description="Planen Sie regelmäßige Audits, um Drift frühzeitig zu erkennen, und eine Überwachung der privilegierten Gruppen (empfohlen: alle 15 Minuten)."
          action={canOperate && <Button size="sm" onClick={() => onEdit({} as Schedule)}><CalendarPlus /> Zeitplan anlegen</Button>}
        />
      </Card>
    )

  return (
    <Card className="overflow-hidden">
      <Table>
        <THead>
          <TR>
            <TH>Name</TH>
            <TH>Zeitplan</TH>
            <TH className="hidden md:table-cell">Art / Bereich</TH>
            <TH>Nächster Lauf</TH>
            <TH className="hidden lg:table-cell">Letzter Lauf</TH>
            <TH className="w-20">Aktiv</TH>
            <TH className="w-10"><span className="sr-only">Aktionen</span></TH>
          </TR>
        </THead>
        <TBody>
          {list.map((s) => {
            const d = describeCron(s.cron)
            return (
              <TR key={s.id} className={cn(!s.enabled && 'text-muted-foreground')}>
                <TD>
                  <p className="flex items-center gap-1.5 font-medium text-foreground">
                    {s.kind === 'Monitor' ? <ShieldUser className="size-3.5 shrink-0 text-teal-600 dark:text-teal-300" aria-label="Überwachung" /> : <ScanSearch className="size-3.5 shrink-0 text-sky-600 dark:text-sky-300" aria-label="Audit" />}
                    {s.name}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">{s.preferredDc}</p>
                </TD>
                <TD>
                  <p className="text-[13px]">{d.text}</p>
                  <p className="font-mono text-xs text-muted-foreground">{s.cron} · {s.timeZone}</p>
                </TD>
                <TD className="hidden text-[13px] md:table-cell">
                  {s.kind === 'Monitor' ? 'Überwachung privilegierter Gruppen' : s.scope ? scopeLabels[s.scope] : 'Nur Add-ons'}
                  {s.kind !== 'Monitor' && includesFromRequest(s).length > 0 && <span className="text-xs text-muted-foreground"> + {includesFromRequest(s).join(', ')}</span>}
                </TD>
                <TD className="text-[13px]">
                  {s.enabled && s.nextRunAt ? (
                    <span title={formatDateTime(s.nextRunAt)} className="inline-flex items-center gap-1.5"><Clock className="size-3.5 text-muted-foreground" />{formatRelative(s.nextRunAt)}</span>
                  ) : (
                    <Badge variant="muted">Pausiert</Badge>
                  )}
                </TD>
                <TD className="hidden text-[13px] lg:table-cell">
                  {s.lastRunId ? <Link to={`/laeufe/${s.lastRunId}`} className="text-primary hover:underline">#{s.lastRunId}</Link> : '–'}
                  {s.lastRunAt && <span className="ml-1.5 text-xs text-muted-foreground">{formatRelative(s.lastRunAt)}</span>}
                </TD>
                <TD>
                  <Tooltip content={canOperate ? undefined : 'Erfordert die Rolle Operator'} disabled={canOperate}>
                    <span>
                      <Switch checked={s.enabled} disabled={!canOperate} onCheckedChange={() => toggle.mutate(s)} aria-label={`${s.name} aktiv`} />
                    </span>
                  </Tooltip>
                </TD>
                <TD>
                  {canOperate && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label="Aktionen"><MoreHorizontal /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => runNow.mutate(s)}><Play /> Jetzt ausführen</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onEdit(s)}><Pencil /> Bearbeiten</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          destructive
                          onSelect={async () => {
                            if (await confirm({ title: `Zeitplan „${s.name}“ löschen?`, description: 'Bereits ausgeführte Läufe bleiben erhalten.', confirmText: 'Löschen', destructive: true }))
                              remove.mutate(s)
                          }}
                        >
                          <Trash2 /> Löschen
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TD>
              </TR>
            )
          })}
        </TBody>
      </Table>
    </Card>
  )
}

const MONITOR_CRON = '*/15 * * * *'

const defaultSchedule = (kind: ScheduleKind = 'Audit'): ScheduleInput => ({
  ...emptyRunRequest(),
  kind,
  name: kind === 'Monitor' ? 'Überwachung privilegierter Gruppen' : '',
  cron: kind === 'Monitor' ? MONITOR_CRON : '0 2 * * *',
  timeZone: 'Europe/Berlin',
  enabled: true,
})

function ScheduleSheet({ value, onClose }: { value: Schedule | 'new' | 'new-monitor' | null; onClose: () => void }) {
  const open = value !== null
  const isNew = value === 'new' || value === 'new-monitor' || (value !== null && !value.id)
  const [form, setForm] = React.useState<ScheduleInput>(defaultSchedule)
  const qc = useQueryClient()
  const tzOptions = React.useMemo(() => timeZones().map((z) => ({ value: z })), [])
  const dcOptions = useDomainControllerOptions()
  const monitor = form.kind === 'Monitor'
  const settings = useQuery(settingsQuery).data

  React.useEffect(() => {
    if (!open) return
    // Monitor schedules only need the domain controller: prefilled from the settings like in the run forms.
    setForm(isNew ? { ...defaultSchedule(value === 'new-monitor' ? 'Monitor' : 'Audit'), preferredDc: settings?.defaultPreferredDc ?? '' } : toInput(value as Schedule))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const setKind = (kind: ScheduleKind) => setForm((f) => ({
    ...f,
    kind,
    // Switching a new schedule also switches the suggested defaults.
    cron: isNew && f.cron === (kind === 'Monitor' ? '0 2 * * *' : MONITOR_CRON) ? (kind === 'Monitor' ? MONITOR_CRON : '0 2 * * *') : f.cron,
    name: isNew && (f.name === '' || f.name === 'Überwachung privilegierter Gruppen') ? (kind === 'Monitor' ? 'Überwachung privilegierter Gruppen' : '') : f.name,
  }))

  // Settings may arrive after the sheet opened.
  React.useEffect(() => {
    if (open && settings?.defaultPreferredDc) setForm((f) => (f.preferredDc ? f : { ...f, preferredDc: settings.defaultPreferredDc }))
  }, [open, settings, value])

  const cron = describeCron(form.cron)
  const reqError = monitor ? (form.preferredDc.trim() ? null : 'Bitte einen Domain Controller angeben.') : runRequestError(form)
  const error = !form.name.trim() ? 'Name ist erforderlich.' : cron.error ? 'Cron-Ausdruck prüfen.' : reqError

  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, name: form.name.trim(), cron: form.cron.trim(), preferredDc: form.preferredDc.trim() }
      return isNew ? api.schedules.create(body) : api.schedules.update((value as Schedule).id, body)
    },
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['schedules'] })
      toast.success(isNew ? 'Zeitplan angelegt' : 'Zeitplan gespeichert', { description: s.nextRunAt ? `Nächster Lauf ${formatDateTime(s.nextRunAt)}` : undefined })
      onClose()
    },
  })

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-2xl">
        <form className="flex h-full flex-col" onSubmit={(e) => { e.preventDefault(); if (!error) save.mutate() }}>
          <SheetHeader>
            <SheetTitle>{isNew ? 'Neuer Zeitplan' : 'Zeitplan bearbeiten'}</SheetTitle>
            <SheetDescription>Geplante Audits und Überwachungen laufen automatisch im Hintergrund.</SheetDescription>
          </SheetHeader>
          <SheetBody className="grid content-start gap-6">
            <Field label="Art" htmlFor="s-kind">
              <Segmented<ScheduleKind>
                aria-label="Art des Zeitplans"
                className="w-fit max-w-full"
                value={form.kind}
                onValueChange={setKind}
                options={[
                  { value: 'Audit', label: 'Audit', icon: <ScanSearch /> },
                  { value: 'Monitor', label: 'Überwachung privilegierter Gruppen', icon: <ShieldUser /> },
                ]}
              />
              <p className="text-xs text-muted-foreground">
                {monitor
                  ? 'Prüft Mitglieder der geschützten und Tier-0-Gruppen, Konten-Hygiene und Angriffspfade und meldet Änderungen. Empfohlen: alle 15 Minuten.'
                  : 'Vergleicht das Active Directory mit der Soll-Konfiguration.'}
              </p>
            </Field>
            <Field label="Name" htmlFor="s-name" required>
              <Input id="s-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="z. B. Nächtliches Audit" autoFocus />
            </Field>
            <div className="grid gap-3">
              <Field label="Cron-Ausdruck" htmlFor="s-cron" required>
                <Input id="s-cron" className="font-mono" value={form.cron} onChange={(e) => setForm({ ...form, cron: e.target.value })} aria-invalid={cron.error || undefined} placeholder="0 2 * * *" />
              </Field>
              <div className="flex flex-wrap gap-1.5">
                {(monitor ? [{ label: 'Alle 15 Minuten', cron: MONITOR_CRON }, { label: 'Alle 5 Minuten', cron: '*/5 * * * *' }, ...cronPresets.slice(0, 2)] : cronPresets).map((p) => (
                  <button
                    key={p.cron}
                    type="button"
                    onClick={() => setForm({ ...form, cron: p.cron })}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent',
                      form.cron.trim() === p.cron && 'border-primary/50 bg-primary/10 text-primary',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px]', cron.error ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'bg-muted/40')}>
                <CalendarClock className="mt-0.5 size-4 shrink-0 opacity-70" />
                <span>{cron.text}{!cron.error && <span className="text-muted-foreground"> ({form.timeZone})</span>}</span>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Zeitzone" htmlFor="s-tz">
                <Combobox id="s-tz" value={form.timeZone} onChange={(v) => setForm({ ...form, timeZone: v })} options={tzOptions} allowCustom={false} searchPlaceholder="Zeitzone suchen …" />
              </Field>
              <Field label="Status" htmlFor="s-enabled">
                <label htmlFor="s-enabled" className="flex h-9 items-center gap-3 text-[13px]">
                  <Switch id="s-enabled" checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
                  {form.enabled ? 'Aktiv' : 'Pausiert'}
                </label>
              </Field>
            </div>
            <div className="border-t pt-6">
              {monitor ? (
                <Field label="Domain Controller" htmlFor="sched-mon-dc" required hint={settings ? `Standard: ${settings.defaultPreferredDc || '–'}` : undefined}>
                  <Combobox
                    id="sched-mon-dc"
                    mono
                    value={form.preferredDc}
                    onChange={(v) => setForm({ ...form, preferredDc: v })}
                    options={dcOptions}
                    placeholder="dc01.contoso.local"
                    searchPlaceholder="DC suchen oder FQDN eingeben …"
                    emptyText="Keine Domain Controller gefunden – FQDN eingeben"
                  />
                </Field>
              ) : (
                <RunRequestFields value={form} onChange={(r) => setForm({ ...form, ...r })} idPrefix="sched" compact />
              )}
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
