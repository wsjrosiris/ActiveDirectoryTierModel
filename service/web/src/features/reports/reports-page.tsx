import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Download,
  ExternalLink,
  FileClock,
  FileText,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  ScanSearch,
  Send,
  ShieldUser,
  Trash2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/api/client'
import type { ReportFrequency, ReportSchedule, ReportScheduleInput, ReportType, ReportTypeInfo } from '@/api/types'
import { useDomains } from '@/features/domains/domain-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Combobox } from '@/components/ui/combobox'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { MultiCombobox } from '@/components/ui/multi-combobox'
import { Segmented } from '@/components/ui/segmented'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tooltip } from '@/components/ui/tooltip'
import { Page, PageHeader } from '@/components/shared/page-header'
import { useCan } from '@/features/auth/auth'
import { errorMessage } from '@/lib/query'
import { cn, formatDateTime, formatRelative } from '@/lib/utils'

export function Component() {
  return <ReportsPage />
}

const typeIcons: Record<ReportType, React.ReactNode> = {
  'soll-ist': <ScanSearch />,
  aenderungen: <FileClock />,
  privilegiert: <ShieldUser />,
}

const typeTones: Record<ReportType, string> = {
  'soll-ist': 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  aenderungen: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  privilegiert: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
}

const typeTitles: Record<ReportType, string> = {
  'soll-ist': 'Soll/Ist-Bericht',
  aenderungen: 'Änderungen im Zeitraum',
  privilegiert: 'Privilegierte Zugriffe',
}

function isoDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return isoDate(d)
}

const presets: { value: string; label: string; from: () => string }[] = [
  { value: '7', label: '7 Tage', from: () => daysAgo(6) },
  { value: '30', label: '30 Tage', from: () => daysAgo(29) },
  { value: '90', label: '90 Tage', from: () => daysAgo(89) },
  { value: 'jahr', label: 'Dieses Jahr', from: () => `${new Date().getFullYear()}-01-01` },
]

function ReportsPage() {
  const isAdmin = useCan('Admin')
  const types = useQuery({ queryKey: ['reports', 'types'], queryFn: api.reports.types })
  const [type, setType] = React.useState<ReportType>('soll-ist')
  const [from, setFrom] = React.useState(() => daysAgo(29))
  const [to, setTo] = React.useState(() => isoDate(new Date()))
  const [preset, setPreset] = React.useState('30')
  const [version, setVersion] = React.useState(0)
  const [loading, setLoading] = React.useState(true)

  const rangeInvalid = !from || !to || from > to
  const params = { from: type === 'soll-ist' ? undefined : from, to }
  const previewUrl = rangeInvalid ? null : `${api.reports.url(type, { ...params, format: 'html' })}&v=${version}`
  const pdfUrl = api.reports.url(type, { ...params, format: 'pdf' })
  const info = types.data?.find((t) => t.type === type)

  React.useEffect(() => setLoading(true), [previewUrl])

  return (
    <Page wide className="max-w-[1400px]">
      <PageHeader
        icon={<FileText />}
        title="Berichte"
        description="Nachweise als PDF: Soll/Ist-Abgleich, Änderungen im Zeitraum und privilegierte Zugriffe – mit Vorschau und Versand per E-Mail."
      />

      <div role="radiogroup" aria-label="Bericht" className="grid gap-3 md:grid-cols-3">
        {(types.data ?? []).map((t) => (
          <TypeCard key={t.type} info={t} selected={t.type === type} onSelect={() => setType(t.type)} />
        ))}
        {types.isLoading && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-32" />)}
      </div>

      <Card className="mt-4">
        <CardContent className="flex flex-wrap items-end gap-x-4 gap-y-3 pt-5">
          {type === 'soll-ist' ? (
            <Field label="Stand" htmlFor="rp-to" hint="Letztes Audit bis zu diesem Tag" className="w-full sm:w-44">
              <Input id="rp-to" type="date" value={to} max={isoDate(new Date())} onChange={(e) => { setTo(e.target.value); setPreset('') }} />
            </Field>
          ) : (
            <>
              <Field label="Von" htmlFor="rp-from" className="w-[calc(50%-0.5rem)] sm:w-44">
                <Input id="rp-from" type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPreset('') }} aria-invalid={rangeInvalid || undefined} />
              </Field>
              <Field label="Bis" htmlFor="rp-to" className="w-[calc(50%-0.5rem)] sm:w-44">
                <Input id="rp-to" type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); setPreset('') }} aria-invalid={rangeInvalid || undefined} />
              </Field>
              <div className="grid gap-1.5">
                <span className="text-[13px] font-medium">Zeitraum</span>
                <Segmented
                  aria-label="Zeitraum wählen"
                  value={preset}
                  onValueChange={(v) => {
                    const p = presets.find((x) => x.value === v)!
                    setPreset(v)
                    setFrom(p.from())
                    setTo(isoDate(new Date()))
                  }}
                  options={presets.map((p) => ({ value: p.value, label: p.label }))}
                />
              </div>
            </>
          )}
          <div className="flex w-full flex-wrap items-center gap-2 lg:ml-auto lg:w-auto">
            <Tooltip content="Vorschau neu erzeugen">
              <Button type="button" variant="outline" size="icon" aria-label="Vorschau aktualisieren" onClick={() => setVersion((v) => v + 1)} disabled={rangeInvalid}>
                <RefreshCw />
              </Button>
            </Tooltip>
            <Button asChild variant="outline" className={cn(rangeInvalid && 'pointer-events-none opacity-50')}>
              <a aria-disabled={rangeInvalid || undefined} href={api.reports.url(type, { ...params, format: 'html' })} target="_blank" rel="noopener">
                <ExternalLink /> Im Browser öffnen
              </a>
            </Button>
            <Button asChild className={cn(rangeInvalid && 'pointer-events-none opacity-50')}>
              <a aria-disabled={rangeInvalid || undefined} href={pdfUrl} download data-testid="report-pdf">
                <Download /> PDF herunterladen
              </a>
            </Button>
          </div>
          {rangeInvalid && <p className="w-full text-xs text-destructive">Das Enddatum muss nach dem Anfangsdatum liegen.</p>}
        </CardContent>
      </Card>

      <section aria-label="Vorschau" className="mt-4 overflow-hidden rounded-xl border bg-muted/40">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-4 py-2.5 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-2">
            <span className="font-medium text-foreground">Vorschau</span>
            <span className="truncate">{typeTitles[type]}{info?.basis ? ` · Grundlage: ${info.basis}` : ''}</span>
          </span>
          <span>Das PDF enthält Deckblatt, Seitenzahlen und dieselben Inhalte.</span>
        </div>
        <div className="relative">
          {previewUrl ? (
            <iframe
              key={previewUrl}
              title={`Vorschau: ${typeTitles[type]}`}
              src={previewUrl}
              sandbox=""
              className="block h-[75vh] min-h-[480px] w-full bg-[#e5e7eb]"
              onLoad={() => setLoading(false)}
            />
          ) : (
            <div className="grid h-64 place-content-center text-sm text-muted-foreground">Bitte einen gültigen Zeitraum wählen.</div>
          )}
          {loading && previewUrl && (
            <div className="absolute inset-0 grid place-content-center bg-muted/60 text-sm text-muted-foreground backdrop-blur-[1px]">
              <span className="flex items-center gap-2"><RefreshCw className="size-4 animate-spin" /> Bericht wird erstellt …</span>
            </div>
          )}
        </div>
      </section>

      {isAdmin && <Schedules types={types.data ?? []} />}
    </Page>
  )
}

function TypeCard({ info, selected, onSelect }: { info: ReportTypeInfo; selected: boolean; onSelect: () => void }) {
  const missing = !info.needsRange && !info.basis
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 text-left shadow-xs transition-all outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'border-primary/50 ring-1 ring-primary/30',
      )}
    >
      <span className="flex items-center gap-3">
        <span className={cn('grid size-9 shrink-0 place-content-center rounded-lg [&_svg]:size-[18px]', typeTones[info.type])}>{typeIcons[info.type]}</span>
        <span className="min-w-0 text-sm font-semibold">{info.title}</span>
        <span className={cn('ml-auto grid size-4 shrink-0 place-content-center rounded-full border', selected ? 'border-primary bg-primary' : 'border-input')}>
          {selected && <span className="size-1.5 rounded-full bg-primary-foreground" />}
        </span>
      </span>
      <span className="text-xs text-muted-foreground">{info.description}</span>
      <span className="mt-auto text-xs">
        {info.needsRange ? (
          <span className="text-muted-foreground">Zeitraum frei wählbar</span>
        ) : missing ? (
          <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300"><AlertTriangle className="size-3.5" /> Noch keine Daten – zuerst {info.type === 'soll-ist' ? 'ein Audit' : 'eine Überwachung'} starten</span>
        ) : (
          <span className="text-muted-foreground">Grundlage: {info.basis}{info.basisAt ? ` vom ${formatDateTime(info.basisAt)}` : ''}</span>
        )}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------- scheduled delivery (Admin)

const weekdays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const schedulesKey = ['reports', 'schedules'] as const
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+$/

function describe(s: Pick<ReportSchedule, 'frequency' | 'day' | 'time'>) {
  return s.frequency === 'Weekly' ? `Jeden ${weekdays[s.day] ?? '?'} um ${s.time} Uhr · letzte 7 Tage` : `Monatlich am ${s.day}. um ${s.time} Uhr · letzter Monat`
}

function toInput(s: ReportSchedule): ReportScheduleInput {
  return { id: s.id, name: s.name, type: s.type, frequency: s.frequency, day: s.day, time: s.time, recipients: s.recipients, enabled: s.enabled, domainId: s.domainId ?? null }
}

function Schedules({ types }: { types: ReportTypeInfo[] }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const q = useQuery({ queryKey: schedulesKey, queryFn: api.reports.schedules })
  const smtp = useQuery({ queryKey: ['notifications', 'smtp'], queryFn: api.notifications.smtp })
  const [editing, setEditing] = React.useState<ReportSchedule | 'new' | null>(null)
  const list = q.data ?? []

  const save = useMutation({
    mutationFn: (next: ReportScheduleInput[]) => api.reports.updateSchedules(next),
    meta: { silent: true },
    onSuccess: (data) => {
      qc.setQueryData(schedulesKey, data)
    },
    onError: (e) => toast.error('Nicht gespeichert', { description: errorMessage(e) }),
  })
  const send = useMutation({
    mutationFn: (s: ReportSchedule) => api.reports.sendSchedule(s.id),
    meta: { silent: true },
    onSuccess: (_d, s) => toast.success('Bericht gesendet', { description: `„${s.name}“ an ${s.recipients.join(', ')}` }),
    onError: (e) => toast.error('Bericht nicht gesendet', { description: e instanceof ApiError ? (e.detail || e.title) : errorMessage(e), duration: 10_000 }),
  })

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2"><CalendarClock className="size-4 text-muted-foreground" /> Versand per E-Mail</CardTitle>
          <CardDescription>Berichte regelmäßig als PDF-Anhang an Postfächer senden (Uhrzeit des Servers, SMTP aus „Benachrichtigungen“).</CardDescription>
        </div>
        <Button type="button" variant="outline" onClick={() => setEditing('new')}><Plus /> Zeitplan hinzufügen</Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        {smtp.data && !smtp.data.host.trim() && (
          <p className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="size-3.5 shrink-0" /> Es ist kein SMTP-Server eingerichtet – Berichte können erst nach der Einrichtung unter „Benachrichtigungen“ versendet werden.
          </p>
        )}
        {q.isLoading ? (
          <Skeleton className="h-20" />
        ) : list.length === 0 ? (
          <EmptyState icon={<Mail />} title="Kein Zeitplan" description="Zum Beispiel jeden Montag die Änderungen der letzten Woche an das Sicherheitsteam." />
        ) : (
          <ul className="grid gap-2">
            {list.map((s) => (
              <li key={s.id} className={cn('flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-2 rounded-lg border px-3.5 py-3', !s.enabled && 'bg-muted/30')}>
                <span className={cn('grid size-9 shrink-0 place-content-center rounded-lg [&_svg]:size-[18px]', s.enabled ? typeTones[s.type] : 'bg-muted text-muted-foreground')}>{typeIcons[s.type]}</span>
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                    {s.name}
                    <Badge variant="outline">{typeTitles[s.type]}</Badge>
                    {!s.enabled && <Badge variant="muted">Pausiert</Badge>}
                    <ScheduleDomainBadge id={s.domainId} />
                  </span>
                  <span className="text-xs text-muted-foreground">{describe(s)}</span>
                  <span className="truncate text-xs text-muted-foreground" title={s.recipients.join(', ')}>An {s.recipients.join(', ')}</span>
                </div>
                <div className="order-last grid w-full gap-0.5 pl-[3.25rem] text-xs text-muted-foreground sm:order-none sm:w-auto sm:pl-0 sm:text-right">
                  {s.lastError ? (
                    <Tooltip content={s.lastError}>
                      <span className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400"><XCircle className="size-3.5" /> Letzter Versand fehlgeschlagen</span>
                    </Tooltip>
                  ) : s.lastSentAt ? (
                    <span className="flex items-center gap-1.5"><CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" /> Zuletzt {formatRelative(s.lastSentAt)}</span>
                  ) : null}
                  {s.nextRunAt && <span>Nächster Versand {formatDateTime(s.nextRunAt)}</span>}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label={`Aktionen für ${s.name}`}><MoreHorizontal /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing(s)}><Pencil /> Bearbeiten</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => send.mutate(s)}><Send /> Jetzt senden</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => save.mutate(list.map((x) => (x.id === s.id ? { ...toInput(x), enabled: !x.enabled } : toInput(x))))}>
                      {s.enabled ? 'Pausieren' : 'Fortsetzen'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      destructive
                      onSelect={async () => {
                        if (await confirm({ title: `Zeitplan „${s.name}“ löschen?`, description: 'Der Bericht wird dann nicht mehr automatisch versendet.', confirmText: 'Löschen', destructive: true }))
                          save.mutate(list.filter((x) => x.id !== s.id).map(toInput), { onSuccess: () => toast.success(`Zeitplan „${s.name}“ gelöscht`) })
                      }}
                    >
                      <Trash2 /> Löschen
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ScheduleSheet
        value={editing}
        types={types}
        pending={save.isPending}
        onClose={() => setEditing(null)}
        onSave={(input) => {
          const next = editing === 'new' ? [...list.map(toInput), input] : list.map((x) => (x.id === input.id ? input : toInput(x)))
          save.mutate(next, {
            onSuccess: () => {
              toast.success(editing === 'new' ? `Zeitplan „${input.name}“ angelegt` : 'Änderungen gespeichert')
              setEditing(null)
            },
          })
        }}
      />
    </Card>
  )
}

function ScheduleSheet({
  value,
  types,
  pending,
  onClose,
  onSave,
}: {
  value: ReportSchedule | 'new' | null
  types: ReportTypeInfo[]
  pending: boolean
  onClose: () => void
  onSave: (s: ReportScheduleInput) => void
}) {
  const isNew = value === 'new'
  const [form, setForm] = React.useState<ReportScheduleInput>({ name: '', type: 'aenderungen', frequency: 'Weekly', day: 1, time: '07:00', recipients: [], enabled: true })
  const [touched, setTouched] = React.useState(false)
  React.useEffect(() => {
    if (!value) return
    setForm(value === 'new' ? { name: '', type: 'aenderungen', frequency: 'Weekly', day: 1, time: '07:00', recipients: [], enabled: true } : toInput(value))
    setTouched(false)
  }, [value])

  const errors = {
    name: !form.name.trim() ? 'Name angeben.' : undefined,
    recipients: form.recipients.length === 0 ? 'Mindestens einen Empfänger angeben.' : undefined,
    time: !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.time) ? 'Uhrzeit angeben.' : undefined,
  }
  const hasError = Object.values(errors).some(Boolean)
  const dayOptions =
    form.frequency === 'Weekly'
      ? [1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: String(d), label: weekdays[d] }))
      : Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}. des Monats` }))
  const typeOptions = (types.length ? types.map((t) => t.type) : (Object.keys(typeTitles) as ReportType[])).map((t) => ({ value: t, label: typeTitles[t] }))

  return (
    <Sheet open={!!value} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <form
          className="flex h-full flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            setTouched(true)
            if (!hasError) onSave({ ...form, name: form.name.trim() })
          }}
        >
          <SheetHeader>
            <SheetTitle>{isNew ? 'Zeitplan hinzufügen' : `„${(value as ReportSchedule | null)?.name ?? ''}“ bearbeiten`}</SheetTitle>
            <SheetDescription>Welcher Bericht wann an wen geht. Der Zeitraum ergibt sich aus der Häufigkeit.</SheetDescription>
          </SheetHeader>
          <SheetBody className="grid content-start gap-5">
            <Field label="Name" htmlFor="rs-name" required error={touched ? errors.name : undefined}>
              <Input id="rs-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="z. B. Wochenbericht Sicherheit" autoComplete="off" autoFocus={isNew} />
            </Field>
            <Field label="Bericht" htmlFor="rs-type">
              <Combobox id="rs-type" value={form.type} onChange={(v) => setForm({ ...form, type: v as ReportType })} options={typeOptions} allowCustom={false} hideValue searchPlaceholder="Bericht suchen …" />
            </Field>
            <ScheduleDomainField value={form.domainId ?? null} onChange={(v) => setForm({ ...form, domainId: v })} />
            <div className="grid gap-1.5">
              <p className="text-[13px] font-medium">Häufigkeit</p>
              <Segmented<ReportFrequency>
                aria-label="Häufigkeit"
                value={form.frequency}
                onValueChange={(f) => setForm({ ...form, frequency: f, day: f === 'Weekly' ? 1 : 1 })}
                options={[
                  { value: 'Weekly', label: 'Wöchentlich' },
                  { value: 'Monthly', label: 'Monatlich' },
                ]}
              />
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
              <Field label={form.frequency === 'Weekly' ? 'Wochentag' : 'Tag'} htmlFor="rs-day">
                <Combobox id="rs-day" value={String(form.day)} onChange={(v) => setForm({ ...form, day: Number(v) })} options={dayOptions} allowCustom={false} hideValue searchPlaceholder="Suchen …" />
              </Field>
              <Field label="Uhrzeit" htmlFor="rs-time" error={touched ? errors.time : undefined}>
                <Input id="rs-time" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
              </Field>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">{describe(form)}</p>
            <Field label="Empfänger" htmlFor="rs-to" required error={touched ? errors.recipients : undefined} hint="Adressen eingeben und mit Enter übernehmen.">
              <MultiCombobox
                id="rs-to"
                values={form.recipients}
                onChange={(v) => setForm({ ...form, recipients: v })}
                options={[]}
                mono
                placeholder="secops@contoso.com"
                emptyText="Adresse eingeben und mit Enter übernehmen"
                validateCustom={(v) => (EMAIL_RE.test(v) ? null : `„${v}“ ist keine gültige E-Mail-Adresse`)}
                invalid={touched && !!errors.recipients}
              />
            </Field>
            <label htmlFor="rs-enabled" className="flex items-center justify-between gap-4 rounded-lg border px-3.5 py-3">
              <span className="grid">
                <span className="text-[13px] font-medium">Aktiv</span>
                <span className="text-xs text-muted-foreground">Pausierte Zeitpläne senden nichts.</span>
              </span>
              <Switch id="rs-enabled" checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
            </label>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={onClose}>Abbrechen</Button>
            <Button type="submit" loading={pending}>{isNew ? <><Plus /> Anlegen</> : 'Speichern'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

/** Domain a scheduled report covers (roadmap 17); only when several domains exist. */
function ScheduleDomainField({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const { domains } = useDomains()
  if (domains.length < 2) return null
  const options = [{ value: '', label: 'Standard-Domäne' }, ...domains.map((d) => ({ value: String(d.id), label: d.displayName, hint: d.dnsName || d.key }))]
  return (
    <Field label="Domäne" htmlFor="rs-domain" hint="Der Bericht zeigt Audits, Läufe und Überwachung dieser Domäne.">
      <Combobox id="rs-domain" value={value === null ? '' : String(value)} onChange={(v) => onChange(v ? Number(v) : null)} options={options} allowCustom={false} hideValue placeholder="Standard-Domäne" searchPlaceholder="Domäne suchen …" />
    </Field>
  )
}

function ScheduleDomainBadge({ id }: { id: number | null | undefined }) {
  const { domains, byId } = useDomains()
  if (domains.length < 2) return null
  const d = id ? byId(id) : domains.find((x) => x.isDefault)
  return d ? <Badge variant="muted">{d.displayName}</Badge> : null
}
