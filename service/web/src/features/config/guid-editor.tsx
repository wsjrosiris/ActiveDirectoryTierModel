import * as React from 'react'
import { ArrowRight, Fingerprint, Plus, Sparkles, Tag, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Combobox, type ComboOption } from '@/components/ui/combobox'
import { Input, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { fieldLabel } from '@/lib/field-labels'
import { cn } from '@/lib/utils'
import type { EditorProps } from './editors'
import { isPlainObject, mergeSubset, ObjectFields } from './object-form'
import { t } from '@/i18n'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any
type Mode = 'guid' | 'resolve' | 'text' | 'alias'

export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RESOLVE_RE = /^\{\{resolve_guid:([^}]*)\}\}$/
const LDAP_RE = /^[A-Za-z][A-Za-z0-9-]*$/
const CATEGORIES = ['objectClasses', 'extendedRights', 'attributes']

function valueError(mode: Mode, v: string, aliasTargets?: Set<string>): string | null {
  if (mode === 'guid') return GUID_RE.test(v.trim()) ? null : t('config.guidEditor.guidInTheFormatXxxxxxxx')
  if (mode === 'resolve') return LDAP_RE.test(v.trim()) ? null : t('config.guidEditor.ldapDisplayNameEG')
  if (mode === 'alias') return !v.trim() ? t('config.guidEditor.selectTechnicalName') : aliasTargets && !aliasTargets.has(v.toLowerCase()) ? t('config.guidEditor.unknownNameNotInThe') : null
  return null
}

/** One name field that commits on blur / Enter, so renaming a key never loses focus or merges entries. */
function KeyInput({ value, onCommit, others, readOnly, label }: { value: string; onCommit: (v: string) => void; others: string[]; readOnly: boolean; label: string }) {
  const [text, setText] = React.useState(value)
  React.useEffect(() => setText(value), [value])
  const tt = text.trim()
  const err = !tt ? t('config.guidEditor.nameRequired') : tt !== value && others.some((o) => o.toLowerCase() === tt.toLowerCase()) ? t('config.guidEditor.nameAlreadyPresent') : null
  const commit = () => {
    if (err) setText(value)
    else if (tt !== value) onCommit(tt)
  }
  return (
    <div className="grid gap-1">
      <Input
        aria-label={label}
        readOnly={readOnly}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        aria-invalid={!!err || undefined}
        className="h-8 font-mono text-[12.5px]"
      />
      {err && text !== value && <span className="text-[11px] text-destructive">{err}</span>}
    </div>
  )
}

function ValueInput({
  mode,
  value,
  onChange,
  readOnly,
  aliasOptions,
  aliasTargets,
  label,
}: {
  mode: Mode
  value: string
  onChange: (v: string) => void
  readOnly: boolean
  aliasOptions?: ComboOption[]
  aliasTargets?: Set<string>
  label: string
}) {
  if (mode === 'alias')
    return (
      <Combobox
        value={value}
        onChange={onChange}
        options={aliasOptions ?? []}
        disabled={readOnly}
        mono
        allowCustom={false}
        placeholder={t('config.guidEditor.selectTechnicalName')}
        invalid={!!valueError('alias', value, aliasTargets)}
      />
    )
  if (mode === 'resolve') {
    const m = RESOLVE_RE.exec(value)
    const ldap = m ? m[1] : value
    const err = valueError('resolve', ldap)
    return (
      <div className="grid gap-1">
        <div className="flex items-center gap-2">
          <Input aria-label={t('config.guidEditor.labelLdapName', { label })} readOnly={readOnly} value={ldap} onChange={(e) => onChange(`{{resolve_guid:${e.target.value.trim()}}}`)} aria-invalid={!!err || undefined} className="h-8 font-mono text-[12.5px]" placeholder="lockoutTime" />
        </div>
        <span className={cn('truncate font-mono text-[10.5px]', err ? 'text-destructive' : 'text-muted-foreground')} title={value}>
          {err ?? `→ {{resolve_guid:${ldap}}}`}
        </span>
      </div>
    )
  }
  const err = valueError(mode, value)
  return (
    <div className="grid gap-1">
      <Input aria-label={label} readOnly={readOnly} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!err || undefined} className="h-8 font-mono text-[12.5px]" placeholder={mode === 'guid' ? '00000000-0000-0000-0000-000000000000' : '(leer)'} />
      {err && <span className="text-[11px] text-destructive">{err}</span>}
    </div>
  )
}

/** A name → value table for one mapping object. The object's `comment` stays a separate text field. */
function MapTable({
  title,
  subtitle,
  map,
  onChange,
  mode,
  readOnly,
  keyHeader = t('common.name'),
  valueHeader,
  aliasOptions,
  aliasTargets,
  icon,
}: {
  title: string
  subtitle?: string
  map: Record<string, Json>
  onChange: (next: Record<string, Json>, tag?: string) => void
  mode: Mode
  readOnly: boolean
  keyHeader?: string
  valueHeader: string
  aliasOptions?: ComboOption[]
  aliasTargets?: Set<string>
  icon: React.ReactNode
}) {
  const entries = Object.entries(map).filter(([k]) => k !== 'comment')
  const keys = entries.map(([k]) => k)
  const [newKey, setNewKey] = React.useState('')
  const [newVal, setNewVal] = React.useState('')
  const nk = newKey.trim()
  const newKeyErr = nk && keys.some((k) => k.toLowerCase() === nk.toLowerCase()) ? t('config.guidEditor.nameAlreadyPresent') : null
  const newValErr = (newVal || mode === 'alias') && nk ? valueError(mode, newVal.trim(), aliasTargets) : null
  const canAdd = !!nk && !newKeyErr && !newValErr && (mode === 'text' || !!newVal.trim())

  const rename = (from: string, to: string) => {
    const next: Record<string, Json> = {}
    for (const [k, v] of Object.entries(map)) next[k === from ? to : k] = v
    onChange(next)
  }
  const remove = (k: string) => {
    const next = { ...map }
    delete next[k]
    onChange(next)
  }
  const add = () => {
    if (!canAdd) return
    const v = mode === 'resolve' ? `{{resolve_guid:${newVal.trim()}}}` : newVal.trim()
    onChange({ ...map, [nk]: v })
    setNewKey('')
    setNewVal('')
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
        <h4 className="text-[13px] font-semibold">{title}</h4>
        {subtitle && <span className="font-mono text-[10.5px] text-muted-foreground">{subtitle}</span>}
        <Badge variant="muted" className="tabular">{entries.length}</Badge>
      </div>
      {typeof map.comment === 'string' && (
        <Textarea aria-label={t('config.guidEditor.titleComment', { title })} rows={1} readOnly={readOnly} value={map.comment} onChange={(e) => onChange({ ...map, comment: e.target.value }, `${title}-comment`)} className="min-h-9 text-[13px]" placeholder={t('config.guidEditor.comment')} />
      )}
      <div className="overflow-hidden rounded-lg border">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_36px] gap-2 border-b bg-muted/40 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
          <span>{keyHeader}</span>
          <span>{valueHeader}</span>
          <span />
        </div>
        <div className="divide-y">
          {entries.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">{t('config.guidEditor.noEntries')}</p>}
          {entries.map(([k, v], i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_36px] items-start gap-2 px-3 py-2">
              <KeyInput value={k} others={keys} readOnly={readOnly} label={`${keyHeader} ${k}`} onCommit={(to) => rename(k, to)} />
              <ValueInput mode={mode} value={String(v ?? '')} readOnly={readOnly} aliasOptions={aliasOptions} aliasTargets={aliasTargets} label={t('config.guidEditor.valueheaderForK', { valueHeader, k })} onChange={(x) => onChange({ ...map, [k]: x }, `${title}-${k}`)} />
              {!readOnly && (
                <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-destructive" onClick={() => remove(k)} aria-label={t('config.guidEditor.removeK', { k })}>
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
          {!readOnly && (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_36px] items-start gap-2 bg-muted/20 px-3 py-2">
              <div className="grid gap-1">
                <Input aria-label={t('config.guidEditor.newKeyheader', { keyHeader })} value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder={t('config.guidEditor.newKeyheader2', { keyHeader })} className="h-8 font-mono text-[12.5px] placeholder:font-sans" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} aria-invalid={!!newKeyErr || undefined} />
                {newKeyErr && <span className="text-[11px] text-destructive">{newKeyErr}</span>}
              </div>
              <div className="grid gap-1">
                {mode === 'alias' ? (
                  <Combobox value={newVal} onChange={setNewVal} options={aliasOptions ?? []} mono allowCustom={false} placeholder={t('config.guidEditor.selectTechnicalName')} />
                ) : (
                  <Input
                    aria-label={mode === 'resolve' ? t('config.guidEditor.ldapName') : valueHeader}
                    value={newVal}
                    onChange={(e) => setNewVal(e.target.value)}
                    placeholder={mode === 'guid' ? 'GUID' : mode === 'resolve' ? t('config.guidEditor.ldapNameEGLockouttime') : t('config.guidEditor.valueOptional')}
                    className="h-8 font-mono text-[12.5px] placeholder:font-sans"
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
                    aria-invalid={!!newValErr || undefined}
                  />
                )}
                {newValErr ? (
                  <span className="text-[11px] text-destructive">{newValErr}</span>
                ) : mode === 'resolve' && newVal.trim() ? (
                  <span className="font-mono text-[10.5px] text-muted-foreground">→ {`{{resolve_guid:${newVal.trim()}}}`}</span>
                ) : null}
              </div>
              <Button type="button" variant="outline" size="icon-xs" disabled={!canAdd} onClick={add} aria-label={t('config.guidEditor.addEntry')}>
                <Plus />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function GuidMappingsEditor({ content, setContent, readOnly }: EditorProps) {
  const root: Record<string, Json> = isPlainObject(content) ? content : {}
  const setRoot = (k: string, v: Json, tag?: string) => setContent({ ...root, [k]: v }, tag)

  // every technical name (for the alias picker)
  const technical = React.useMemo(() => {
    const out: ComboOption[] = []
    for (const kind of ['staticMappings', 'dynamicMappings']) {
      const block = root[kind]
      if (!isPlainObject(block)) continue
      for (const [cat, map] of Object.entries(block)) {
        if (!isPlainObject(map)) continue
        for (const [name, v] of Object.entries(map))
          if (name !== 'comment' && !out.some((o) => o.value === name))
            out.push({ value: name, hint: `${fieldLabel(cat)} · ${kind === 'dynamicMappings' ? 'dynamisch' : String(v)}` })
      }
    }
    return out.sort((a, b) => a.value.localeCompare(b.value))
  }, [root])
  const technicalSet = React.useMemo(() => new Set(technical.map((o) => o.value.toLowerCase())), [technical])

  const known = ['version', 'comment', 'staticMappings', 'dynamicMappings', 'specialValues', 'friendlyNameMappings']
  const extra = Object.fromEntries(Object.entries(root).filter(([k]) => !known.includes(k)))

  const block = (kind: 'staticMappings' | 'dynamicMappings') => {
    const b: Record<string, Json> = isPlainObject(root[kind]) ? root[kind] : {}
    const cats = Object.keys(b).filter((k) => isPlainObject(b[k]))
    const ordered = [...CATEGORIES.filter((c) => cats.includes(c)), ...cats.filter((c) => !CATEGORIES.includes(c))]
    const rest = Object.fromEntries(Object.entries(b).filter(([k, v]) => k !== 'comment' && !isPlainObject(v)))
    const isDynamic = kind === 'dynamicMappings'
    return (
      <Card className="p-5">
        <div className="mb-1 flex items-center gap-2">
          {isDynamic ? <Sparkles className="size-4 text-muted-foreground" /> : <Fingerprint className="size-4 text-muted-foreground" />}
          <h3 className="text-sm font-semibold">{fieldLabel(kind)}</h3>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          {isDynamic
            ? t('config.guidEditor.resolvedViaTheTargetDomain')
            : t('config.guidEditor.fixedSchemaGuidsIdenticalIn')}
        </p>
        <div className="grid gap-6">
          <Field label={t('config.guidEditor.comment')} htmlFor={`gm-${kind}-comment`}>
            <Textarea id={`gm-${kind}-comment`} rows={1} readOnly={readOnly} className="min-h-9" value={b.comment ?? ''} onChange={(e) => setRoot(kind, { ...b, comment: e.target.value }, `gm-${kind}-comment`)} />
          </Field>
          <div className="grid gap-6 2xl:grid-cols-2">
            {ordered.map((cat) => (
              <MapTable
                key={cat}
                title={fieldLabel(cat)}
                subtitle={cat}
                icon={<Tag />}
                map={b[cat]}
                mode={isDynamic ? 'resolve' : 'guid'}
                valueHeader={isDynamic ? t('config.guidEditor.ldapNameResolved') : t('config.guidEditor.schemaGuid')}
                readOnly={readOnly}
                onChange={(next, tag) => setRoot(kind, { ...b, [cat]: next }, tag && `gm-${kind}-${tag}`)}
              />
            ))}
          </div>
          {Object.keys(rest).length > 0 && (
            <ObjectFields value={rest} readOnly={readOnly} depth={1} idPrefix={`gm-${kind}-x`} onChange={(x) => setRoot(kind, mergeSubset(b, rest, x))} />
          )}
        </div>
      </Card>
    )
  }

  return (
    <div className="grid gap-4">
      <Card className="p-5">
        <h3 className="mb-4 text-[13px] font-semibold">{t('config.guidEditor.general')}</h3>
        <div className="grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
          <Field label={t('config.guidEditor.version')} htmlFor="gm-version">
            <Input id="gm-version" readOnly={readOnly} className="font-mono" value={root.version ?? ''} onChange={(e) => setRoot('version', e.target.value, 'gm-version')} />
          </Field>
          <Field label={t('config.guidEditor.comment')} htmlFor="gm-comment">
            <Textarea id="gm-comment" rows={2} readOnly={readOnly} value={root.comment ?? ''} onChange={(e) => setRoot('comment', e.target.value, 'gm-comment')} />
          </Field>
        </div>
        {Object.keys(extra).length > 0 && (
          <div className="mt-4">
            <ObjectFields value={extra} readOnly={readOnly} depth={1} idPrefix="gm-extra" onChange={(x) => setContent(mergeSubset(root, extra, x))} />
          </div>
        )}
      </Card>
      {block('staticMappings')}
      {block('dynamicMappings')}
      <div className="grid gap-4 2xl:grid-cols-2">
        <Card className="p-5">
          <MapTable
            title={fieldLabel('specialValues')}
            subtitle="specialValues"
            icon={<Tag />}
            map={isPlainObject(root.specialValues) ? root.specialValues : {}}
            mode="text"
            keyHeader={t('common.name')}
            valueHeader={t('config.guidEditor.value')}
            readOnly={readOnly}
            onChange={(next, tag) => setRoot('specialValues', next, tag && `gm-sv-${tag}`)}
          />
        </Card>
        <Card className="p-5">
          <MapTable
            title={fieldLabel('friendlyNameMappings')}
            subtitle="friendlyNameMappings"
            icon={<ArrowRight />}
            map={isPlainObject(root.friendlyNameMappings) ? root.friendlyNameMappings : {}}
            mode="alias"
            keyHeader={t('config.guidEditor.alias')}
            valueHeader={t('config.guidEditor.technicalName')}
            aliasOptions={technical}
            aliasTargets={technicalSet}
            readOnly={readOnly}
            onChange={(next, tag) => setRoot('friendlyNameMappings', next, tag && `gm-fn-${tag}`)}
          />
        </Card>
      </div>
    </div>
  )
}
