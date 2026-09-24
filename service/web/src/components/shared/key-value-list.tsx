import * as React from 'react'
import { fieldLabel } from '@/lib/field-labels'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

const isObj = (v: unknown): v is Record<string, Json> => !!v && typeof v === 'object' && !Array.isArray(v)
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/** Scalar value as text, the German way. */
export function ScalarValue({ value, mono }: { value: Json; mono?: boolean }) {
  if (value === null || value === undefined || value === '') return <span className="text-muted-foreground">–</span>
  if (typeof value === 'boolean') return <span>{value ? t('common.yes') : t('common.no')}</span>
  if (typeof value === 'number') return <span className="tabular">{value.toLocaleString('de-DE')}</span>
  const s = String(value)
  if (ISO_RE.test(s) && !Number.isNaN(Date.parse(s))) return <span title={s}>{new Date(s).toLocaleString('de-DE')}</span>
  return <span className={cn('break-words', (mono || /^S-1-\d|[\\{}]/.test(s)) && 'font-mono text-[12px]')}>{s}</span>
}

/**
 * Any value as a labelled definition list (nested objects indented, lists as chips) – never raw JSON.
 * Labels come from the shared German dictionary; `labels` can override single keys.
 */
export function KeyValueList({ value, labels, depth = 0, className }: { value: Json; labels?: Record<string, string>; depth?: number; className?: string }) {
  if (!isObj(value)) return <ValueNode value={value} labels={labels} depth={depth} />
  const entries = Object.entries(value)
  if (!entries.length) return <span className="text-muted-foreground">–</span>
  return (
    <dl className={cn('grid gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-[minmax(120px,max-content)_minmax(0,1fr)]', depth > 0 && 'border-l pl-3', className)}>
      {entries.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-muted-foreground">{labels?.[k] ?? fieldLabel(k)}</dt>
          <dd className="min-w-0">
            <ValueNode value={v} labels={labels} depth={depth + 1} />
          </dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

function ValueNode({ value, labels, depth }: { value: Json; labels?: Record<string, string>; depth: number }) {
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted-foreground">{t('common.none')}</span>
    if (value.every((x) => x === null || typeof x !== 'object'))
      return (
        <span className="flex flex-wrap gap-1">
          {value.map((x, i) => (
            <span key={i} className="rounded-md border bg-card px-1.5 py-0.5 text-xs">
              <ScalarValue value={x} />
            </span>
          ))}
        </span>
      )
    return (
      <div className="grid gap-2">
        {value.map((x, i) => (
          <div key={i} className="rounded-md border bg-card px-3 py-2">
            <KeyValueList value={x} labels={labels} depth={depth} />
          </div>
        ))}
      </div>
    )
  }
  if (isObj(value)) return <KeyValueList value={value} labels={labels} depth={depth} />
  return <ScalarValue value={value} />
}
