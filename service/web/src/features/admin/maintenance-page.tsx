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
import { MultiCombobox } from '@/components/ui/multi-combobox'
import { useDomains } from '@/features/domains/domain-context'
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
import { t } from '@/i18n'

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
        title={t('admin.maintenance.maintenanceWindows')}
        description={t('admin.maintenance.whenChangesMayBeApplied')}
        actions={
          <>
            <Button variant="outline" onClick={() => setFreezeEdit('new')}><Snowflake /> {t('admin.maintenance.createChangeFreeze')}</Button>
            <Button onClick={() => setWindowEdit('new')}><CalendarPlus /> {t('admin.maintenance.createWindow')}</Button>
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
                ? t('admin.maintenance.changeFreezeReasonActive', { reason: s.activeFreeze.reason })
                : s.allowedNow
                  ? s.currentWindow ? t('admin.maintenance.maintenanceWindowNameIsOpen', { name: s.currentWindow.name }) : t('admin.maintenance.applyIsPossibleAtAny')
                  : t('admin.maintenance.currentlyOutsideTheMaintenanceWindows')}
            </p>
            <p className="text-[13px] text-muted-foreground">
              {s.activeFreeze ? (
                <>{s.nextStart
                  ? t('admin.maintenance.freezeUntilNext', { to: formatDateTime(s.activeFreeze.to), rel: formatRelative(s.activeFreeze.to), next: formatDateTime(s.nextStart) })
                  : t('admin.maintenance.freezeUntil', { to: formatDateTime(s.activeFreeze.to), rel: formatRelative(s.activeFreeze.to) })}</>
              ) : s.allowedNow ? (
                s.currentWindow ? <>{t('admin.maintenance.windowOpenUntil', { end: formatDateTime(s.currentWindow.end) })}</> : hasWindows
                  ? t('admin.maintenance.allMaintenanceWindowsAreDisabled')
                  : t('admin.maintenance.asLongAsNoMaintenance')
              ) : (
                <>{t('admin.maintenance.newRunsScheduled')} {s.nextStart ? <strong className="text-foreground">{formatDateTime(s.nextStart)}</strong> : t('admin.maintenance.inTheNextWindow')}.</>
              )}
            </p>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-px size-3.5 shrink-0" />
              {t('admin.maintenance.planRunsAuditsAndMonitoring')}
            </p>
          </div>
        </div>
        <div className="grid content-start gap-2 text-[13px] md:min-w-64">
          {s.restricted && s.upcoming.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">{t('admin.maintenance.upcomingWindows')}</p>
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
              <CalendarClock className="size-3.5" /> {t('admin.maintenance.scheduledRuns', { count: s.scheduledRuns })}
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
    onSuccess: (w) => { toast.success(w.enabled ? t('admin.maintenance.nameEnabled', { name: w.name }) : t('admin.maintenance.nameDisabled', { name: w.name })); invalidate() },
  })
  const remove = useMutation({
    mutationFn: (w: MaintenanceWindow) => opsApi.maintenance.removeWindow(w.id),
    onSuccess: () => { toast.success(t('admin.maintenance.maintenanceWindowDeleted')); invalidate() },
  })

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CalendarRange className="size-4 text-muted-foreground" />
          <CardTitle>{t('admin.maintenance.maintenanceWindows')}</CardTitle>
        </div>
        <CardDescription>{t('admin.maintenance.recurringPeriodsInWhichApply')}</CardDescription>
      </CardHeader>
      {windows.length === 0 ? (
        <EmptyState
          compact
          icon={<CalendarRange />}
          title={t('admin.maintenance.noMaintenanceWindows')}
          description={t('admin.maintenance.withoutMaintenanceWindowsApplyRuns')}
          action={<Button size="sm" onClick={() => onEdit('new')}><CalendarPlus /> {t('admin.maintenance.createWindow')}</Button>}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{t('common.name')}</TH>
              <TH>{t('admin.maintenance.time')}</TH>
              <TH className="hidden md:table-cell">{t('admin.maintenance.timeZone')}</TH>
              <TH className="w-20">{t('common.active')}</TH>
              <TH className="w-10"><span className="sr-only">{t('common.actions')}</span></TH>
            </TR>
          </THead>
          <TBody>
            {windows.map((w) => (
              <TR key={w.id} className={cn(!w.enabled && 'text-muted-foreground')}>
                <TD>
                  <p className="font-medium text-foreground">{w.name}</p>
                  <DomainScopeBadges ids={w.domainIds} />
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
                  <Switch checked={w.enabled} onCheckedChange={() => toggle.mutate(w)} aria-label={t('common.nameActive', { name: w.name })} />
                </TD>
                <TD>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-xs" aria-label={t('admin.maintenance.actionsForName', { name: w.name })}><MoreHorizontal /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onEdit(w)}><Pencil /> {t('common.edit')}</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        destructive
                        onSelect={async () => {
                          if (await confirm({ title: t('admin.maintenance.deleteMaintenanceWindowName', { name: w.name }), description: t('admin.maintenance.scheduledRunsAreMovedTo'), confirmText: t('common.delete'), destructive: true }))
                            remove.mutate(w)
                        }}
                      >
                        <Trash2 /> {t('common.delete')}
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
  if (!f.enabled) return <Badge variant="muted">{t('admin.maintenance.disabled')}</Badge>
  if (f.active) return <Badge variant="danger"><OctagonX /> {t('common.active')}</Badge>
  if (f.past) return <Badge variant="outline">{t('admin.maintenance.past')}</Badge>
  return <Badge variant="info"><CalendarClock /> {t('admin.maintenance.upcoming')}</Badge>
}

function FreezesCard({ freezes, onEdit }: { freezes: FreezePeriod[]; onEdit: (f: FreezePeriod | 'new') => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['maintenance'] })
  const toggle = useMutation({
    mutationFn: (f: FreezePeriod) => opsApi.maintenance.updateFreeze(f.id, { from: f.from, to: f.to, reason: f.reason, enabled: !f.enabled }),
    onSuccess: (f) => { toast.success(f.enabled ? t('admin.maintenance.changeFreezeReasonEnabled', { reason: f.reason }) : t('admin.maintenance.changeFreezeReasonDisabled', { reason: f.reason })); invalidate() },
  })
  const remove = useMutation({
    mutationFn: (f: FreezePeriod) => opsApi.maintenance.removeFreeze(f.id),
    onSuccess: () => { toast.success(t('admin.maintenance.changeFreezeDeleted')); invalidate() },
  })

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Snowflake className="size-4 text-muted-foreground" />
          <CardTitle>{t('admin.maintenance.changeFreezes')}</CardTitle>
        </div>
        <CardDescription>{t('admin.maintenance.periodsWithoutChangesEG')}</CardDescription>
      </CardHeader>
      {freezes.length === 0 ? (
        <EmptyState compact icon={<Snowflake />} title={t('admin.maintenance.noChangeFreezes')} action={<Button size="sm" variant="outline" onClick={() => onEdit('new')}><Snowflake /> {t('admin.maintenance.createChangeFreeze')}</Button>} />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{t('admin.maintenance.reason')}</TH>
              <TH>{t('admin.maintenance.period')}</TH>
              <TH className="hidden sm:table-cell">{t('common.status')}</TH>
              <TH className="w-20">{t('common.active')}</TH>
              <TH className="w-10"><span className="sr-only">{t('common.actions')}</span></TH>
            </TR>
          </THead>
          <TBody>
            {freezes.map((f) => (
              <TR key={f.id} className={cn((!f.enabled || f.past) && 'text-muted-foreground')}>
                <TD>
                  <p className="font-medium text-foreground">{f.reason}</p>
                  <p className="text-xs text-muted-foreground">{t('admin.maintenance.createdBy', { by: f.createdBy })}</p>
                  <DomainScopeBadges ids={f.domainIds} />
                </TD>
                <TD className="text-[13px]">
                  <p>{formatDateTime(f.from)}</p>
                  <p className="text-xs text-muted-foreground">{t('admin.maintenance.until', { to: formatDateTime(f.to) })}</p>
                </TD>
                <TD className="hidden sm:table-cell"><FreezeState f={f} /></TD>
                <TD>
                  <Switch checked={f.enabled} onCheckedChange={() => toggle.mutate(f)} aria-label={t('admin.maintenance.changeFreezeReasonActive2', { reason: f.reason })} />
                </TD>
                <TD>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-xs" aria-label={t('admin.maintenance.actionsForReason', { reason: f.reason })}><MoreHorizontal /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onEdit(f)}><Pencil /> {t('common.edit')}</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        destructive
                        onSelect={async () => {
                          if (await confirm({ title: t('admin.maintenance.deleteChangeFreezeReason', { reason: f.reason }), confirmText: t('common.delete'), destructive: true })) remove.mutate(f)
                        }}
                      >
                        <Trash2 /> {t('common.delete')}
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

const defaultWindow = (): MaintenanceWindowInput => ({ name: '', days: [1, 2, 3, 4, 5], from: '22:00', to: '04:00', timeZone: 'Europe/Berlin', enabled: true, domainIds: [] })

function WindowSheet({ value, onClose }: { value: MaintenanceWindow | 'new' | null; onClose: () => void }) {
  const open = value !== null
  const isNew = value === 'new'
  const [form, setForm] = React.useState<MaintenanceWindowInput>(defaultWindow)
  const tzOptions = React.useMemo(() => timeZones().map((z) => ({ value: z })), [])
  const qc = useQueryClient()

  React.useEffect(() => {
    if (!value) return
    setForm(value === 'new' ? defaultWindow() : { name: value.name, days: value.days, from: value.from, to: value.to, timeZone: value.timeZone, enabled: value.enabled, domainIds: value.domainIds ?? [] })
  }, [value])

  const toggleDay = (d: number) => setForm((f) => ({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d] }))
  const error = !form.name.trim() ? t('admin.maintenance.nameIsRequired') : !form.days.length ? t('admin.maintenance.selectAtLeastOneWeekday') : !/^\d{2}:\d{2}$/.test(form.from) || !/^\d{2}:\d{2}$/.test(form.to) ? t('admin.maintenance.enterTheTimes') : null

  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, name: form.name.trim() }
      return isNew ? opsApi.maintenance.createWindow(body) : opsApi.maintenance.updateWindow((value as MaintenanceWindow).id, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance'] })
      qc.invalidateQueries({ queryKey: ['runs'] })
      toast.success(isNew ? t('admin.maintenance.maintenanceWindowCreated') : t('admin.maintenance.maintenanceWindowSaved'))
      onClose()
    },
  })

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <form className="flex h-full flex-col" onSubmit={(e) => { e.preventDefault(); if (!error) save.mutate() }}>
          <SheetHeader>
            <SheetTitle>{isNew ? t('admin.maintenance.newMaintenanceWindow') : t('admin.maintenance.editMaintenanceWindow')}</SheetTitle>
            <SheetDescription>{t('admin.maintenance.applyRunsOnlyStartWithin')}</SheetDescription>
          </SheetHeader>
          <SheetBody className="grid content-start gap-6">
            <Field label={t('common.name')} htmlFor="mw-name" required>
              <Input id="mw-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('admin.maintenance.eGWeekdayNightWindow')} autoFocus maxLength={100} />
            </Field>
            <div className="grid gap-2">
              <p className="text-[13px] font-medium">{t('admin.maintenance.weekdays')} <span className="text-destructive" aria-hidden>*</span></p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('admin.maintenance.weekdays')}>
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
              <Field label={t('admin.maintenance.from')} htmlFor="mw-from" required>
                <Input id="mw-from" type="time" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
              </Field>
              <Field label={t('admin.maintenance.to')} htmlFor="mw-to" required>
                <Input id="mw-to" type="time" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
              </Field>
            </div>
            <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-[13px]">
              <CalendarClock className="mt-0.5 size-4 shrink-0 opacity-70" />
              <span>
                {form.days.length ? describeDays(form.days) : t('admin.maintenance.noDaySelected')}, {describeTimes(form.from, form.to)}
                <span className="text-muted-foreground"> ({form.timeZone})</span>
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('admin.maintenance.timeZone')} htmlFor="mw-tz" hint={t('admin.maintenance.daylightSavingTimeIsTaken')}>
                <Combobox id="mw-tz" value={form.timeZone} onChange={(v) => setForm({ ...form, timeZone: v })} options={tzOptions} allowCustom={false} searchPlaceholder={t('admin.maintenance.searchTimeZone')} />
              </Field>
              <Field label={t('common.status')} htmlFor="mw-enabled">
                <label htmlFor="mw-enabled" className="flex h-9 items-center gap-3 text-[13px]">
                  <Switch id="mw-enabled" checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
                  {form.enabled ? t('common.active') : t('admin.maintenance.disabled')}
                </label>
              </Field>
            </div>
            <DomainScopeField id="mw-domains" value={form.domainIds ?? []} onChange={(v) => setForm({ ...form, domainIds: v })} what={t('admin.maintenance.theWindow')} />
          </SheetBody>
          <SheetFooter>
            {error && <span className="mr-auto text-xs text-muted-foreground">{error}</span>}
            <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={!!error} loading={save.isPending}>{isNew ? t('admin.maintenance.create') : t('common.save')}</Button>
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
  return { reason: '', from: toLocalInput(start.toISOString()), to: toLocalInput(end.toISOString()), enabled: true, domainIds: [] as number[] }
}

function FreezeSheet({ value, onClose }: { value: FreezePeriod | 'new' | null; onClose: () => void }) {
  const open = value !== null
  const isNew = value === 'new'
  const [form, setForm] = React.useState(defaultFreeze)
  const qc = useQueryClient()

  React.useEffect(() => {
    if (!value) return
    setForm(value === 'new' ? defaultFreeze() : { reason: value.reason, from: toLocalInput(value.from), to: toLocalInput(value.to), enabled: value.enabled, domainIds: value.domainIds ?? [] })
  }, [value])

  const from = fromLocalInput(form.from)
  const to = fromLocalInput(form.to)
  const error = !form.reason.trim() ? t('admin.maintenance.reasonIsRequired') : !from || !to ? t('admin.maintenance.enterStartAndEnd') : to <= from ? t('admin.maintenance.theEndMustBeAfter') : null
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone

  const save = useMutation({
    mutationFn: () => {
      const body: FreezePeriodInput = { reason: form.reason.trim(), from: from!, to: to!, enabled: form.enabled, domainIds: form.domainIds }
      return isNew ? opsApi.maintenance.createFreeze(body) : opsApi.maintenance.updateFreeze((value as FreezePeriod).id, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance'] })
      qc.invalidateQueries({ queryKey: ['runs'] })
      toast.success(isNew ? t('admin.maintenance.changeFreezeCreated') : t('admin.maintenance.changeFreezeSaved'))
      onClose()
    },
  })

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <form className="flex h-full flex-col" onSubmit={(e) => { e.preventDefault(); if (!error) save.mutate() }}>
          <SheetHeader>
            <SheetTitle>{isNew ? t('admin.maintenance.newChangeFreeze') : t('admin.maintenance.editChangeFreeze')}</SheetTitle>
            <SheetDescription>{t('admin.maintenance.applyIsRejectedDuringA')}</SheetDescription>
          </SheetHeader>
          <SheetBody className="grid content-start gap-6">
            <Field label={t('admin.maintenance.reason')} htmlFor="fz-reason" required>
              <Input id="fz-reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder={t('admin.maintenance.eGYearEndClosing')} autoFocus maxLength={200} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('admin.maintenance.start')} htmlFor="fz-from" required>
                <Input id="fz-from" type="datetime-local" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
              </Field>
              <Field label={t('admin.maintenance.end')} htmlFor="fz-to" required>
                <Input id="fz-to" type="datetime-local" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
              </Field>
            </div>
            <p className="-mt-3 text-xs text-muted-foreground">{t('admin.maintenance.timesInYourZone', { zone })}</p>
            <Field label={t('common.status')} htmlFor="fz-enabled">
              <label htmlFor="fz-enabled" className="flex h-9 items-center gap-3 text-[13px]">
                <Switch id="fz-enabled" checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
                {form.enabled ? t('common.active') : t('admin.maintenance.disabled')}
              </label>
            </Field>
            <DomainScopeField id="fz-domains" value={form.domainIds} onChange={(v) => setForm({ ...form, domainIds: v })} what={t('admin.maintenance.theChangeFreeze')} />
          </SheetBody>
          <SheetFooter>
            {error && <span className="mr-auto text-xs text-muted-foreground">{error}</span>}
            <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={!!error} loading={save.isPending}>{isNew ? t('admin.maintenance.create') : t('common.save')}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

/** Domain restriction of a window or freeze (roadmap 17): only shown when several domains exist. */
function DomainScopeField({ id, value, onChange, what }: { id: string; value: number[]; onChange: (v: number[]) => void; what: string }) {
  const { domains } = useDomains()
  if (domains.length < 2) return null
  const options = domains.map((d) => ({ value: String(d.id), label: d.displayName, hint: d.dnsName || d.key }))
  return (
    <Field label={t('admin.maintenance.appliesToDomains')} htmlFor={id} hint={value.length === 0 ? t('admin.maintenance.leaveEmptyWhatAppliesTo', { what }) : t('admin.maintenance.whatOnlyAppliesToApply', { what })}>
      <MultiCombobox
        id={id}
        values={value.map(String)}
        onChange={(v) => onChange(v.map(Number))}
        options={options}
        allowCustom={false}
        placeholder={value.length === 0 ? t('admin.maintenance.allDomainsSelectADomain') : t('admin.maintenance.anotherDomain')}
        emptyText={t('admin.maintenance.noDomainFound')}
      />
    </Field>
  )
}

/** Names of the domains a window or freeze is limited to (nothing when it applies to all). */
function DomainScopeBadges({ ids }: { ids: number[] | undefined }) {
  const { byId, domains } = useDomains()
  if (!ids?.length || domains.length < 2) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {ids.map((id) => (
        <Badge key={id} variant="outline">{byId(id)?.displayName ?? t('admin.maintenance.domainId', { id })}</Badge>
      ))}
    </div>
  )
}
