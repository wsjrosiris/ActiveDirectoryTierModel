import * as React from 'react'
import { ArrowDownUp, ArrowRight, ChevronRight, ChevronsDownUp, ChevronsUpDown, Minus, Pencil, Plus, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatValue, pathText, type ChangeGroup, type FieldChange, type SectionDiff } from '@/lib/structured-diff'
import { fieldLabel } from '@/lib/field-labels'
import { cn, formatNumber } from '@/lib/utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

const isObj = (v: unknown): v is Record<string, Json> => !!v && typeof v === 'object' && !Array.isArray(v)

const kindMeta = {
  added: { icon: <Plus />, tone: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300', verb: 'hinzugefügt' },
  removed: { icon: <Minus />, tone: 'bg-rose-500/12 text-rose-700 dark:text-rose-300', verb: 'entfernt' },
  changed: { icon: <Pencil />, tone: 'bg-amber-500/12 text-amber-700 dark:text-amber-300', verb: 'geändert' },
} as const

function KindIcon({ kind, small }: { kind: keyof typeof kindMeta; small?: boolean }) {
  return (
    <span className={cn('grid shrink-0 place-content-center rounded-md', small ? 'size-4 [&_svg]:size-3' : 'size-5 [&_svg]:size-3.5', kindMeta[kind].tone)} aria-label={kindMeta[kind].verb}>
      {kindMeta[kind].icon}
    </span>
  )
}

function Quote({ children, tone }: { children: React.ReactNode; tone?: 'old' | 'new' }) {
  return (
    <span
      className={cn(
        'rounded px-1 py-px break-words',
        tone === 'old' && 'bg-rose-500/10 text-rose-800 line-through decoration-rose-500/40 dark:text-rose-200',
        tone === 'new' && 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
      )}
    >
      „{children}“
    </span>
  )
}

/** Up to a few scalar facts of an added / removed object, as "Label: Wert" chips. */
function ObjectFacts({ value }: { value: Json }) {
  if (!isObj(value)) return null
  const facts = Object.entries(value)
    .filter(([, v]) => v !== null && v !== '' && v !== undefined && !(Array.isArray(v) && !v.length))
    .slice(0, 5)
  if (!facts.length) return null
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {facts.map(([k, v]) => (
        <span key={k} className="rounded-md border bg-card px-1.5 py-0.5 text-[11.5px]">
          <span className="text-muted-foreground">{fieldLabel(k)}:</span> {formatValue(v, 48)}
        </span>
      ))}
    </span>
  )
}

function FieldLine({ f }: { f: FieldChange }) {
  const label = pathText(f.path)
  const scalar = (v: Json) => v === null || typeof v !== 'object' || (Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object'))
  let body: React.ReactNode
  let kind: keyof typeof kindMeta = 'changed'
  switch (f.kind) {
    case 'changed':
      body = (
        <>
          {label && <span className="font-medium">{label}: </span>}
          <Quote tone="old">{formatValue(f.before)}</Quote> <ArrowRight className="inline size-3 text-muted-foreground" /> <Quote tone="new">{formatValue(f.after)}</Quote>
        </>
      )
      break
    case 'added':
      kind = 'added'
      body = (
        <>
          <span className="font-medium">{label || 'Eintrag'}</span>
          {scalar(f.after) ? <> = <Quote tone="new">{formatValue(f.after)}</Quote></> : <> hinzugefügt</>}
          {!scalar(f.after) && <ObjectFacts value={f.after} />}
        </>
      )
      break
    case 'removed':
      kind = 'removed'
      body = (
        <>
          <span className="font-medium">{label || 'Eintrag'}</span> entfernt
          {scalar(f.before) && f.before !== '' && <> (war <Quote tone="old">{formatValue(f.before)}</Quote>)</>}
          {!scalar(f.before) && <ObjectFacts value={f.before} />}
        </>
      )
      break
    case 'list':
      body = (
        <>
          {label && <span className="font-medium">{label}: </span>}
          {f.added.length > 0 && (
            <>
              <span className="text-muted-foreground">hinzugefügt: </span>
              <span className="text-emerald-700 dark:text-emerald-300">{f.added.join(', ')}</span>
            </>
          )}
          {f.added.length > 0 && f.removed.length > 0 && <span className="text-muted-foreground"> · </span>}
          {f.removed.length > 0 && (
            <>
              <span className="text-muted-foreground">entfernt: </span>
              <span className="text-rose-700 line-through decoration-rose-500/40 dark:text-rose-300">{f.removed.join(', ')}</span>
            </>
          )}
        </>
      )
      break
    case 'order':
      body = (
        <span className="inline-flex items-center gap-1.5">
          <ArrowDownUp className="size-3.5 text-muted-foreground" />
          {label ? <><span className="font-medium">{label}</span>: Reihenfolge geändert</> : 'Reihenfolge geändert'}
        </span>
      )
      break
  }
  return (
    <li className="flex items-start gap-2 py-1 text-[13px] leading-5">
      <span className="mt-0.5"><KindIcon kind={kind} small /></span>
      <span className="min-w-0 flex-1 break-words">{body}</span>
    </li>
  )
}

function GroupRow({ g, open, onToggle }: { g: ChangeGroup; open: boolean; onToggle: () => void }) {
  const expandable = g.fields.length > 0 || (g.summary?.length ?? 0) > 0
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onToggle}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring disabled:hover:bg-transparent"
      >
        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90', !expandable && 'invisible')} />
        <KindIcon kind={g.kind} />
        <span className="min-w-0 flex-1 truncate">
          {g.entity && <span className="text-muted-foreground">{g.entity} </span>}
          <span className="font-medium">{g.title}</span>
          {g.entity && <span className="text-muted-foreground"> {kindMeta[g.kind].verb}</span>}
        </span>
        {g.fields.length > 0 && (
          <Badge variant="muted" className="tabular">
            {g.fields.length} {g.fields.length === 1 ? 'Änderung' : 'Änderungen'}
          </Badge>
        )}
      </button>
      {open && expandable && (
        <div className="mb-1 ml-[26px] border-l pl-4">
          {g.summary && g.summary.length > 0 && (
            <div className="flex flex-wrap gap-1 py-1">
              {g.summary.map((s) => (
                <span key={s.label} className="rounded-md border bg-card px-1.5 py-0.5 text-[11.5px]">
                  <span className="text-muted-foreground">{s.label}:</span> {s.value}
                </span>
              ))}
            </div>
          )}
          {g.fields.length > 0 && (
            <ul>
              {g.fields.slice(0, 200).map((f, i) => <FieldLine key={i} f={f} />)}
              {g.fields.length > 200 && <li className="py-1 text-xs text-muted-foreground">… und {formatNumber(g.fields.length - 200)} weitere</li>}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

export function DiffCounts({ diff, className }: { diff: SectionDiff; className?: string }) {
  if (!diff.total) return <span className={cn('text-xs text-muted-foreground', className)}>keine Änderungen</span>
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs tabular', className)}>
      {diff.added > 0 && <span className="text-emerald-700 dark:text-emerald-400">+{diff.added}</span>}
      {diff.removed > 0 && <span className="text-rose-700 dark:text-rose-400">−{diff.removed}</span>}
      {diff.changed > 0 && <span className="text-amber-700 dark:text-amber-400">~{diff.changed}</span>}
    </span>
  )
}

const PAGE = 150

/** Readable list of changes, grouped by item, collapsible, with a filter for large change sets. */
export function ChangeList({ diff, maxHeight = '50vh', className }: { diff: SectionDiff; maxHeight?: string; className?: string }) {
  const large = diff.total > 40 || diff.groups.length > 12
  const [openAll, setOpenAll] = React.useState(!large)
  const [toggled, setToggled] = React.useState<Set<string>>(new Set())
  const [filter, setFilter] = React.useState('')
  const [limit, setLimit] = React.useState(PAGE)

  React.useEffect(() => {
    setOpenAll(!(diff.total > 40 || diff.groups.length > 12))
    setToggled(new Set())
    setLimit(PAGE)
  }, [diff])

  const q = filter.trim().toLowerCase()
  const groups = React.useMemo(
    () =>
      q
        ? diff.groups.filter(
            (g) =>
              g.title.toLowerCase().includes(q) ||
              (g.entity ?? '').toLowerCase().includes(q) ||
              g.fields.some((f) => pathText(f.path).toLowerCase().includes(q)),
          )
        : diff.groups,
    [diff, q],
  )

  if (!diff.total) {
    return <div className={cn('rounded-lg border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground', className)}>Keine Unterschiede</div>
  }

  const isOpen = (key: string) => (toggled.has(key) ? !openAll : openAll)
  const toggle = (key: string) =>
    setToggled((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {diff.added > 0 && <Badge variant="success"><Plus /> {formatNumber(diff.added)} hinzugefügt</Badge>}
          {diff.removed > 0 && <Badge variant="danger"><Minus /> {formatNumber(diff.removed)} entfernt</Badge>}
          {diff.changed > 0 && <Badge variant="warning"><Pencil /> {formatNumber(diff.changed)} geändert</Badge>}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {diff.groups.length > 8 && (
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Änderungen filtern …" className="h-7 w-48 pl-7 text-xs" aria-label="Änderungen filtern" />
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              setOpenAll((o) => !o)
              setToggled(new Set())
            }}
          >
            {openAll ? <><ChevronsDownUp /> Alle zuklappen</> : <><ChevronsUpDown /> Alle aufklappen</>}
          </Button>
        </div>
      </div>
      <ul className="min-h-0 overflow-y-auto p-1.5" style={{ maxHeight }}>
        {groups.slice(0, limit).map((g) => (
          <GroupRow key={g.key} g={g} open={isOpen(g.key)} onToggle={() => toggle(g.key)} />
        ))}
        {groups.length === 0 && <li className="px-3 py-4 text-center text-xs text-muted-foreground">Keine Treffer</li>}
        {groups.length > limit && (
          <li className="px-2 py-1.5">
            <Button type="button" variant="ghost" size="xs" onClick={() => setLimit((l) => l + PAGE)}>
              {formatNumber(groups.length - limit)} weitere anzeigen
            </Button>
          </li>
        )}
      </ul>
    </div>
  )
}
