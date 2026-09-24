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
} from 'lucide-react'
import { api } from '@/api/client'
import type { ChangeEntry } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { Page, PageHeader } from '@/components/shared/page-header'
import { actionLabels, entityTypeLabels, sectionFallbackTitles } from '@/lib/labels'
import { cn, formatDateTime, formatNumber, formatRelative } from '@/lib/utils'

const PAGE_SIZE = 50

const typeIcon: Record<string, React.ReactNode> = {
  config: <SlidersHorizontal />,
  run: <Activity />,
  user: <UserIcon />,
  schedule: <CalendarClock />,
  settings: <Settings2 />,
  auth: <KeyRound />,
}

const typeTone: Record<string, string> = {
  config: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300',
  run: 'bg-sky-500/10 text-sky-600 dark:text-sky-300',
  user: 'bg-teal-500/10 text-teal-600 dark:text-teal-300',
  schedule: 'bg-violet-500/10 text-violet-600 dark:text-violet-300',
  settings: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  auth: 'bg-muted text-muted-foreground',
}

function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
}

export function Component() {
  const [params, setParams] = useSearchParams()
  const entityType = params.get('typ') ?? ''
  const [page, setPage] = React.useState(1)
  React.useEffect(() => setPage(1), [entityType])
  const q = useQuery({
    queryKey: ['changelog', { entityType, page }],
    queryFn: () => api.changelog.list({ entityType, page, pageSize: PAGE_SIZE }),
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
      <PageHeader icon={<FileClock />} title="Änderungsprotokoll" description="Wer hat wann was geändert – Konfiguration, Läufe, Benutzer und Anmeldungen." />
      <div className="mb-4 overflow-x-auto">
        <Segmented<string>
          aria-label="Typ"
          value={entityType || 'all'}
          onValueChange={(v) => {
            const p = new URLSearchParams(params)
            if (v === 'all') p.delete('typ')
            else p.set('typ', v)
            setParams(p, { replace: true })
          }}
          options={[{ value: 'all', label: 'Alle' }, ...Object.entries(entityTypeLabels).map(([value, label]) => ({ value, label }))]}
        />
      </div>
      {q.isLoading ? (
        <Card className="grid gap-3 p-5">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-12" />)}</Card>
      ) : items.length === 0 ? (
        <Card><EmptyState icon={<FileClock />} title="Keine Einträge" description="Für diesen Filter wurden keine Änderungen protokolliert." /></Card>
      ) : (
        <div className={cn('grid gap-6', q.isPlaceholderData && 'opacity-60')}>
          {grouped.map(([day, list]) => (
            <section key={day}>
              <h2 className="mb-2 text-xs font-medium text-muted-foreground">{day}</h2>
              <Card className="divide-y overflow-hidden">
                {list.map((c) => <Entry key={c.id} c={c} />)}
              </Card>
            </section>
          ))}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{formatNumber(total)} Einträge</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Vorherige Seite"><ChevronLeft /></Button>
              <span className="tabular">Seite {page} / {pages}</span>
              <Button variant="ghost" size="icon-xs" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Nächste Seite"><ChevronRight /></Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  )
}

function Entry({ c }: { c: ChangeEntry }) {
  const [open, setOpen] = React.useState(false)
  const hasDetails = c.details !== null && c.details !== undefined
  const failed = c.action.includes('failed')
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

function Details({ c }: { c: ChangeEntry }) {
  const d = c.details
  if ((c.action === 'config.update' || c.action === 'config.restore') && d && typeof d === 'object' && d.section) {
    return (
      <dl className="grid gap-1.5 text-[13px] sm:grid-cols-[140px_1fr]">
        <dt className="text-muted-foreground">Sektion</dt>
        <dd><Link to={`/konfiguration/${d.section}`} className="text-primary hover:underline">{sectionFallbackTitles[d.section] ?? d.section}</Link></dd>
        <dt className="text-muted-foreground">Version</dt>
        <dd className="font-mono">v{d.fromVersion ?? '?'} → v{d.toVersion ?? '?'}</dd>
        {d.comment && (<><dt className="text-muted-foreground">Kommentar</dt><dd>{d.comment}</dd></>)}
      </dl>
    )
  }
  if (c.entityType === 'run' && c.entityId) {
    return (
      <div className="grid gap-2 text-[13px]">
        <Link to={`/laeufe/${c.entityId}`} className="text-primary hover:underline">Lauf #{c.entityId} öffnen</Link>
        {typeof d === 'object' && <pre className="overflow-x-auto rounded-md bg-card p-3 font-mono text-[12px]">{JSON.stringify(d, null, 2)}</pre>}
      </div>
    )
  }
  return <pre className="overflow-x-auto rounded-md border bg-card p-3 font-mono text-[12px]">{typeof d === 'string' ? d : JSON.stringify(d, null, 2)}</pre>
}
