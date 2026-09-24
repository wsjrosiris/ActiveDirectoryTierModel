import * as React from 'react'
import { ChevronRight, Layers, List, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { ComboOption } from '@/components/ui/combobox'
import { Input, Textarea } from '@/components/ui/input'
import { MultiCombobox } from '@/components/ui/multi-combobox'
import { Switch } from '@/components/ui/switch'
import { fieldLabel } from '@/lib/field-labels'
import { cn } from '@/lib/utils'
import type { EditorProps } from './editors'
import { t } from '@/i18n'

/* A generic, recursive form for any JSON-shaped object: every value gets a fitting input,
 * nested objects become collapsible fieldsets and arrays of objects a list of cards.
 * Edits always copy the parent object ({...value, [key]: next}), so unknown keys and the key
 * order are preserved. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/

export const isPlainObject = (v: unknown): v is Record<string, Json> => !!v && typeof v === 'object' && !Array.isArray(v)

/** An empty value with the same shape (used for new list items / map entries). */
export function emptyLike(v: Json): Json {
  if (Array.isArray(v)) return []
  if (isPlainObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, emptyLike(x)]))
  if (typeof v === 'number') return 0
  if (typeof v === 'boolean') return false
  if (typeof v === 'string') return DATE_RE.test(v) ? new Date().toISOString().slice(0, 10) : ''
  return null
}

function isStringArray(v: Json[]) {
  return v.every((x) => typeof x === 'string' || typeof x === 'number')
}

/** Writes an edited subset of keys back into the full object, keeping key order; keys removed from the subset are dropped. */
export function mergeSubset(full: Record<string, Json>, subset: Record<string, Json>, next: Record<string, Json>): Record<string, Json> {
  const out: Record<string, Json> = {}
  for (const [k, v] of Object.entries(full)) {
    if (!(k in subset)) out[k] = v
    else if (k in next) out[k] = next[k]
  }
  for (const [k, v] of Object.entries(next)) if (!(k in out) && !(k in subset)) out[k] = v
  return out
}

/** Human label for an item in a list of objects. */
function itemTitle(item: Json, index: number): string {
  if (isPlainObject(item)) {
    for (const k of ['name', 'displayName', 'samAccountName', 'samaccountname', 'identityreference', 'title', 'key', 'id'])
      if (typeof item[k] === 'string' && item[k]) return item[k]
    const firstString = Object.values(item).find((x) => typeof x === 'string' && x && x.length < 60)
    if (typeof firstString === 'string') return firstString
  }
  return t('config.objectForm.entryValue', { value: index + 1 })
}

interface NodeProps {
  name: string
  value: Json
  onChange: (next: Json) => void
  readOnly: boolean
  depth: number
  id: string
  onRemove?: () => void
}

/** Label with the technical key as a subtle hint when it differs. */
function KeyLabel({ name, htmlFor }: { name: string; htmlFor?: string }) {
  const label = fieldLabel(name)
  return (
    <label htmlFor={htmlFor} className="flex min-w-0 items-baseline gap-2 text-[13px] font-medium">
      <span className="truncate">{label}</span>
      {label !== name && <span className="truncate font-mono text-[10.5px] font-normal text-muted-foreground/80">{name}</span>}
    </label>
  )
}

function RemoveButton({ onRemove, label }: { onRemove?: () => void; label: string }) {
  if (!onRemove) return null
  return (
    <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label={t('config.objectForm.removeLabel', { label })}>
      <Trash2 />
    </Button>
  )
}

function PrimitiveField({ name, value, onChange, readOnly, id, onRemove }: NodeProps) {
  const label = fieldLabel(name)
  if (typeof value === 'boolean') {
    return (
      <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border bg-card px-3.5 py-2.5 transition-colors hover:bg-accent/40">
        <span className="flex min-w-0 items-baseline gap-2 text-[13px] font-medium">
          <span className="truncate">{label}</span>
          {label !== name && <span className="truncate font-mono text-[10.5px] font-normal text-muted-foreground/80">{name}</span>}
        </span>
        <span className="flex items-center gap-1">
          <Switch id={id} checked={value} disabled={readOnly} onCheckedChange={onChange} />
          <RemoveButton onRemove={onRemove} label={label} />
        </span>
      </label>
    )
  }
  let control: React.ReactNode
  if (typeof value === 'number') {
    control = (
      <Input id={id} type="number" readOnly={readOnly} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(Number.isNaN(e.target.valueAsNumber) ? 0 : e.target.valueAsNumber)} className="tabular" />
    )
  } else if (typeof value === 'string' && DATE_RE.test(value)) {
    control = <Input id={id} type="date" readOnly={readOnly} value={value} onChange={(e) => e.target.value && onChange(e.target.value)} className="w-full sm:w-48" />
  } else if (typeof value === 'string' && DATETIME_RE.test(value)) {
    const m = DATETIME_RE.exec(value)!
    const zone = m[3] ?? ''
    control = (
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="datetime-local"
          readOnly={readOnly}
          value={m[1]}
          onChange={(e) => e.target.value && onChange(`${e.target.value}${m[2] ?? ':00'}${zone}`)}
          className="w-full sm:w-60"
        />
        {zone && <span className="text-xs text-muted-foreground">{zone === 'Z' ? 'UTC' : zone}</span>}
      </div>
    )
  } else if (typeof value === 'string' && (value.length > 70 || value.includes('\n') || name === 'comment' || name === 'description')) {
    control = <Textarea id={id} rows={value.length > 160 ? 3 : 2} readOnly={readOnly} value={value} onChange={(e) => onChange(e.target.value)} />
  } else {
    const mono = typeof value === 'string' && /[\\{}]|^[\w.-]+$/.test(value) && !/\s/.test(value)
    control = (
      <Input
        id={id}
        readOnly={readOnly}
        value={value === null || value === undefined ? '' : String(value)}
        placeholder={value === null ? 'leer' : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={cn(mono && 'font-mono text-[13px]')}
      />
    )
  }
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <div className="flex min-h-5 items-center justify-between gap-2">
        <KeyLabel name={name} htmlFor={id} />
        <RemoveButton onRemove={onRemove} label={label} />
      </div>
      {control}
    </div>
  )
}

function StringListField({ name, value, onChange, readOnly, id, onRemove }: NodeProps) {
  const numeric = (value as Json[]).length > 0 && (value as Json[]).every((x) => typeof x === 'number')
  const values = (value as Json[]).map(String)
  const options = React.useMemo<ComboOption[]>(() => values.map((v) => ({ value: v })), [values])
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <div className="flex min-h-5 items-center justify-between gap-2">
        <KeyLabel name={name} htmlFor={id} />
        <RemoveButton onRemove={onRemove} label={fieldLabel(name)} />
      </div>
      <MultiCombobox
        id={id}
        values={values}
        options={options}
        disabled={readOnly}
        onChange={(next) => onChange(numeric ? next.map((x) => (Number.isNaN(Number(x)) ? x : Number(x))) : next)}
        placeholder={t('config.objectForm.enterAValueAndAdd')}
      />
    </div>
  )
}

function Collapsible({
  title,
  subtitle,
  icon,
  count,
  defaultOpen,
  children,
  actions,
  tone = 'default',
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  icon?: React.ReactNode
  count?: number
  defaultOpen: boolean
  children: React.ReactNode
  actions?: React.ReactNode
  tone?: 'default' | 'item'
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <div className={cn('min-w-0 rounded-lg border', tone === 'item' ? 'bg-card' : 'bg-muted/20')}>
      <div className="flex items-center gap-1 pr-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          {icon && <span className="text-muted-foreground [&_svg]:size-3.5">{icon}</span>}
          <span className="min-w-0 truncate text-[13px] font-semibold">{title}</span>
          {subtitle && <span className="hidden min-w-0 truncate font-mono text-[10.5px] text-muted-foreground sm:inline">{subtitle}</span>}
          {count !== undefined && <Badge variant="muted" className="ml-1 tabular">{count}</Badge>}
        </button>
        {actions}
      </div>
      {open && <div className="grid gap-4 border-t px-4 py-4">{children}</div>}
    </div>
  )
}

function ObjectArrayField({ name, value, onChange, readOnly, depth, id, onRemove }: NodeProps) {
  const items = value as Json[]
  const label = fieldLabel(name)
  const add = () => onChange([...items, items.length ? emptyLike(items[0]) : {}])
  return (
    <Collapsible
      title={label}
      subtitle={label !== name ? name : undefined}
      icon={<List />}
      count={items.length}
      defaultOpen={depth < 2}
      actions={<RemoveButton onRemove={onRemove} label={label} />}
    >
      {items.length === 0 && <p className="text-xs text-muted-foreground">{t('config.objectForm.noEntries')}</p>}
      {items.map((item, i) => (
        <Collapsible
          key={i}
          tone="item"
          title={itemTitle(item, i)}
          defaultOpen={items.length <= 3}
          actions={
            !readOnly && (
              <RemoveButton onRemove={() => onChange(items.filter((_, j) => j !== i))} label={itemTitle(item, i)} />
            )
          }
        >
          {isPlainObject(item) ? (
            <ObjectFields value={item} onChange={(v) => onChange(items.map((x, j) => (j === i ? v : x)))} readOnly={readOnly} depth={depth + 1} idPrefix={`${id}-${i}`} />
          ) : (
            <Node name={`${i + 1}`} value={item} onChange={(v) => onChange(items.map((x, j) => (j === i ? v : x)))} readOnly={readOnly} depth={depth + 1} id={`${id}-${i}`} />
          )}
        </Collapsible>
      ))}
      {!readOnly && (
        <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={add}>
          <Plus /> {t('config.objectForm.addEntry')}
        </Button>
      )}
    </Collapsible>
  )
}

/** Adds a key to a map whose values share one shape (e.g. principalTypes.group / user / …). */
function AddEntry({ onAdd, existing }: { onAdd: (key: string) => void; existing: string[] }) {
  const [key, setKey] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const k = key.trim()
  const dup = existing.some((e) => e.toLowerCase() === k.toLowerCase())
  if (!open)
    return (
      <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setOpen(true)}>
        <Plus /> {t('config.objectForm.addEntry')}
      </Button>
    )
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        autoFocus
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder={t('config.objectForm.keyEGComputer')}
        className="h-8 max-w-60 font-mono text-[13px]"
        aria-invalid={dup || undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (k && !dup) { onAdd(k); setKey(''); setOpen(false) }
          }
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      <Button type="button" size="sm" disabled={!k || dup} onClick={() => { onAdd(k); setKey(''); setOpen(false) }}>{t('common.add')}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
      {dup && <span className="text-xs text-destructive">{t('config.objectForm.keyAlreadyExists')}</span>}
    </div>
  )
}

function Node(props: NodeProps) {
  const { name, value, onChange, readOnly, depth, id, onRemove } = props
  if (Array.isArray(value)) {
    if (isStringArray(value)) return <StringListField {...props} />
    return <ObjectArrayField {...props} />
  }
  if (isPlainObject(value)) {
    const label = fieldLabel(name)
    return (
      <Collapsible
        title={label}
        subtitle={label !== name ? name : undefined}
        icon={<Layers />}
        count={Object.keys(value).length}
        defaultOpen={depth < 2}
        actions={<RemoveButton onRemove={onRemove} label={label} />}
      >
        <ObjectFields value={value} onChange={onChange} readOnly={readOnly} depth={depth + 1} idPrefix={id} />
      </Collapsible>
    )
  }
  return <PrimitiveField {...props} />
}

/** All fields of one object: simple values in a grid first, then nested groups (original order within each). */
export function ObjectFields({
  value,
  onChange,
  readOnly,
  depth = 0,
  idPrefix = 'of',
}: {
  value: Record<string, Json>
  onChange: (next: Record<string, Json>) => void
  readOnly: boolean
  depth?: number
  idPrefix?: string
}) {
  const entries = Object.entries(value)
  const isGroup = (v: Json) => isPlainObject(v) || (Array.isArray(v) && !isStringArray(v))
  const simple = entries.filter(([, v]) => !isGroup(v))
  const groups = entries.filter(([, v]) => isGroup(v))
  // A map whose values are all objects (like principalTypes) can get new entries of the same shape.
  const objectValues = entries.filter(([k]) => k !== 'comment').map(([, v]) => v)
  const shape = (v: Json) => Object.keys(v).filter((k) => k !== 'comment').sort().join('|')
  const isObjectMap =
    depth > 0 && objectValues.length > 1 && objectValues.every(isPlainObject) && objectValues.every((v) => shape(v) === shape(objectValues[0]))
  const set = (k: string, v: Json) => onChange({ ...value, [k]: v })
  const remove = (k: string) => {
    const next = { ...value }
    delete next[k]
    onChange(next)
  }
  const safeId = (k: string) => `${idPrefix}-${k.replace(/[^\w-]/g, '_')}`

  return (
    <div className="grid min-w-0 gap-4">
      {simple.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {simple.map(([k, v]) => {
            const wide = typeof v === 'string' && (v.length > 40 || k === 'comment' || k === 'description')
            return (
              <div key={k} className={cn('min-w-0', (wide || Array.isArray(v) || typeof v === 'boolean') && 'sm:col-span-2')}>
                <Node name={k} value={v} onChange={(x) => set(k, x)} readOnly={readOnly} depth={depth} id={safeId(k)} />
              </div>
            )
          })}
        </div>
      )}
      {groups.map(([k, v]) => (
        <Node
          key={k}
          name={k}
          value={v}
          onChange={(x) => set(k, x)}
          readOnly={readOnly}
          depth={depth}
          id={safeId(k)}
          onRemove={isObjectMap && !readOnly ? () => remove(k) : undefined}
        />
      ))}
      {isObjectMap && !readOnly && (
        <AddEntry existing={entries.map(([k]) => k)} onAdd={(k) => set(k, emptyLike(objectValues[0]))} />
      )}
    </div>
  )
}

/** Section editor: top-level simple fields in one card, each nested group in its own card. */
export function ObjectFormEditor({ content, setContent, readOnly, sectionKey }: EditorProps) {
  if (!isPlainObject(content)) {
    return (
      <Card className="p-5 text-sm text-muted-foreground">{t('config.objectForm.thisSectionContainsNoEditable')}</Card>
    )
  }
  const entries = Object.entries(content)
  const simple = Object.fromEntries(entries.filter(([, v]) => !(isPlainObject(v) || (Array.isArray(v) && !isStringArray(v)))))
  const groups = entries.filter(([, v]) => isPlainObject(v) || (Array.isArray(v) && !isStringArray(v)))
  const tag = (k: string) => `form-${sectionKey}-${k}`

  return (
    <div className="grid gap-4">
      {Object.keys(simple).length > 0 && (
        <Card className="p-5">
          <h3 className="mb-4 text-[13px] font-semibold">{t('config.objectForm.general')}</h3>
          <ObjectFields
            value={simple}
            readOnly={readOnly}
            idPrefix={`${sectionKey}-root`}
            onChange={(next) => {
              const merged = mergeSubset(content, simple, next)
              const changed = Object.keys(next).find((k) => next[k] !== content[k])
              setContent(merged, tag(changed ?? 'root'))
            }}
          />
        </Card>
      )}
      {groups.map(([k, v]) => {
        const label = fieldLabel(k)
        return (
          <Card key={k} className="p-5">
            <div className="mb-4 flex items-baseline gap-2">
              <h3 className="text-[13px] font-semibold">{label}</h3>
              {label !== k && <span className="font-mono text-[10.5px] text-muted-foreground">{k}</span>}
            </div>
            {isPlainObject(v) ? (
              <ObjectFields value={v} readOnly={readOnly} depth={1} idPrefix={`${sectionKey}-${k}`} onChange={(x) => setContent({ ...content, [k]: x }, tag(k))} />
            ) : (
              <ObjectArrayField name={k} value={v} readOnly={readOnly} depth={0} id={`${sectionKey}-${k}`} onChange={(x) => setContent({ ...content, [k]: x }, tag(k))} />
            )}
          </Card>
        )
      })}
    </div>
  )
}
