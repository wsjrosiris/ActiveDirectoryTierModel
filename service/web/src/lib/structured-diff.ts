/* Human-readable, structured comparison of two versions of a configuration section.
 * Lists of objects are matched by a section-specific identity (not by position), so an inserted
 * group reads as "Gruppe X hinzugefügt" instead of a cascade of changed fields.
 * Unchanged subtrees are skipped by reference first (drafts share untouched objects), so even
 * the large gpos section is compared quickly. */

import { fieldLabels, humanizeKey } from './field-labels'
import { ouFullDn } from './ou'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

export interface Seg {
  key: string
  label: string
}

export type FieldChange =
  | { kind: 'added'; path: Seg[]; after: Json }
  | { kind: 'removed'; path: Seg[]; before: Json }
  | { kind: 'changed'; path: Seg[]; before: Json; after: Json }
  | { kind: 'list'; path: Seg[]; added: string[]; removed: string[] }
  | { kind: 'order'; path: Seg[] }

export interface ChangeGroup {
  key: string
  /** e.g. "Gruppe" – undefined for plain setting groups */
  entity?: string
  title: string
  kind: 'added' | 'removed' | 'changed'
  /** a few key facts about an added / removed item */
  summary?: { label: string; value: string }[]
  fields: FieldChange[]
}

export interface SectionDiff {
  groups: ChangeGroup[]
  added: number
  removed: number
  changed: number
  /** number of individual change lines */
  total: number
}

const isObj = (v: unknown): v is Record<string, Json> => !!v && typeof v === 'object' && !Array.isArray(v)
const isScalarList = (v: Json[]) => v.every((x) => x === null || typeof x !== 'object')

export function keyLabel(key: string) {
  return fieldLabels[key] ?? humanizeKey(key)
}

const shortDn = (dn: unknown) => String(dn ?? '').replace(/,\{\{DOMAIN_DN\}\}$/, '').replace(/^\{\{DOMAIN_DN\}\}$/, 'Domänenstamm')

/* ------------------------------------------------------------------ collections per section */

interface Collection {
  path: string[]
  kind: 'array' | 'map'
  entity: string
  id: (item: Json, key: string) => string
  title: (item: Json, key: string) => string
  summary?: string[]
}

const aclCollection: Collection = {
  path: ['aclDelegations'],
  kind: 'array',
  entity: 'Delegation',
  id: (a) =>
    [a?.identityreference, a?.targetOUPath, a?.objecttype, [...(Array.isArray(a?.activedirectoryrights) ? a.activedirectoryrights : [])].sort().join('+')]
      .map((x) => String(x ?? '').toLowerCase())
      .join('|'),
  title: (a) => `${a?.identityreference || '?'} → ${shortDn(a?.targetOUPath)}${a?.objecttype ? ` (${a.objecttype})` : ''}`,
  summary: ['activedirectoryrights', 'accesscontroltype', 'activeDirectorysecurityinheritance'],
}

export function collectionsFor(sectionKey: string): Collection[] {
  switch (sectionKey) {
    case 'ous':
      return [{ path: ['organizationUnits'], kind: 'array', entity: 'OU', id: (o) => ouFullDn(o ?? {}).toLowerCase(), title: (o) => o?.name ?? '?', summary: ['path'] }]
    case 'groups':
      return [{ path: ['groups'], kind: 'array', entity: 'Gruppe', id: (g) => String(g?.samaccountname ?? '').toLowerCase(), title: (g) => g?.name || g?.samaccountname || '?', summary: ['samaccountname', 'groupscope', 'path'] }]
    case 'users':
      return [{ path: ['users'], kind: 'array', entity: 'Benutzer', id: (u) => String(u?.samAccountName ?? '').toLowerCase(), title: (u) => u?.samAccountName ?? '?', summary: ['displayName', 'ouPath'] }]
    case 'acls':
    case 'msa':
    case 'gmsa':
    case 'dmsa':
      return [aclCollection]
    case 'winlaps':
      return [{ path: ['winLapsDelegations'], kind: 'array', entity: 'LAPS-Delegation', id: (w) => String(w?.ouDn ?? '').toLowerCase(), title: (w) => shortDn(w?.ouDn), summary: ['readGroup', 'resetGroup'] }]
    case 'admx':
      return [{ path: ['admx', 'files'], kind: 'map', entity: 'Datei', id: (_f, k) => k.toLowerCase(), title: (_f, k) => k, summary: ['comment', 'hash'] }]
    case 'gpos':
      return [{ path: ['gpos'], kind: 'map', entity: 'GPO-Ziel', id: (_g, k) => k.toLowerCase(), title: (g, k) => (isObj(g) && g.displayName) || shortDn(k) }]
    default:
      if (sectionKey.startsWith('adml'))
        return [{ path: ['adml', 'files'], kind: 'map', entity: 'Datei', id: (_f, k) => k.toLowerCase(), title: (_f, k) => k, summary: ['comment', 'hash'] }]
      return []
  }
}

/* ------------------------------------------------------------------ generic recursive diff */

const ID_KEYS = ['name', 'samaccountname', 'samAccountName', 'identityreference', 'ouDn', 'id', 'key']

/** Picks a key that identifies objects in both lists (present and unique everywhere). */
function identityKey(a: Json[], b: Json[]): string | null {
  const all = [...a, ...b]
  if (!all.length || !all.every(isObj)) return null
  for (const k of ID_KEYS) {
    const unique = (list: Json[]) => {
      const seen = new Set<string>()
      for (const x of list) {
        const v = x[k]
        if (typeof v !== 'string' || !v) return false
        const l = v.toLowerCase()
        if (seen.has(l)) return false
        seen.add(l)
      }
      return true
    }
    if (unique(a) && unique(b)) return k
  }
  return null
}

function itemLabel(item: Json, index: number, idKey: string | null): string {
  if (idKey && isObj(item)) return String(item[idKey])
  if (isObj(item)) for (const k of ID_KEYS) if (typeof item[k] === 'string' && item[k]) return item[k]
  return `Eintrag ${index + 1}`
}

export function diffValue(before: Json, after: Json, path: Seg[], out: FieldChange[]) {
  if (before === after) return
  if (Array.isArray(before) && Array.isArray(after)) {
    if (isScalarList(before) && isScalarList(after)) {
      const b = before.map(String)
      const a = after.map(String)
      const added = a.filter((x) => !b.includes(x))
      const removed = b.filter((x) => !a.includes(x))
      if (added.length || removed.length) out.push({ kind: 'list', path, added, removed })
      else if (a.join('\u0000') !== b.join('\u0000')) out.push({ kind: 'order', path })
      return
    }
    const idKey = identityKey(before, after)
    if (idKey) {
      const bMap = new Map(before.map((x, i) => [String(x[idKey]).toLowerCase(), { x, i }]))
      const aMap = new Map(after.map((x, i) => [String(x[idKey]).toLowerCase(), { x, i }]))
      for (const [id, { x, i }] of bMap)
        if (!aMap.has(id)) out.push({ kind: 'removed', path: [...path, { key: id, label: itemLabel(x, i, idKey) }], before: x })
      for (const [id, { x, i }] of aMap) {
        const seg = { key: id, label: itemLabel(x, i, idKey) }
        const prev = bMap.get(id)
        if (!prev) out.push({ kind: 'added', path: [...path, seg], after: x })
        else diffValue(prev.x, x, [...path, seg], out)
      }
      const orderB = before.map((x) => String(x[idKey]).toLowerCase()).filter((id) => aMap.has(id))
      const orderA = after.map((x) => String(x[idKey]).toLowerCase()).filter((id) => bMap.has(id))
      if (orderA.join('\u0000') !== orderB.join('\u0000')) out.push({ kind: 'order', path })
      return
    }
    const n = Math.max(before.length, after.length)
    for (let i = 0; i < n; i++) {
      const seg = { key: String(i), label: itemLabel(after[i] ?? before[i], i, null) }
      if (i >= before.length) out.push({ kind: 'added', path: [...path, seg], after: after[i] })
      else if (i >= after.length) out.push({ kind: 'removed', path: [...path, seg], before: before[i] })
      else diffValue(before[i], after[i], [...path, seg], out)
    }
    return
  }
  if (isObj(before) && isObj(after)) {
    for (const k of Object.keys(before))
      if (!(k in after)) out.push({ kind: 'removed', path: [...path, { key: k, label: keyLabel(k) }], before: before[k] })
    for (const k of Object.keys(after)) {
      const seg = { key: k, label: keyLabel(k) }
      if (!(k in before)) out.push({ kind: 'added', path: [...path, seg], after: after[k] })
      else diffValue(before[k], after[k], [...path, seg], out)
    }
    return
  }
  if (before !== after && !(Number.isNaN(before) && Number.isNaN(after))) out.push({ kind: 'changed', path, before, after })
}

/* ------------------------------------------------------------------ section diff */

function getPath(v: Json, path: string[]): Json {
  let cur = v
  for (const p of path) cur = isObj(cur) ? cur[p] : undefined
  return cur
}

/** Removes the collection path from a copy of the content (shallow along the path only). */
function withoutPath(v: Json, path: string[]): Json {
  if (!isObj(v) || !path.length) return v
  const [head, ...rest] = path
  if (!(head in v)) return v
  const copy = { ...v }
  if (rest.length === 0) delete copy[head]
  else copy[head] = withoutPath(copy[head], rest)
  return copy
}

function summarize(item: Json, keys: string[] | undefined): { label: string; value: string }[] {
  if (!isObj(item)) return []
  const pick = keys ?? Object.keys(item).filter((k) => item[k] !== null && typeof item[k] !== 'object').slice(0, 3)
  return pick
    .filter((k) => item[k] !== undefined && item[k] !== '' && !(Array.isArray(item[k]) && !item[k].length))
    .map((k) => ({ label: keyLabel(k), value: formatValue(item[k], 60) }))
}

export function formatValue(v: Json, max = 90): string {
  if (v === null || v === undefined || v === '') return '(leer)'
  if (typeof v === 'boolean') return v ? 'Ja' : 'Nein'
  if (typeof v === 'number') return v.toLocaleString('de-DE')
  if (Array.isArray(v)) {
    if (!v.length) return '(keine)'
    if (isScalarList(v)) return clip(v.map(String).join(', '), max)
    return `${v.length} ${v.length === 1 ? 'Eintrag' : 'Einträge'}`
  }
  if (isObj(v)) {
    const n = Object.keys(v).length
    return `${n} ${n === 1 ? 'Feld' : 'Felder'}`
  }
  const s = String(v)
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (d) return `${d[3]}.${d[2]}.${d[1]}`
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !Number.isNaN(Date.parse(s))) return new Date(s).toLocaleString('de-DE')
  return clip(s, max)
}

function clip(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export function diffSection(sectionKey: string, before: Json, after: Json): SectionDiff {
  const groups: ChangeGroup[] = []
  let added = 0
  let removed = 0
  let changed = 0
  let total = 0
  if (before === after) return { groups, added, removed, changed, total }

  const collections = collectionsFor(sectionKey)
  let restBefore = before
  let restAfter = after

  for (const c of collections) {
    const b = getPath(before, c.path)
    const a = getPath(after, c.path)
    restBefore = withoutPath(restBefore, c.path)
    restAfter = withoutPath(restAfter, c.path)
    if (b === a) continue
    const toEntries = (v: Json): [string, Json][] =>
      c.kind === 'map' ? (isObj(v) ? Object.entries(v) : []) : Array.isArray(v) ? v.map((x, i) => [String(i), x] as [string, Json]) : []
    const bEntries = toEntries(b)
    const aEntries = toEntries(a)
    const bMap = new Map<string, { item: Json; key: string }>()
    const dupCount = new Map<string, number>()
    const idOf = (item: Json, key: string) => {
      const base = c.id(item, key)
      return base
    }
    for (const [k, item] of bEntries) {
      let id = idOf(item, k)
      // duplicates (identical identity) are kept apart by occurrence
      const n = dupCount.get(id) ?? 0
      dupCount.set(id, n + 1)
      if (n) id = `${id}#${n}`
      bMap.set(id, { item, key: k })
    }
    dupCount.clear()
    const seen = new Set<string>()
    for (const [k, item] of aEntries) {
      let id = idOf(item, k)
      const n = dupCount.get(id) ?? 0
      dupCount.set(id, n + 1)
      if (n) id = `${id}#${n}`
      seen.add(id)
      const prev = bMap.get(id)
      const title = c.title(item, k)
      if (!prev) {
        groups.push({ key: `${c.entity}:${id}`, entity: c.entity, title, kind: 'added', summary: summarize(item, c.summary), fields: [] })
        added++
        total++
      } else if (prev.item !== item) {
        const fields: FieldChange[] = []
        diffValue(prev.item, item, [], fields)
        if (fields.length) {
          groups.push({ key: `${c.entity}:${id}`, entity: c.entity, title, kind: 'changed', fields })
          changed++
          total += fields.length
        }
      }
    }
    for (const [id, { item, key }] of bMap)
      if (!seen.has(id)) {
        groups.push({ key: `${c.entity}:${id}:removed`, entity: c.entity, title: c.title(item, key), kind: 'removed', summary: summarize(item, c.summary), fields: [] })
        removed++
        total++
      }
    // order of a list changed (only when nothing else explains it)
    if (c.kind === 'array' && Array.isArray(a) && Array.isArray(b) && a.length === b.length && !groups.length) {
      const ids = (list: Json[]) => list.map((x, i) => c.id(x, String(i))).join('\u0000')
      if (ids(a) !== ids(b)) {
        groups.push({ key: `${c.entity}:order`, title: keyLabel(c.path[c.path.length - 1]), kind: 'changed', fields: [{ kind: 'order', path: [] }] })
        changed++
        total++
      }
    }
  }

  // everything else: grouped by the parent object (at most two levels deep)
  const rest: FieldChange[] = []
  diffValue(restBefore, restAfter, [], rest)
  const byGroup = new Map<string, ChangeGroup>()
  for (const f of rest) {
    const depth = Math.min(f.path.length - 1, 2)
    const head = f.path.slice(0, Math.max(depth, 0))
    const key = head.map((s) => s.key).join('/') || '__root'
    let g = byGroup.get(key)
    if (!g) {
      g = { key: `settings:${key}`, title: head.map((s) => s.label).join(' › ') || 'Allgemein', kind: 'changed', fields: [] }
      byGroup.set(key, g)
    }
    g.fields.push({ ...f, path: f.path.slice(head.length) } as FieldChange)
    total++
    if (f.kind === 'added') added++
    else if (f.kind === 'removed') removed++
    else changed++
  }
  for (const g of byGroup.values()) {
    if (g.fields.every((f) => f.kind === 'added')) g.kind = 'added'
    else if (g.fields.every((f) => f.kind === 'removed')) g.kind = 'removed'
  }
  groups.push(...byGroup.values())
  return { groups, added, removed, changed, total }
}

export function pathText(path: Seg[]) {
  return path.map((s) => s.label).join(' › ')
}
