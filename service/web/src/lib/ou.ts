/* Helpers around OU distinguished names as used by tiermodel-ous.json.
 *
 * In tiermodel-ous.json the `path` of an OU is its PARENT and is either exactly
 * `{{DOMAIN_DN}}` (top-level) or a RELATIVE DN without the domain suffix
 * (e.g. `OU=Tier 0,OU=Tier Model Administration`). All other sections reference
 * OUs by FULL DN including `,{{DOMAIN_DN}}`.
 */

export const DOMAIN = '{{DOMAIN_DN}}'

export interface OuItem {
  name: string
  path: string
  protectFromAccidentalDeletion?: boolean
  disableInheritance?: boolean
  blockGpoInheritance?: boolean
  comment?: string
  [k: string]: unknown
}

/** Relative DN of an OU (as used as `path` by its children). */
export function ouRelativeDn(ou: Pick<OuItem, 'name' | 'path'>) {
  const p = (ou.path ?? '').trim()
  return !p || p === DOMAIN ? `OU=${ou.name}` : `OU=${ou.name},${p}`
}

/** Full DN of an OU, always ending in {{DOMAIN_DN}}. */
export function ouFullDn(ou: Pick<OuItem, 'name' | 'path'>) {
  return toFullDn(ouRelativeDn(ou))
}

export function toFullDn(dn: string) {
  const d = dn.trim()
  if (!d) return DOMAIN
  if (d === DOMAIN || d.endsWith(',' + DOMAIN)) return d
  return `${d},${DOMAIN}`
}

export function toRelativeDn(fullDn: string) {
  if (fullDn === DOMAIN) return DOMAIN
  return fullDn.endsWith(',' + DOMAIN) ? fullDn.slice(0, -(DOMAIN.length + 1)) : fullDn
}

const norm = (s: string) => s.toLowerCase()

/** Built-in targets that are valid although not listed in the ous section. */
export const builtinTargets = [DOMAIN, `OU=Domain Controllers,${DOMAIN}`]

export function ouDnOptions(ous: OuItem[]) {
  const list = ous.map((o) => ({ value: ouFullDn(o), label: o.name }))
  return [
    { value: DOMAIN, label: 'Domänenstamm' },
    { value: `OU=Domain Controllers,${DOMAIN}`, label: 'Domain Controllers' },
    ...list.sort((a, b) => a.value.split(',').reverse().join(',').localeCompare(b.value.split(',').reverse().join(','))),
  ]
}

/** Parent path options for the ous section (relative form). */
export function ouParentOptions(ous: OuItem[], excludeFullDn?: string) {
  const opts = [{ value: DOMAIN, label: 'Domänenstamm', hint: DOMAIN }]
  for (const o of ous) {
    const full = ouFullDn(o)
    if (excludeFullDn && (full === excludeFullDn || full.endsWith(',' + excludeFullDn))) continue
    opts.push({ value: ouRelativeDn(o), label: o.name, hint: ouRelativeDn(o) })
  }
  return opts
}

export interface OuTreeNode {
  ou: OuItem
  index: number
  dn: string
  children: OuTreeNode[]
}

export function buildOuTree(ous: OuItem[]): { roots: OuTreeNode[]; orphans: OuTreeNode[] } {
  const nodes = ous.map((ou, index) => ({ ou, index, dn: norm(ouFullDn(ou)), children: [] as OuTreeNode[] }))
  const byDn = new Map(nodes.map((n) => [n.dn, n]))
  const roots: OuTreeNode[] = []
  const orphans: OuTreeNode[] = []
  for (const n of nodes) {
    const parent = norm(toFullDn(n.ou.path || DOMAIN))
    if (parent === norm(DOMAIN)) roots.push(n)
    else {
      const p = byDn.get(parent)
      if (p && p !== n) p.children.push(n)
      else orphans.push(n)
    }
  }
  const sort = (arr: OuTreeNode[]) => {
    arr.sort((a, b) => a.ou.name.localeCompare(b.ou.name, 'de'))
    arr.forEach((c) => sort(c.children))
  }
  sort(roots)
  return { roots, orphans }
}

/** Replace a DN prefix (the OU itself or anything below it). Returns null if unaffected. */
export function rebaseDn(dn: string, oldFull: string, newFull: string): string | null {
  if (typeof dn !== 'string') return null
  const d = dn.trim()
  const lo = norm(d)
  const o = norm(oldFull)
  if (lo === o) return newFull
  if (lo.endsWith(',' + o)) return d.slice(0, d.length - oldFull.length) + newFull
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

export interface RenameChange {
  section: string
  label: string
  field: string
  before: string
  after: string
}

/**
 * Computes all reference updates caused by renaming the OU at `index` to `newName` and/or
 * moving it below `newPath` (its new parent, relative form or {{DOMAIN_DN}}).
 * Returns updated contents per section key (only for sections that change).
 */
export function planOuRename(
  contents: Record<string, Json>,
  index: number,
  newName: string,
  newPath?: string,
): { changes: RenameChange[]; updated: Record<string, Json>; conflicts: string[] } {
  const ousContent = contents.ous
  const ous: OuItem[] = ousContent?.organizationUnits ?? []
  const target = ous[index]
  const path = newPath ?? target.path
  const oldFull = ouFullDn(target)
  const newFull = ouFullDn({ ...target, name: newName, path })
  const changes: RenameChange[] = []
  const conflicts: string[] = []
  const parentFull = toFullDn(path).toLowerCase()
  if (parentFull === oldFull.toLowerCase() || parentFull.endsWith(',' + oldFull.toLowerCase()))
    conflicts.push('Eine OU kann nicht unter sich selbst oder eine ihrer Unter-OUs verschoben werden.')
  const updated: Record<string, Json> = {}

  const clone = (v: Json) => JSON.parse(JSON.stringify(v))

  // ous: the OU itself + child paths (relative form)
  {
    const c = clone(ousContent)
    c.organizationUnits[index].name = newName
    if (newName !== target.name) changes.push({ section: 'ous', label: target.name, field: 'name', before: target.name, after: newName })
    if (path !== target.path) {
      c.organizationUnits[index].path = path
      changes.push({ section: 'ous', label: newName, field: 'path', before: target.path, after: path })
    }
    c.organizationUnits.forEach((o: OuItem, i: number) => {
      if (i === index || !o.path || o.path === DOMAIN) return
      const r = rebaseDn(toFullDn(o.path), oldFull, newFull)
      if (r) {
        const nextPath = toRelativeDn(r)
        changes.push({ section: 'ous', label: o.name, field: 'path', before: o.path, after: nextPath })
        o.path = nextPath
      }
    })
    updated.ous = c
  }

  const arraySections: { key: string; list: string; fields: string[]; labelOf: (x: Json) => string }[] = [
    { key: 'groups', list: 'groups', fields: ['path'], labelOf: (x) => x.samaccountname ?? x.name },
    { key: 'users', list: 'users', fields: ['ouPath', 'path'], labelOf: (x) => x.samAccountName ?? x.displayName },
    { key: 'acls', list: 'aclDelegations', fields: ['targetOUPath'], labelOf: (x) => `${x.identityreference} → ${x.objecttype || '—'}` },
    { key: 'msa', list: 'aclDelegations', fields: ['targetOUPath'], labelOf: (x) => `${x.identityreference} → ${x.objecttype || '—'}` },
    { key: 'gmsa', list: 'aclDelegations', fields: ['targetOUPath'], labelOf: (x) => `${x.identityreference} → ${x.objecttype || '—'}` },
    { key: 'dmsa', list: 'aclDelegations', fields: ['targetOUPath'], labelOf: (x) => `${x.identityreference} → ${x.objecttype || '—'}` },
    { key: 'winlaps', list: 'winLapsDelegations', fields: ['ouDn'], labelOf: (x) => x.readGroup ?? x.ouDn },
  ]
  for (const s of arraySections) {
    const src = contents[s.key]
    if (!src || !Array.isArray(src[s.list])) continue
    const c = clone(src)
    let touched = false
    c[s.list].forEach((item: Json) => {
      for (const f of s.fields) {
        const v = item[f]
        if (typeof v !== 'string') continue
        const r = rebaseDn(v, oldFull, newFull)
        if (r && r !== v) {
          changes.push({ section: s.key, label: s.labelOf(item), field: f, before: v, after: r })
          item[f] = r
          touched = true
        }
      }
    })
    if (touched) updated[s.key] = c
  }

  // gpos: object keys are OU DNs — rebuild preserving key order
  const gpos = contents.gpos
  if (gpos && gpos.gpos && typeof gpos.gpos === 'object') {
    const c = clone(gpos)
    const next: Record<string, Json> = {}
    let touched = false
    for (const [k, v] of Object.entries(c.gpos)) {
      const r = rebaseDn(k, oldFull, newFull)
      if (r && r !== k) {
        // Another GPO target already uses the new DN and is not itself renamed: merging would lose one of them.
        const occupant = r in c.gpos ? rebaseDn(r, oldFull, newFull) : null
        if (r in c.gpos && (!occupant || occupant === r)) conflicts.push(`GPO-Verknüpfungsziel „${r}“ existiert bereits.`)
        changes.push({ section: 'gpos', label: (v as Json)?.displayName ?? k, field: 'Schlüssel', before: k, after: r })
        next[r] = v
        touched = true
      } else next[k] = v
    }
    if (touched) {
      c.gpos = next
      updated.gpos = c
    }
  }

  return { changes, updated, conflicts }
}
