import * as React from 'react'
import { diffLines } from 'diff'
import { ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

type Row =
  | { kind: 'ctx' | 'add' | 'del'; oldNo?: number; newNo?: number; text: string }
  | { kind: 'gap'; count: number; id: number }

interface SplitRow {
  left?: { no: number; text: string; kind: 'ctx' | 'del' }
  right?: { no: number; text: string; kind: 'ctx' | 'add' }
  gap?: { count: number; id: number }
}

function splitLines(v: string) {
  const lines = v.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

export function computeDiff(before: string, after: string) {
  const parts = diffLines(before, after)
  const rows: Exclude<Row, { kind: 'gap' }>[] = []
  let o = 1
  let n = 1
  let added = 0
  let removed = 0
  for (const p of parts) {
    const lines = splitLines(p.value)
    for (const text of lines) {
      if (p.added) { rows.push({ kind: 'add', newNo: n++, text }); added++ }
      else if (p.removed) { rows.push({ kind: 'del', oldNo: o++, text }); removed++ }
      else rows.push({ kind: 'ctx', oldNo: o++, newNo: n++, text })
    }
  }
  return { rows, added, removed }
}

function collapse(rows: Exclude<Row, { kind: 'gap' }>[], context: number, expanded: Set<number>): Row[] {
  const keep = new Array(rows.length).fill(false)
  rows.forEach((r, i) => {
    if (r.kind !== 'ctx') for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) keep[j] = true
  })
  const out: Row[] = []
  let i = 0
  while (i < rows.length) {
    if (keep[i]) { out.push(rows[i]); i++; continue }
    const start = i
    while (i < rows.length && !keep[i]) i++
    if (expanded.has(start)) out.push(...rows.slice(start, i))
    else out.push({ kind: 'gap', count: i - start, id: start })
  }
  return out
}

export function DiffStats({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-xs">
      <span className="text-emerald-600 dark:text-emerald-400">+{added}</span>
      <span className="text-rose-600 dark:text-rose-400">−{removed}</span>
    </span>
  )
}

export function DiffView({
  before,
  after,
  mode = 'unified',
  context = 3,
  className,
  maxHeight = '60vh',
}: {
  before: string
  after: string
  mode?: 'unified' | 'split'
  context?: number
  className?: string
  maxHeight?: string
}) {
  const [expanded, setExpanded] = React.useState<Set<number>>(new Set())
  const { rows, added, removed } = React.useMemo(() => computeDiff(before, after), [before, after])
  const shown = React.useMemo(() => collapse(rows, context, expanded), [rows, context, expanded])
  const expand = (id: number) => setExpanded((s) => new Set(s).add(id))

  if (added === 0 && removed === 0) {
    return (
      <div className={cn('rounded-lg border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground', className)}>
        Keine Unterschiede
      </div>
    )
  }

  const gapRow = (g: { count: number; id: number }, colSpan: number) => (
    <tr key={`gap-${g.id}`}>
      <td colSpan={colSpan} className="bg-sky-500/5 p-0">
        <button
          type="button"
          onClick={() => expand(g.id)}
          className="flex w-full items-center gap-2 px-3 py-1 text-left text-[11px] text-sky-700 hover:bg-sky-500/10 dark:text-sky-300"
        >
          <ChevronsUpDown className="size-3" /> {g.count} unveränderte Zeilen einblenden
        </button>
      </td>
    </tr>
  )

  if (mode === 'split') {
    const split: SplitRow[] = []
    let pendingDel: { no: number; text: string }[] = []
    let pendingAdd: { no: number; text: string }[] = []
    const flush = () => {
      const m = Math.max(pendingDel.length, pendingAdd.length)
      for (let i = 0; i < m; i++) {
        split.push({
          left: pendingDel[i] ? { ...pendingDel[i], kind: 'del' } : undefined,
          right: pendingAdd[i] ? { ...pendingAdd[i], kind: 'add' } : undefined,
        })
      }
      pendingDel = []
      pendingAdd = []
    }
    for (const r of shown) {
      if (r.kind === 'gap') { flush(); split.push({ gap: r }); continue }
      if (r.kind === 'del') pendingDel.push({ no: r.oldNo!, text: r.text })
      else if (r.kind === 'add') pendingAdd.push({ no: r.newNo!, text: r.text })
      else {
        flush()
        split.push({ left: { no: r.oldNo!, text: r.text, kind: 'ctx' }, right: { no: r.newNo!, text: r.text, kind: 'ctx' } })
      }
    }
    flush()
    return (
      <div className={cn('overflow-auto rounded-lg border bg-card font-mono text-[12px] leading-5', className)} style={{ maxHeight }}>
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col className="w-10" /><col /><col className="w-10" /><col />
          </colgroup>
          <tbody>
            {split.map((s, i) =>
              s.gap ? gapRow(s.gap, 4) : (
                <tr key={i}>
                  <LineNo no={s.left?.no} kind={s.left?.kind} />
                  <LineText text={s.left?.text} kind={s.left?.kind} empty={!s.left} />
                  <LineNo no={s.right?.no} kind={s.right?.kind} border />
                  <LineText text={s.right?.text} kind={s.right?.kind} empty={!s.right} />
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className={cn('overflow-auto rounded-lg border bg-card font-mono text-[12px] leading-5', className)} style={{ maxHeight }}>
      <table className="w-full border-collapse">
        <tbody>
          {shown.map((r, i) =>
            r.kind === 'gap' ? gapRow(r, 4) : (
              <tr key={i}>
                <LineNo no={r.oldNo} kind={r.kind} />
                <LineNo no={r.newNo} kind={r.kind} />
                <td className={cn('w-4 pl-2 select-none', r.kind === 'add' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : r.kind === 'del' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' : 'text-transparent')}>
                  {r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ' '}
                </td>
                <LineText text={r.text} kind={r.kind} />
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  )
}

function LineNo({ no, kind, border }: { no?: number; kind?: 'ctx' | 'add' | 'del'; border?: boolean }) {
  return (
    <td
      className={cn(
        'w-10 min-w-10 pr-2 text-right align-top text-[11px] text-muted-foreground/70 select-none',
        kind === 'add' && 'bg-emerald-500/15',
        kind === 'del' && 'bg-rose-500/15',
        border && 'border-l',
      )}
    >
      {no ?? ''}
    </td>
  )
}

function LineText({ text, kind, empty }: { text?: string; kind?: 'ctx' | 'add' | 'del'; empty?: boolean }) {
  return (
    <td
      className={cn(
        'pr-4 pl-2 align-top break-all whitespace-pre-wrap',
        kind === 'add' && 'bg-emerald-500/10 text-emerald-900 dark:text-emerald-100',
        kind === 'del' && 'bg-rose-500/10 text-rose-900 dark:text-rose-100',
        empty && 'bg-muted/40',
      )}
    >
      {text}
    </td>
  )
}
