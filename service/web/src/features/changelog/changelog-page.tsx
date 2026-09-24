import * as React from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  FileClock,
  KeyRound,
  CalendarClock,
  Settings2,
  SlidersHorizontal,
  User as UserIcon,
  ChevronDown,
  Bell,
  CalendarRange,
  KeySquare,
  ShieldCheck,
  ShieldAlert,
  Network,
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { useDomains } from '@/features/domains/domain-context'
import { opsApi } from '@/api/ops'
import { Badge } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/tooltip'
import { api } from '@/api/client'
import type { ChangeEntry } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { KeyValueList } from '@/components/shared/key-value-list'
import { Page, PageHeader } from '@/components/shared/page-header'
import { actionLabels, entityTypeLabels, sectionFallbackTitles } from '@/lib/labels'
import { cn, formatDateTime, formatNumber, formatRelative } from '@/lib/utils'
import { t } from '@/i18n'

const PAGE_SIZE = 50

const typeIcon: Record<string, React.ReactNode> = {
  config: <SlidersHorizontal />,
  run: <Activity />,
  user: <UserIcon />,
  schedule: <CalendarClock />,
  settings: <Settings2 />,
  notification: <Bell />,
  auth: <KeyRound />,
  maintenance: <CalendarRange />,
  token: <KeySquare />,
  domain: <Network />,
}

const typeTone: Record<string, string> = {
  config: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300',
  run: 'bg-sky-500/10 text-sky-600 dark:text-sky-300',
  user: 'bg-teal-500/10 text-teal-600 dark:text-teal-300',
  schedule: 'bg-violet-500/10 text-violet-600 dark:text-violet-300',
  settings: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  notification: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300',
  auth: 'bg-muted text-muted-foreground',
  maintenance: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  token: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
  domain: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
}

function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
}

export function Component() {
  const [params, setParams] = useSearchParams()
  const entityType = params.get('typ') ?? ''
  const { multiple, current } = useDomains()
  // Several domains: entries of the selected domain plus instance-wide ones (roadmap 17).
  const currentOnly = multiple && params.get('domaene') === 'aktuell'
  const [page, setPage] = React.useState(1)
  React.useEffect(() => setPage(1), [entityType, currentOnly])
  const q = useQuery({
    queryKey: ['changelog', { entityType, page, currentOnly }],
    queryFn: () => api.changelog.list({ entityType, page, pageSize: PAGE_SIZE, currentDomain: currentOnly }),
    placeholderData: keepPreviousData,
  })
  const items = q.data?.items ?? []
  const total = q.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const grouped = React.useMemo(() => {
    const m: [string, ChangeEntry[]][] = []
    for (const c of items) {
      const k = dayKey(c.at)
      const last = m[m.length - 1]
      if (last && last[0] === k) last[1].push(c)
      else m.push([k, [c]])
    }
    return m
  }, [items])

  return (
    <Page>
      <PageHeader
        icon={<FileClock />}
        title={t('changelog.changelog.changeLog')}
        description={t('changelog.changelog.whoChangedWhatAndWhen')}
        actions={<ChainBadge />}
      />
      {multiple && current && (
        <label htmlFor="cl-domain" className="mb-3 flex w-fit items-center gap-2.5 text-[13px]">
          <Switch
            id="cl-domain"
            checked={currentOnly}
            onCheckedChange={(v) => {
              const p = new URLSearchParams(params)
              if (v) p.set('domaene', 'aktuell')
              else p.delete('domaene')
              setParams(p, { replace: true })
            }}
          />
          <span>{t('changelog.changelog.onlyDomain')} {current.displayName} <span className="text-muted-foreground">{t('changelog.changelog.andCrossDomainEntries')}</span></span>
        </label>
      )}
      <div className="mb-4 overflow-x-auto">
        <Segmented<string>
          aria-label={t('changelog.changelog.type')}
          value={entityType || 'all'}
          onValueChange={(v) => {
            const p = new URLSearchParams(params)
            if (v === 'all') p.delete('typ')
            else p.set('typ', v)
            setParams(p, { replace: true })
          }}
          options={[{ value: 'all', label: t('changelog.changelog.all') }, ...Object.entries(entityTypeLabels).map(([value, label]) => ({ value, label }))]}
        />
      </div>
      {q.isLoading ? (
        <Card className="grid gap-3 p-5">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-12" />)}</Card>
      ) : items.length === 0 ? (
        <Card><EmptyState icon={<FileClock />} title={t('changelog.changelog.noEntries')} description={t('changelog.changelog.noChangesWereLoggedFor')} /></Card>
      ) : (
        <div className={cn('grid grid-cols-[minmax(0,1fr)] gap-6', q.isPlaceholderData && 'opacity-60')}>
          {grouped.map(([day, list]) => (
            <section key={day} className="min-w-0">
              <h2 className="mb-2 text-xs font-medium text-muted-foreground">{day}</h2>
              <Card className="divide-y overflow-hidden">
                {list.map((c) => <Entry key={c.id} c={c} />)}
              </Card>
            </section>
          ))}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{formatNumber(total)} {t('changelog.changelog.entries')}</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label={t('changelog.changelog.previousPage')}><ChevronLeft /></Button>
              <span className="tabular">{t('changelog.changelog.page')} {page} / {pages}</span>
              <Button variant="ghost" size="icon-xs" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label={t('changelog.changelog.nextPage')}><ChevronRight /></Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  )
}

/** Result of the hash-chain check (roadmap 23): every entry is chained to its predecessor. */
function ChainBadge() {
  const q = useQuery({ queryKey: ['changelog', 'chain'], queryFn: opsApi.changelog.chain, staleTime: 60_000 })
  const r = q.data
  if (!r) return null
  const detail = (
    <span className="grid gap-0.5">
      <span>{formatNumber(r.count)} {t('changelog.changelog.entriesChecked')} {formatDateTime(r.checkedAt)}</span>
      {r.ok ? <span>{t('changelog.changelog.everyEntryIsChainedTo')}</span> : <span>{r.problem}</span>}
      {r.lastHash && <span className="font-mono break-all">{t('changelog.changelog.endOfChain')} {r.lastHash}</span>}
    </span>
  )
  return (
    <Tooltip content={detail}>
      <span tabIndex={0} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="chain-badge">
        {r.ok ? (
          <Badge variant="success"><ShieldCheck /> {t('changelog.changelog.chainVerified')}</Badge>
        ) : (
          <Badge variant="danger"><ShieldAlert /> {t('changelog.changelog.chainBrokenAt')}{r.brokenAtId}</Badge>
        )}
      </span>
    </Tooltip>
  )
}

function Entry({ c }: { c: ChangeEntry }) {
  const [open, setOpen] = React.useState(false)
  const hasDetails = c.details !== null && c.details !== undefined
  const failed = c.action.includes('failed') || c.action.includes('denied') || c.action === 'run.reject' || c.action === 'run.approval-expired'
  return (
    <div>
      <button
        type="button"
        onClick={() => hasDetails && setOpen((o) => !o)}
        aria-expanded={hasDetails ? open : undefined}
        className={cn('flex w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:bg-accent/50', hasDetails && 'hover:bg-accent/40')}
      >
        <span className={cn('grid size-8 shrink-0 place-content-center rounded-lg [&_svg]:size-4', failed ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' : typeTone[c.entityType] ?? 'bg-muted text-muted-foreground')}>
          {typeIcon[c.entityType] ?? <FileClock />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px]">
            <span className="font-medium">{c.username}</span>{' '}
            <span className={cn('text-muted-foreground', failed && 'text-rose-600 dark:text-rose-400')}>· {actionLabels[c.action] ?? c.action}</span>
          </p>
          <p className="truncate text-xs text-muted-foreground" title={c.summary}>{c.summary}</p>
        </div>
        <EntryDomain c={c} />
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:block" title={formatDateTime(c.at)}>
          {new Date(c.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · {formatRelative(c.at)}
        </span>
        {hasDetails && <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />}
      </button>
      {open && hasDetails && (
        <div className="border-t bg-muted/30 px-4 py-3 pl-15">
          <Details c={c} />
        </div>
      )}
    </div>
  )
}

/** Domain of a domain-bound entry (stored in its details), shown when several domains exist. */
function EntryDomain({ c }: { c: ChangeEntry }) {
  const { multiple, domains } = useDomains()
  const key = c.details && typeof c.details === 'object' && typeof c.details.domain === 'string' ? (c.details.domain as string) : null
  if (!multiple || !key || c.entityType === 'domain') return null
  const d = domains.find((x) => x.key === key)
  return (
    <span className="hidden max-w-36 shrink-0 items-center gap-1 truncate rounded-md border bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground md:inline-flex" title={d?.dnsName}>
      <Network className="size-3 shrink-0" />
      <span className="truncate">{d?.displayName ?? key}</span>
    </span>
  )
}

function Details({ c }: { c: ChangeEntry }) {
  const d = c.details
  if ((c.action === 'config.update' || c.action === 'config.restore') && d && typeof d === 'object' && d.section) {
    return (
      <dl className="grid gap-1.5 text-[13px] sm:grid-cols-[140px_1fr]">
        <dt className="text-muted-foreground">{t('changelog.changelog.section')}</dt>
        <dd><Link to={`/konfiguration/${d.section}`} className="text-primary hover:underline">{sectionFallbackTitles[d.section] ?? d.section}</Link></dd>
        <dt className="text-muted-foreground">{t('changelog.changelog.version')}</dt>
        <dd className="font-mono">v{d.fromVersion ?? '?'} → v{d.toVersion ?? '?'}</dd>
        {d.comment && (<><dt className="text-muted-foreground">{t('changelog.changelog.comment')}</dt><dd>{d.comment}</dd></>)}
      </dl>
    )
  }
  if (c.entityType === 'run' && c.entityId) {
    return (
      <div className="grid gap-2 text-[13px]">
        <Link to={`/laeufe/${c.entityId}`} className="text-primary hover:underline">{t('changelog.changelog.run')}{c.entityId} {t('changelog.changelog.open')}</Link>
        {d !== null && d !== undefined && <KeyValueList value={d} />}
      </div>
    )
  }
  if (typeof d === 'string') {
    // details may be a JSON document stored as text – show it as fields, too
    try {
      const parsed = JSON.parse(d)
      if (parsed && typeof parsed === 'object') return <KeyValueList value={parsed} />
    } catch {
      /* plain text */
    }
    return <p className="text-[13px] whitespace-pre-wrap">{d}</p>
  }
  return <KeyValueList value={d} />
}
