import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Bell,
  CloudUpload,
  FileClock,
  Radio,
  CheckCircle2,
  Hourglass,
  KeySquare,
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
  ShieldUser,
  Timer,
  KeyRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/api/client'
import type {
  ChannelEvents,
  ChannelInput,
  ChannelType,
  LogAnalyticsInput,
  NotificationChannel,
  SmtpSecurity,
  SmtpSettings,
  SmtpUpdate,
  SyslogFormat,
  SyslogProtocol,
  SyslogSettings,
} from '@/api/types'
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
import { MultiCombobox } from '@/components/ui/multi-combobox'
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
import { t } from '@/i18n'

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
  Email: { label: t('admin.notifications.eMail'), icon: <Mail />, tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-300', targetLabel: t('admin.notifications.recipients') },
  Teams: { label: t('admin.notifications.microsoftTeams'), icon: <MessagesSquare />, tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-300', targetLabel: t('admin.notifications.webhookUrl') },
  Webhook: { label: t('admin.notifications.webhook'), icon: <Webhook />, tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300', targetLabel: t('admin.notifications.url') },
  Syslog: { label: t('admin.notifications.syslogSiem'), icon: <Radio />, tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', targetLabel: t('admin.notifications.server') },
  LogAnalytics: { label: t('admin.notifications.logAnalytics'), icon: <CloudUpload />, tone: 'bg-blue-500/10 text-blue-700 dark:text-blue-300', targetLabel: t('admin.notifications.dataCollectionEndpoint') },
}

const typeHints: Record<ChannelType, string> = {
  Email: t('admin.notifications.messageToMailboxesViaThe'),
  Teams: t('admin.notifications.cardInATeamsChannel'),
  Webhook: t('admin.notifications.jsonViaHttpPost'),
  Syslog: t('admin.notifications.cefOrRfc5424To'),
  LogAnalytics: t('admin.notifications.microsoftSentinelViaTheLogs'),
}

const isSiem = (tt: ChannelType) => tt === 'Syslog' || tt === 'LogAnalytics'

const eventMeta: { key: keyof ChannelEvents; label: string; description: string; icon: React.ReactNode }[] = [
  { key: 'drift', label: t('admin.notifications.drift'), description: t('admin.notifications.anAuditFoundDeviationsFrom'), icon: <ScanSearch /> },
  { key: 'failure', label: t('admin.notifications.error'), description: t('admin.notifications.aDeploymentOrAuditFailed'), icon: <XCircle /> },
  { key: 'apply', label: t('admin.notifications.applied'), description: t('admin.notifications.aDeploymentInApplyMode'), icon: <Rocket /> },
  { key: 'approval', label: t('admin.notifications.approval'), description: t('admin.notifications.aDeploymentIsWaitingFor'), icon: <Hourglass /> },
  { key: 'privileged', label: t('admin.notifications.privilegedGroups'), description: t('admin.notifications.monitoringFoundNewOrRemoved'), icon: <ShieldUser /> },
  { key: 'jitRequested', label: t('admin.notifications.justInTimeAccessRequested'), description: t('admin.notifications.someoneRequestsATimeLimited'), icon: <Timer /> },
  { key: 'jitGranted', label: t('admin.notifications.justInTimeAccessGranted'), description: t('admin.notifications.aTimeLimitedMembershipWas'), icon: <KeyRound /> },
  { key: 'certificate', label: t('admin.notifications.certificate'), description: t('admin.notifications.theServiceSHttpsCertificate'), icon: <KeySquare /> },
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
        title={t('admin.notifications.notifications')}
        description={t('admin.notifications.eMailMicrosoftTeamsWebhooks')}
        actions={<Button onClick={() => setEditing('new')}><Plus /> {t('admin.notifications.addChannel')}</Button>}
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-label={t('admin.notifications.channels')} className="grid gap-3">
          {q.isLoading ? (
            Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-36" />)
          ) : !q.data?.length ? (
            <Card>
              <EmptyState
                icon={<Bell />}
                title={t('admin.notifications.noChannelsYet')}
                description={t('admin.notifications.createAChannelToBe')}
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
                    <div><Button onClick={() => setEditing('new')}><Plus /> {t('admin.notifications.createFirstChannel')}</Button></div>
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
      toast.success(u.enabled ? t('admin.notifications.nameEnabled', { name: u.name }) : t('admin.notifications.nameDisabled', { name: u.name }))
      invalidate()
    },
  })
  const test = useMutation({
    mutationFn: () => api.notifications.testChannel(c.id),
    meta: { silent: true },
    onSuccess: () => toast.success(t('admin.notifications.testMessageDelivered'), { description: t('admin.notifications.channelNameLabel', { name: c.name, label: meta.label }) }),
    onError: (e) =>
      toast.error(t('admin.notifications.testMessageFailed'), {
        description: e instanceof ApiError ? (e.detail || e.title) : errorMessage(e),
        duration: 10_000,
      }),
    onSettled: invalidate,
  })
  const remove = useMutation({
    mutationFn: () => api.notifications.removeChannel(c.id),
    onSuccess: () => {
      toast.success(t('admin.notifications.channelNameDeleted', { name: c.name }))
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
            {!c.enabled && <Badge variant="muted">{t('admin.notifications.disabled')}</Badge>}
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
            ) : null}
            {c.forwardChangeLog && (
              <Tooltip content={t('admin.notifications.everyChangeLogEntryIs')}>
                <span className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs font-medium [&_svg]:size-3 [&_svg]:text-muted-foreground">
                  <FileClock />
                  {t('admin.notifications.changeLog')}
                </span>
              </Tooltip>
            )}
            {!active.length && !c.forwardChangeLog && <span className="text-xs text-muted-foreground">{t('admin.notifications.noEventsSelected')}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip content={c.enabled ? t('admin.notifications.disable') : t('admin.notifications.enable')}>
            <span className="mr-1 inline-flex">
              <Switch checked={c.enabled} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate(v)} aria-label={t('admin.notifications.channelNameActive', { name: c.name })} />
            </span>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={t('admin.notifications.actionsForName', { name: c.name })}><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}><Pencil /> {t('common.edit')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => test.mutate()}><Send /> {t('admin.notifications.sendTestMessage')}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                onSelect={async () => {
                  if (await confirm({ title: t('admin.notifications.deleteChannelName', { name: c.name }), description: t('admin.notifications.noMoreNotificationsWillBe'), confirmText: t('common.delete'), destructive: true }))
                    remove.mutate()
                }}
              >
                <Trash2 /> {t('common.delete')}
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
              <span className="truncate">{t('admin.notifications.lastError')} {c.lastError}</span>
            </span>
          </Tooltip>
        ) : c.lastSentAt ? (
          <span className="flex items-center gap-1.5" title={formatDateTime(c.lastSentAt)}>
            <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" /> {t('admin.notifications.lastSent')} {formatRelative(c.lastSentAt)}
          </span>
        ) : (
          <span>{t('admin.notifications.nothingSentYet')}</span>
        )}
        {c.lastError && c.lastSentAt && <span title={formatDateTime(c.lastSentAt)}>{t('admin.notifications.lastSuccess', { when: formatRelative(c.lastSentAt) })}</span>}
        {isSiem(c.type) && (c.droppedEvents ?? 0) > 0 && (
          <Tooltip content={t('admin.notifications.eventsThatCouldNotBe')}>
            <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="size-3.5" /> {t('admin.notifications.eventsDropped', { count: c.droppedEvents ?? 0 })}
            </span>
          </Tooltip>
        )}
        {c.type === 'Email' && smtpMissing && (
          <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-3.5" /> {t('admin.notifications.smtpServerNotConfigured')}
          </span>
        )}
        <Button variant="outline" size="xs" className="ml-auto" loading={test.isPending} onClick={() => test.mutate()}>
          {!test.isPending && <Send />} {t('admin.notifications.sendTestMessage')}
        </Button>
      </div>
    </Card>
  )
}

const emptyEvents: ChannelEvents = { drift: true, failure: true, apply: false, approval: false, certificate: true, privileged: true, jitRequested: true, jitGranted: true }

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+$/

function splitAddresses(v: string) {
  return v.split(/[,;]/).map((x) => x.trim()).filter(Boolean)
}

function targetError(type: ChannelType, target: string, required: boolean): string | null {
  const tt = target.trim()
  if (!tt) return required ? (type === 'Email' ? t('admin.notifications.enterAtLeastOneRecipient') : t('admin.notifications.urlRequired')) : null
  if (type === 'Email') {
    const bad = tt.split(/[,;]/).map((x) => x.trim()).filter(Boolean).find((x) => !/^[^\s@]+@[^\s@]+$/.test(x))
    return bad ? t('admin.notifications.badIsNotAValid', { bad }) : null
  }
  try {
    const u = new URL(tt)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return t('admin.notifications.theUrlMustStartWith')
    return null
  } catch {
    return t('admin.notifications.pleaseEnterACompleteUrl')
  }
}

const defaultSyslog: SyslogSettings = { host: '', port: 514, protocol: 'Udp', format: 'Cef', validateCertificate: true }
const defaultPorts: Record<SyslogProtocol, number> = { Udp: 514, Tcp: 514, Tls: 6514 }
type LaForm = Omit<LogAnalyticsInput, 'clientSecret'> & { clientSecret: string }

const emptyLa: LaForm = { tenantId: '', clientId: '', endpointUrl: '', dcrImmutableId: '', streamName: 'Custom-TierModel_CL', clientSecret: '' }

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HOST_RE = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})(?:\.[A-Za-z0-9-]{1,63})*$|^[0-9a-fA-F:.]+$/

function syslogErrors(s: SyslogSettings): Partial<Record<'host' | 'port', string>> {
  const e: Partial<Record<'host' | 'port', string>> = {}
  if (!s.host.trim()) e.host = t('admin.notifications.enterAServer')
  else if (!HOST_RE.test(s.host.trim())) e.host = t('admin.notifications.enterAValidHostName')
  if (!Number.isInteger(s.port) || s.port < 1 || s.port > 65535) e.port = '1–65535'
  return e
}

type LaField = 'tenantId' | 'clientId' | 'endpointUrl' | 'dcrImmutableId' | 'streamName' | 'clientSecret'

function laErrors(l: LaForm, secretRequired: boolean): Partial<Record<LaField, string>> {
  const e: Partial<Record<LaField, string>> = {}
  if (!GUID_RE.test(l.tenantId.trim())) e.tenantId = t('admin.notifications.enterTheTenantIdAs')
  if (!GUID_RE.test(l.clientId.trim())) e.clientId = t('admin.notifications.enterTheApplicationIdAs')
  try {
    const u = new URL(l.endpointUrl.trim())
    if (u.protocol !== 'https:') e.endpointUrl = t('admin.notifications.theAddressMustStartWith')
  } catch {
    e.endpointUrl = t('admin.notifications.enterTheCompleteAddressHttps')
  }
  if (!/^dcr-[0-9a-f]{32}$/i.test(l.dcrImmutableId.trim())) e.dcrImmutableId = t('admin.notifications.formatDcrFollowedBy32')
  if (!/^(Custom|Microsoft)-[A-Za-z0-9_]{1,100}$/.test(l.streamName.trim())) e.streamName = t('admin.notifications.formatCustomTableEG')
  if (secretRequired && !l.clientSecret) e.clientSecret = t('admin.notifications.enterTheClientSecret')
  return e
}

/** Server field names ("syslog.host", "logAnalytics.tenantId") → the form's keys. */
function serverFieldErrors(e: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (e instanceof ApiError && e.errors)
    for (const [k, v] of Object.entries(e.errors)) out[k.replace(/^(syslog|logAnalytics)\./i, '').replace(/^./, (c) => c.toLowerCase())] = v[0]
  return out
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
  const [syslog, setSyslog] = React.useState<SyslogSettings>(defaultSyslog)
  const [la, setLa] = React.useState<LaForm>(emptyLa)
  const [forwardChangeLog, setForwardChangeLog] = React.useState(false)
  const [serverErrors, setServerErrors] = React.useState<Record<string, string>>({})
  const [touched, setTouched] = React.useState(false)
  const allChannels = useQuery({ queryKey: channelsKey, queryFn: api.notifications.channels })
  const smtpData = useQuery({ queryKey: smtpKey, queryFn: api.notifications.smtp })
  // Addresses already used elsewhere, as suggestions.
  const addressOptions = React.useMemo(() => {
    const set = new Map<string, string>()
    for (const c of allChannels.data ?? [])
      if (c.type === 'Email') for (const a of splitAddresses(c.target)) if (!set.has(a.toLowerCase())) set.set(a.toLowerCase(), t('admin.notifications.channelName', { name: c.name }))
    const from = smtpData.data?.from?.trim()
    if (from && !set.has(from.toLowerCase())) set.set(from.toLowerCase(), 'Absenderadresse (SMTP)')
    return [...set.entries()].map(([value, hint]) => ({ value, hint, icon: <Mail className="size-4 text-muted-foreground" /> }))
  }, [allChannels.data, smtpData.data])

  React.useEffect(() => {
    if (!value) return
    setName(channel?.name ?? '')
    setType(channel?.type ?? 'Email')
    setEnabled(channel?.enabled ?? true)
    // Teams/Webhook URLs are never returned in full: the field stays empty unless a new URL is typed.
    setTarget(channel?.type === 'Email' ? channel.target : '')
    setEvents(channel?.events ?? emptyEvents)
    setSyslog(channel?.syslog ?? defaultSyslog)
    setLa(channel?.logAnalytics ? { ...channel.logAnalytics, clientSecret: '' } : emptyLa)
    setForwardChangeLog(channel?.forwardChangeLog ?? isNew)
    setServerErrors({})
    setTouched(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const siem = isSiem(type)
  const secretTarget = type !== 'Email' && !siem
  const typeChanged = !!channel && channel.type !== type
  // A kept URL is only meaningful for an unchanged Teams/Webhook channel.
  const keepsStoredUrl = !!channel && secretTarget && !typeChanged && !target.trim()
  const targetRequired = isNew || typeChanged || type === 'Email'
  const hasStoredSecret = !!channel && channel.type === 'LogAnalytics' && !typeChanged && !!channel.logAnalytics?.hasClientSecret
  const sErr = type === 'Syslog' ? syslogErrors(syslog) : {}
  const lErr = type === 'LogAnalytics' ? laErrors(la, !hasStoredSecret) : {}
  const fieldError = (k: string) => (touched ? ((sErr as Record<string, string>)[k] ?? (lErr as Record<string, string>)[k]) : undefined) ?? serverErrors[k]
  const tError = siem ? null : targetError(type, target, targetRequired)
  const error = !name.trim()
    ? t('admin.notifications.nameRequired')
    : siem
      ? (Object.values(sErr)[0] ?? Object.values(lErr)[0] ?? null)
      : tError

  const save = useMutation({
    mutationFn: () => {
      const body: ChannelInput = {
        name: name.trim(),
        type,
        enabled,
        target: siem ? null : keepsStoredUrl ? null : target.trim(),
        events,
      }
      if (type === 'Syslog') body.syslog = { ...syslog, host: syslog.host.trim() }
      if (type === 'LogAnalytics')
        body.logAnalytics = {
          tenantId: la.tenantId.trim(),
          clientId: la.clientId.trim(),
          endpointUrl: la.endpointUrl.trim(),
          dcrImmutableId: la.dcrImmutableId.trim(),
          streamName: la.streamName.trim(),
          clientSecret: la.clientSecret || null,
        }
      if (siem) body.forwardChangeLog = forwardChangeLog
      return isNew ? api.notifications.createChannel(body) : api.notifications.updateChannel(channel!.id, body)
    },
    meta: { silent: true },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: channelsKey })
      toast.success(isNew ? t('admin.notifications.channelNameCreated', { name: c.name }) : t('admin.notifications.changesSaved'), {
        description: isNew ? t('admin.notifications.useSendTestMessageTo') : undefined,
      })
      onClose()
    },
    onError: (e) => {
      const fields = serverFieldErrors(e)
      setServerErrors(fields)
      toast.error(t('admin.notifications.notSaved'), { description: Object.values(fields)[0] ?? errorMessage(e) })
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

  const setS = <K extends keyof SyslogSettings>(k: K, v: SyslogSettings[K]) => {
    setSyslog((s) => ({ ...s, [k]: v }))
    setServerErrors((e) => ({ ...e, [k]: '' }))
  }
  const setL = (k: LaField, v: string) => {
    setLa((s) => ({ ...s, [k]: v }))
    setServerErrors((e) => ({ ...e, [k]: '' }))
  }

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
            <SheetTitle>{isNew ? t('admin.notifications.addChannel') : t('admin.notifications.editName', { name: channel?.name })}</SheetTitle>
            <SheetDescription>{t('admin.notifications.whereToNotifyAndFor')}</SheetDescription>
          </SheetHeader>
          <SheetBody className="grid content-start gap-5">
            <Field label={t('common.name')} htmlFor="ch-name" required error={touched && !name.trim() ? t('admin.notifications.nameRequired') : undefined}>
              <Input id="ch-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('admin.notifications.eGTier0Team')} autoFocus={isNew} autoComplete="off" />
            </Field>
            <div className="grid gap-1.5">
              <p id="ch-type-label" className="text-[13px] font-medium">{t('admin.notifications.type')}</p>
              <div role="radiogroup" aria-labelledby="ch-type-label" className="grid grid-cols-2 gap-2">
                {(Object.keys(typeMeta) as ChannelType[]).map((tt) => (
                  <button
                    key={tt}
                    type="button"
                    role="radio"
                    aria-checked={type === tt}
                    onClick={() => {
                      setType(tt)
                      setTarget(channel && channel.type === tt && tt === 'Email' ? channel.target : '')
                      setServerErrors({})
                    }}
                    className={cn(
                      'flex min-w-0 items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-all outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring',
                      type === tt && 'border-primary/50 bg-primary/5 ring-1 ring-primary/30',
                    )}
                  >
                    <span className={cn('mt-0.5 grid size-7 shrink-0 place-content-center rounded-md [&_svg]:size-4', typeMeta[tt].tone)}>{typeMeta[tt].icon}</span>
                    <span className="grid min-w-0">
                      <span className="text-[13px] font-medium">{typeMeta[tt].label}</span>
                      <span className="text-[11.5px] leading-snug text-muted-foreground">{typeHints[tt]}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            {type === 'Syslog' ? (
              <div className="grid gap-4 rounded-lg border bg-muted/20 p-3.5">
                <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
                  <Field label={t('admin.notifications.server')} htmlFor="ch-sys-host" required error={fieldError('host')} hint={t('admin.notifications.hostNameOrIpAddress')}>
                    <Input id="ch-sys-host" value={syslog.host} onChange={(e) => setS('host', e.target.value)} placeholder="siem-collector.contoso.com" className="font-mono text-[13px]" autoComplete="off" spellCheck={false} aria-invalid={!!fieldError('host') || undefined} />
                  </Field>
                  <Field label={t('admin.notifications.port')} htmlFor="ch-sys-port" error={fieldError('port')}>
                    <Input id="ch-sys-port" type="number" min={1} max={65535} value={Number.isNaN(syslog.port) ? '' : syslog.port} onChange={(e) => setS('port', e.target.valueAsNumber)} aria-invalid={!!fieldError('port') || undefined} />
                  </Field>
                </div>
                <div className="grid gap-1.5">
                  <p className="text-[13px] font-medium">{t('admin.notifications.transport')}</p>
                  <Segmented<SyslogProtocol>
                    aria-label={t('admin.notifications.transport')}
                    value={syslog.protocol}
                    onValueChange={(p) => setSyslog((s) => ({ ...s, protocol: p, port: s.port === defaultPorts[s.protocol] || Number.isNaN(s.port) ? defaultPorts[p] : s.port }))}
                    options={[
                      { value: 'Udp', label: 'UDP' },
                      { value: 'Tcp', label: 'TCP' },
                      { value: 'Tls', label: t('admin.notifications.tcpTls') },
                    ]}
                  />
                  <p className="text-xs text-muted-foreground">
                    {syslog.protocol === 'Udp'
                      ? t('admin.notifications.fastButWithoutDeliveryConfirmation')
                      : syslog.protocol === 'Tcp'
                        ? t('admin.notifications.reliableDeliveryWithLengthPrefix')
                        : t('admin.notifications.encryptedAccordingToRfc5425')}
                  </p>
                </div>
                {syslog.protocol === 'Tls' && (
                  <label htmlFor="ch-sys-validate" className="flex items-center justify-between gap-4 rounded-lg border bg-card px-3 py-2.5">
                    <span className="grid">
                      <span className="text-[13px] font-medium">{t('admin.notifications.validateCertificate')}</span>
                      <span className="text-xs text-muted-foreground">{t('admin.notifications.onlyTurnOffForTest')}</span>
                    </span>
                    <Switch id="ch-sys-validate" checked={syslog.validateCertificate} onCheckedChange={(v) => setS('validateCertificate', v)} />
                  </label>
                )}
                <div className="grid gap-1.5">
                  <p className="text-[13px] font-medium">{t('admin.notifications.format')}</p>
                  <Segmented<SyslogFormat>
                    aria-label={t('admin.notifications.format')}
                    value={syslog.format}
                    onValueChange={(f) => setS('format', f)}
                    options={[
                      { value: 'Cef', label: 'CEF' },
                      { value: 'Rfc5424', label: t('admin.notifications.rfc5424') },
                    ]}
                  />
                  <p className="text-xs text-muted-foreground">
                    {syslog.format === 'Cef'
                      ? t('admin.notifications.commonEventFormatForMicrosoft')
                      : t('admin.notifications.structuredDataAccordingToRfc')}
                  </p>
                </div>
              </div>
            ) : type === 'LogAnalytics' ? (
              <div className="grid gap-4 rounded-lg border bg-muted/20 p-3.5">
                <p className="text-xs text-muted-foreground">
                  {t('admin.notifications.anAppRegistrationWithThe')}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t('admin.notifications.tenantId')} htmlFor="ch-la-tenant" required error={fieldError('tenantId')}>
                    <Input id="ch-la-tenant" value={la.tenantId} onChange={(e) => setL('tenantId', e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className="font-mono text-[12.5px]" autoComplete="off" spellCheck={false} aria-invalid={!!fieldError('tenantId') || undefined} />
                  </Field>
                  <Field label={t('admin.notifications.applicationIdClient')} htmlFor="ch-la-client" required error={fieldError('clientId')}>
                    <Input id="ch-la-client" value={la.clientId} onChange={(e) => setL('clientId', e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className="font-mono text-[12.5px]" autoComplete="off" spellCheck={false} aria-invalid={!!fieldError('clientId') || undefined} />
                  </Field>
                </div>
                <Field
                  label={t('admin.notifications.clientSecret')}
                  htmlFor="ch-la-secret"
                  required={!hasStoredSecret}
                  error={fieldError('clientSecret')}
                  hint={hasStoredSecret ? t('admin.notifications.aSecretIsSavedLeave') : t('admin.notifications.storedEncryptedAndNeverDisplayed')}
                >
                  <Input id="ch-la-secret" type="password" autoComplete="new-password" value={la.clientSecret} onChange={(e) => setL('clientSecret', e.target.value)} placeholder={hasStoredSecret ? t('admin.notifications.unchanged') : ''} aria-invalid={!!fieldError('clientSecret') || undefined} />
                </Field>
                <Field label={t('admin.notifications.dataCollectionEndpointDce')} htmlFor="ch-la-dce" required error={fieldError('endpointUrl')} hint={t('admin.notifications.logsIngestionUrlOfThe')}>
                  <Input id="ch-la-dce" value={la.endpointUrl} onChange={(e) => setL('endpointUrl', e.target.value)} placeholder="https://tiermodel-dce-abcd.westeurope-1.ingest.monitor.azure.com" className="font-mono text-[12.5px]" autoComplete="off" spellCheck={false} inputMode="url" aria-invalid={!!fieldError('endpointUrl') || undefined} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t('admin.notifications.immutableIdOfTheRule')} htmlFor="ch-la-dcr" required error={fieldError('dcrImmutableId')}>
                    <Input id="ch-la-dcr" value={la.dcrImmutableId} onChange={(e) => setL('dcrImmutableId', e.target.value)} placeholder="dcr-0123456789abcdef…" className="font-mono text-[12.5px]" autoComplete="off" spellCheck={false} aria-invalid={!!fieldError('dcrImmutableId') || undefined} />
                  </Field>
                  <Field label={t('admin.notifications.stream')} htmlFor="ch-la-stream" required error={fieldError('streamName')}>
                    <Input id="ch-la-stream" value={la.streamName} onChange={(e) => setL('streamName', e.target.value)} placeholder="Custom-TierModel_CL" className="font-mono text-[12.5px]" autoComplete="off" spellCheck={false} aria-invalid={!!fieldError('streamName') || undefined} />
                  </Field>
                </div>
              </div>
            ) : (
              <Field
                label={typeMeta[type].targetLabel}
                htmlFor="ch-target"
                required={targetRequired}
                error={touched || target ? tError ?? undefined : undefined}
                hint={
                  type === 'Email'
                    ? t('admin.notifications.enterAddressesOrPickSuggestions')
                    : channel && !typeChanged
                      ? t('admin.notifications.forSecurityReasonsTheSaved')
                      : type === 'Teams'
                        ? t('admin.notifications.webhookUrlOfATeams')
                        : t('admin.notifications.theServiceSendsAJson')
                }
              >
                {type === 'Email' ? (
                  <MultiCombobox
                    id="ch-target"
                    values={splitAddresses(target)}
                    onChange={(v) => setTarget(v.join(', '))}
                    options={addressOptions}
                    mono
                    placeholder="admin@contoso.com"
                    emptyText={t('admin.notifications.enterAnAddressAndConfirm')}
                    validateCustom={(v) => (EMAIL_RE.test(v) ? null : t('admin.notifications.vIsNotAValid', { v }))}
                    invalid={(touched || !!target) && !!tError}
                  />
                ) : (
                  <Input
                    id="ch-target"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    placeholder={placeholder}
                    className="font-mono text-[13px]"
                    autoComplete="off"
                    spellCheck={false}
                    inputMode="url"
                    aria-invalid={(touched || !!target) && !!tError ? true : undefined}
                  />
                )}
              </Field>
            )}
            <div className="grid gap-2">
              <p className="text-[13px] font-medium">{t('admin.notifications.events')}</p>
              {siem && (
                <p className="-mt-1 text-xs text-muted-foreground">
                  {t('admin.notifications.everyEventIsSentAs')}
                </p>
              )}
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
                {siem && (
                  <label
                    htmlFor="ch-ev-changelog"
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-accent/40',
                      forwardChangeLog && 'border-primary/40 bg-primary/[0.04]',
                    )}
                  >
                    <Checkbox id="ch-ev-changelog" checked={forwardChangeLog} onCheckedChange={(v) => setForwardChangeLog(v === true)} className="mt-0.5" />
                    <span className="grid">
                      <span className="flex items-center gap-1.5 text-[13px] font-medium [&_svg]:size-3.5 [&_svg]:text-muted-foreground"><FileClock />{t('admin.notifications.forwardChangeLog')}</span>
                      <span className="text-xs text-muted-foreground">
                        {t('admin.notifications.everyEntrySignInsUsers')}
                      </span>
                    </span>
                  </label>
                )}
              </div>
            </div>
            <label htmlFor="ch-enabled" className="flex items-center justify-between gap-4 rounded-lg border px-3.5 py-3">
              <span className="grid">
                <span className="text-[13px] font-medium">{t('admin.notifications.channelActive')}</span>
                <span className="text-xs text-muted-foreground">{t('admin.notifications.disabledChannelsReceiveNoNotifications')}</span>
              </span>
              <Switch id="ch-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </label>
          </SheetBody>
          <SheetFooter>
            {touched && error && <span className="mr-auto text-xs text-destructive">{error}</span>}
            <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" loading={save.isPending}>{isNew ? <><Plus /> {t('admin.notifications.create')}</> : t('common.save')}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

const securityOptions: { value: SmtpSecurity; label: string; description: string; port: number }[] = [
  { value: 'StartTls', label: t('admin.notifications.starttls'), description: t('admin.notifications.encryptionAfterConnectingUsuallyPort'), port: 587 },
  { value: 'SslOnConnect', label: t('admin.notifications.sslTls'), description: t('admin.notifications.encryptedConnectionFromTheStart'), port: 465 },
  { value: 'None', label: t('admin.notifications.none'), description: t('admin.notifications.unencryptedPort25InternalNetwork'), port: 25 },
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
      toast.success(t('admin.notifications.smtpSettingsSaved'))
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
            <CardTitle className="flex items-center gap-2"><Server className="size-4 text-muted-foreground" /> {t('admin.notifications.smtpServer')}</CardTitle>
            <CardDescription>{t('admin.notifications.forChannelsOfTypeE')}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
            <Field label={t('admin.notifications.server')} htmlFor="smtp-host">
              <Input id="smtp-host" className="font-mono text-[13px]" placeholder="smtp.contoso.com" value={form.host} onChange={(e) => set('host', e.target.value)} autoComplete="off" spellCheck={false} />
            </Field>
            <Field label={t('admin.notifications.port')} htmlFor="smtp-port" error={portInvalid ? '1–65535' : undefined}>
              <Input id="smtp-port" type="number" min={1} max={65535} value={Number.isNaN(form.port) ? '' : form.port} onChange={(e) => set('port', e.target.valueAsNumber)} aria-invalid={portInvalid || undefined} />
            </Field>
          </div>
          <Field label={t('admin.notifications.encryption')} htmlFor="smtp-sec">
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
          <Field label={t('admin.notifications.sender')} htmlFor="smtp-from" error={fromInvalid ? t('admin.notifications.senderAddressRequiredIfA') : undefined} hint={t('admin.notifications.eGTiermodelContosoCom')}>
            <Input id="smtp-from" className="font-mono text-[13px]" placeholder="tiermodel@contoso.com" value={form.from} onChange={(e) => set('from', e.target.value)} autoComplete="off" aria-invalid={fromInvalid || undefined} />
          </Field>
          <Field label={t('admin.notifications.userName')} htmlFor="smtp-user" hint={t('admin.notifications.leaveEmptyForAnonymousDelivery')}>
            <Input id="smtp-user" className="font-mono text-[13px]" value={form.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="smtp-pw" className="text-[13px] font-medium">{t('admin.notifications.password')}</label>
              {q.data.hasPassword && pwAction !== 'clear' && pwAction !== 'set' && (
                <Badge variant="success"><CheckCircle2 /> {t('admin.notifications.saved')}</Badge>
              )}
            </div>
            {pwAction === 'clear' ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-rose-500/40 bg-rose-500/5 px-3 py-1.5 text-[13px] text-rose-700 dark:text-rose-300">
                {t('admin.notifications.willBeRemovedOnSave')}
                <Button type="button" variant="ghost" size="xs" onClick={() => setPwAction('keep')}><Undo2 /> {t('admin.notifications.undo')}</Button>
              </div>
            ) : (
              <Input
                id="smtp-pw"
                type="password"
                autoComplete="new-password"
                value={password}
                placeholder={q.data.hasPassword ? t('admin.notifications.unchanged') : t('admin.notifications.noPasswordSaved')}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setPwAction(e.target.value ? 'set' : 'keep')
                }}
              />
            )}
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{t('admin.notifications.storedEncryptedAndNeverDisplayed2')}</p>
              {q.data.hasPassword && pwAction !== 'clear' && (
                <Button type="button" variant="link" size="xs" className="h-auto px-0 text-rose-600 dark:text-rose-400" onClick={() => { setPassword(''); setPwAction('clear') }}>
                  {t('admin.notifications.removePassword')}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="button" variant="ghost" disabled={!dirty} onClick={() => reset(q.data!)}>{t('common.reset')}</Button>
          <Button type="submit" disabled={!dirty || portInvalid || fromInvalid} loading={save.isPending}>{!save.isPending && <Save />} {t('common.save')}</Button>
        </CardFooter>
      </form>
    </Card>
  )
}
