/* Pure helpers for the configuration assistants (server area, admin account, delegation).
 *
 * Everything here is free of React and path aliases (relative imports with .ts extension), so the
 * unit tests in service/web/tests can run it directly in Node. Inputs are treated as immutable:
 * every plan returns new section contents that the caller applies to the draft store in ONE step. */

import { DOMAIN, ouFullDn, ouRelativeDn, toFullDn, type OuItem } from '../../../lib/ou.ts'
import {
  aclTierIssues,
  buildGroupTierMap,
  gpoLinkTierIssues,
  numericTier,
  principalTier,
  BROAD,
  userTierIssues,
  type TierIssue,
} from '../../../lib/tier-rules.ts'
import { addTarget, GPO_KINDS, gpoList, isLinked, kindLabels, targetTitle, type GpoKind } from '../gpo-model.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Obj = Record<string, any>
export type TierNum = 0 | 1 | 2
export type SectionKey = 'ous' | 'groups' | 'users' | 'acls' | 'gpos'

/** Current (draft-aware) contents of the sections the assistants read and change. */
export interface Contents {
  ous?: Obj
  groups?: Obj
  users?: Obj
  acls?: Obj
  gpos?: Obj
}

export interface ChangeSentence {
  section: SectionKey
  text: string
}

export interface Plan {
  /** New contents per changed section – apply all of them as one undo step. */
  updated: Partial<Record<SectionKey, Obj>>
  /** Every change as a readable sentence (German). */
  sentences: ChangeSentence[]
  /** Tier-rule findings and consistency errors; any Error blocks finishing. */
  issues: TierIssue[]
}

export const hasErrors = (issues: TierIssue[]) => issues.some((i) => i.severity === 'Error')

const arr = (c: Obj | undefined, key: string): Obj[] => (Array.isArray(c?.[key]) ? c[key] : [])
export const ousOf = (c: Contents) => arr(c.ous, 'organizationUnits') as OuItem[]
export const groupsOf = (c: Contents) => arr(c.groups, 'groups')
export const usersOf = (c: Contents) => arr(c.users, 'users')
export const aclsOf = (c: Contents) => arr(c.acls, 'aclDelegations')

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase()
const shortDn = (dn: string) => (dn === DOMAIN ? 'Domänenstamm' : dn.replace(/,\{\{DOMAIN_DN\}\}$/, ''))
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

// ------------------------------------------------------------------ names & suggestions

/** "SQL Server" → "SQLServer", "web-farm 2" → "WebFarm2": words capitalised, separators removed. */
export function compactName(name: string): string {
  return name
    .split(/[^A-Za-z0-9ÄÖÜäöüß]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
}

export function suggestGroupName(tier: TierNum, area: string) {
  const a = area.trim()
  return a ? `Tier ${tier} ${a} Admins` : `Tier ${tier} Admins`
}

/** e.g. Tier 1 + "SQL Server" → Tier1SQLServerAdmins (unique against `taken`). */
export function suggestGroupSam(tier: TierNum, area: string, taken: Iterable<string> = []) {
  return uniqueName(`Tier${tier}${compactName(area)}Admins`, taken)
}

/** Appends 2, 3, … until the name is not taken (case-insensitive); respects `max` length. */
export function uniqueName(base: string, taken: Iterable<string>, max = 256) {
  const set = new Set([...taken].map(lower))
  const cut = base.slice(0, max)
  if (!set.has(lower(cut))) return cut
  for (let i = 2; i < 1000; i++) {
    const suffix = String(i)
    const candidate = base.slice(0, max - suffix.length) + suffix
    if (!set.has(lower(candidate))) return candidate
  }
  return cut
}

const ascii = (s: string) =>
  s
    .replace(/ä/gi, 'ae').replace(/ö/gi, 'oe').replace(/ü/gi, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

export const USER_SAM_MAX = 20

/** Admin account name with tier prefix: "Max Mustermann", tier 1 → "t1-mmustermann" (max. 20 characters, unique). */
export function suggestUserSam(tier: TierNum, displayName: string, taken: Iterable<string> = []) {
  const parts = displayName.trim().split(/\s+/).map(ascii).filter(Boolean)
  const prefix = `t${tier}-`
  if (!parts.length) return ''
  const body = parts.length === 1 ? parts[0] : parts[0][0] + parts[parts.length - 1]
  return uniqueName(prefix + body, taken, USER_SAM_MAX)
}

export const tierPrefix = (tier: TierNum) => `t${tier}-`

const SAM_FORBIDDEN = /[\s"/\\[\]:;|=,+*?<>@]/

export function groupSamError(sam: string, groups: Obj[]): string | null {
  const s = sam.trim()
  if (!s) return 'sAMAccountName ist erforderlich.'
  if (SAM_FORBIDDEN.test(s)) return 'Enthält unzulässige Zeichen (Leerzeichen, " / \\ [ ] : ; | = , + * ? < > @).'
  if (s.length > 256) return 'Maximal 256 Zeichen.'
  if (groups.some((g) => lower(g.samaccountname) === lower(s))) return 'Dieser sAMAccountName ist bereits vergeben.'
  return null
}

export function userSamError(sam: string, users: Obj[]): string | null {
  const s = sam.trim()
  if (!s) return 'sAMAccountName ist erforderlich.'
  if (SAM_FORBIDDEN.test(s)) return 'Enthält unzulässige Zeichen (Leerzeichen, " / \\ [ ] : ; | = , + * ? < > @).'
  if (s.length > USER_SAM_MAX) return `Maximal ${USER_SAM_MAX} Zeichen.`
  if (users.some((u) => lower(u.samAccountName) === lower(s))) return 'Dieser sAMAccountName ist bereits vergeben.'
  return null
}

export function ouNameError(name: string): string | null {
  const n = name.trim()
  if (!n) return 'Name ist erforderlich.'
  if (/[,=+<>#;\\"]/.test(n)) return 'Name darf keine Sonderzeichen wie , = + < > # ; \\ " enthalten.'
  if (n.length > 64) return 'Maximal 64 Zeichen.'
  return null
}

// ------------------------------------------------------------------ OUs of a tier

/** Full DNs of the configured OUs that belong to `tier` (detected from the DN). */
export function tierOus(ous: OuItem[], tier: TierNum): { ou: OuItem; dn: string; rel: string }[] {
  return ous
    .map((ou) => ({ ou, dn: ouFullDn(ou), rel: ouRelativeDn(ou) }))
    .filter((x) => numericTier(x.dn) === tier)
}

const inAdminArea = (dn: string) => /OU=Tier Model Administration/i.test(dn)

/** Parent for new server areas (relative DN): the tier's member-server OU, else a server/devices OU. */
export function defaultServerParent(ous: OuItem[], tier: TierNum): string {
  const list = tierOus(ous, tier).filter((x) => !inAdminArea(x.dn) && !/staging|disabled/i.test(x.ou.name))
  const pick =
    list.find((x) => /member\s*servers?/i.test(x.ou.name)) ??
    list.find((x) => /server/i.test(x.ou.name)) ??
    list.find((x) => /devices?|computers?/i.test(x.ou.name)) ??
    list.find((x) => !x.ou.path || x.ou.path === DOMAIN) ??
    list[0]
  return pick ? pick.rel : ''
}

function adminAreaOu(ous: OuItem[], tier: TierNum, re: RegExp, exclude: RegExp): string {
  const list = tierOus(ous, tier)
  const pick =
    list.find((x) => inAdminArea(x.dn) && re.test(x.ou.name) && !exclude.test(x.ou.name)) ??
    list.find((x) => re.test(x.ou.name) && !exclude.test(x.ou.name))
  return pick ? pick.dn : ''
}

/** Full DN of the tier's admin accounts OU ("Tier 1 Accounts"), '' if none. */
export const defaultAccountsOu = (ous: OuItem[], tier: TierNum) => adminAreaOu(ous, tier, /accounts?/i, /service|vpn|end-?user|disabled/i)

/** Full DN of the tier's groups OU ("Tier 1 Groups"), '' if none. */
export const defaultGroupsOu = (ous: OuItem[], tier: TierNum) => adminAreaOu(ous, tier, /groups?/i, /end-?user|distribution|security groups/i)

// ------------------------------------------------------------------ ACL templates

export interface AclTemplate {
  objecttype: string
  activedirectoryrights: string[]
  activeDirectorysecurityinheritance: string
  inheritedObjectType?: string
}

export interface RightsPreset {
  id: string
  label: string
  description: string
  entries: AclTemplate[]
}

/** Presets for the server-area assistant (possibly several entries). */
export const SERVER_RIGHTS_PRESETS: RightsPreset[] = [
  {
    id: 'full',
    label: 'Vollzugriff auf Computerobjekte',
    description: 'Computer und Unter-OUs anlegen, verwalten und löschen – wie Tier0Admins auf den Tier-0-Servern.',
    entries: [
      { objecttype: 'Computer', activedirectoryrights: ['GenericAll', 'CreateChild', 'DeleteChild'], activeDirectorysecurityinheritance: 'Descendents' },
      { objecttype: 'OrganizationalUnit', activedirectoryrights: ['GenericAll', 'CreateChild', 'DeleteChild'], activeDirectorysecurityinheritance: 'All' },
    ],
  },
  {
    id: 'join',
    label: 'Nur Domänenbeitritt',
    description: 'Computerobjekte anlegen und löschen, z. B. beim Domänenbeitritt – keine weitere Verwaltung.',
    entries: [{ objecttype: 'Computer', activedirectoryrights: ['CreateChild', 'DeleteChild'], activeDirectorysecurityinheritance: 'SelfAndChildren' }],
  },
]

/** Single-entry presets for the delegation assistant. */
export const DELEGATION_PRESETS: RightsPreset[] = [
  { id: 'computer-full', label: 'Computerobjekte vollständig verwalten', description: 'Vollzugriff auf alle Computer unterhalb der OU.', entries: [{ objecttype: 'Computer', activedirectoryrights: ['GenericAll'], activeDirectorysecurityinheritance: 'Descendents' }] },
  { id: 'computer-join', label: 'Computer anlegen und löschen (Domänenbeitritt)', description: 'Computerobjekte in der OU erstellen und entfernen.', entries: [{ objecttype: 'Computer', activedirectoryrights: ['CreateChild', 'DeleteChild'], activeDirectorysecurityinheritance: 'SelfAndChildren' }] },
  { id: 'user-full', label: 'Benutzerkonten vollständig verwalten', description: 'Vollzugriff auf alle Benutzer unterhalb der OU.', entries: [{ objecttype: 'User', activedirectoryrights: ['GenericAll'], activeDirectorysecurityinheritance: 'Descendents' }] },
  { id: 'user-create', label: 'Benutzer anlegen und löschen', description: 'Benutzerobjekte in der OU erstellen und entfernen.', entries: [{ objecttype: 'User', activedirectoryrights: ['CreateChild', 'DeleteChild'], activeDirectorysecurityinheritance: 'SelfAndChildren' }] },
  { id: 'password-reset', label: 'Kennwörter zurücksetzen', description: 'Erweitertes Recht „Kennwort zurücksetzen“ auf Nachfolgeobjekte.', entries: [{ objecttype: 'PasswordReset', activedirectoryrights: ['ExtendedRight'], activeDirectorysecurityinheritance: 'Descendents' }] },
  { id: 'unlock', label: 'Konten entsperren', description: 'Sperrzeit (lockoutTime) lesen und schreiben.', entries: [{ objecttype: 'LockoutTime', activedirectoryrights: ['ReadProperty', 'WriteProperty'], activeDirectorysecurityinheritance: 'Descendents' }] },
  { id: 'group-full', label: 'Gruppen vollständig verwalten', description: 'Vollzugriff auf alle Gruppen unterhalb der OU.', entries: [{ objecttype: 'Group', activedirectoryrights: ['GenericAll'], activeDirectorysecurityinheritance: 'Descendents' }] },
  { id: 'ou-manage', label: 'Unter-OUs anlegen und löschen', description: 'Organisationseinheiten in der OU erstellen und entfernen.', entries: [{ objecttype: 'OrganizationalUnit', activedirectoryrights: ['CreateChild', 'DeleteChild'], activeDirectorysecurityinheritance: 'SelfAndChildren' }] },
]

export const CUSTOM_PRESET = 'custom'

/** The preset whose (single) entry equals the given values, else 'custom'. */
export function matchPreset(v: AclTemplate): string {
  const key = (tx: AclTemplate) => [lower(tx.objecttype), [...tx.activedirectoryrights].map(lower).sort().join('+'), lower(tx.activeDirectorysecurityinheritance), lower(tx.inheritedObjectType)].join('|')
  const k = key(v)
  return DELEGATION_PRESETS.find((p) => p.entries.length === 1 && key(p.entries[0]) === k)?.id ?? CUSTOM_PRESET
}

export const INHERITANCE_LABELS: Record<string, string> = {
  None: 'Nur diese OU',
  All: 'Diese OU und alle Nachfolger',
  Descendents: 'Nur Nachfolger',
  SelfAndChildren: 'Diese OU und direkte Kinder',
  Children: 'Nur direkte Kinder',
}

export const OBJECT_TYPE_LABELS: Record<string, string> = {
  Computer: 'Computerobjekte',
  User: 'Benutzerobjekte',
  Group: 'Gruppenobjekte',
  OrganizationalUnit: 'Organisationseinheiten',
  Contact: 'Kontakte',
  AllObjectClasses: 'alle Objektklassen',
  PasswordReset: 'Kennwort zurücksetzen',
}

export const objectTypeText = (tx: string | undefined) => (tx ? (OBJECT_TYPE_LABELS[tx] ?? tx) : 'alle Objekte')

/** One ACL delegation in the key order of tiermodel-acls.json. */
export function buildAcl(opts: {
  target: string
  principal: string
  template: AclTemplate
  allow?: boolean
  comment?: string
}): Obj {
  const tx = opts.template
  const acl: Obj = {
    targetOUPath: opts.target,
    identityreference: opts.principal.trim(),
    activedirectoryrights: [...tx.activedirectoryrights],
    accesscontroltype: opts.allow === false ? 'Deny' : 'Allow',
    objecttype: tx.objecttype,
    activeDirectorysecurityinheritance: tx.activeDirectorysecurityinheritance,
  }
  if (tx.inheritedObjectType) acl.inheritedObjectType = tx.inheritedObjectType
  acl.resolveguid = false
  acl.comment = opts.comment ?? ''
  return acl
}

export function aclSentence(a: Obj): string {
  const verb = a.accesscontroltype === 'Deny' ? 'wird verweigert' : 'erhält'
  const rights = (a.activedirectoryrights as string[]).join(', ')
  const inh = INHERITANCE_LABELS[a.activeDirectorysecurityinheritance] ?? a.activeDirectorysecurityinheritance
  return `„${a.identityreference}“ ${verb} ${rights} auf ${objectTypeText(a.objecttype)} in „${shortDn(a.targetOUPath)}“ (Vererbung: ${inh}).`
}

const sameAcl = (a: Obj, b: Obj) =>
  lower(a.targetOUPath) === lower(b.targetOUPath) &&
  lower(a.identityreference) === lower(b.identityreference) &&
  lower(a.objecttype) === lower(b.objecttype) &&
  lower(a.accesscontroltype) === lower(b.accesscontroltype) &&
  lower(a.activeDirectorysecurityinheritance) === lower(b.activeDirectorysecurityinheritance) &&
  lower(a.inheritedObjectType ?? a.inheritedobjecttype) === lower(b.inheritedObjectType ?? b.inheritedobjecttype) &&
  [...(a.activedirectoryrights ?? [])].map(lower).sort().join() === [...(b.activedirectoryrights ?? [])].map(lower).sort().join()

// ------------------------------------------------------------------ GPO links

export interface GpoLink {
  name: string
  kind: GpoKind
  linkOrder: number
  linkEnabled: boolean
  entry: Obj
}

export interface GpoSource {
  key: string
  title: string
  links: GpoLink[]
  /** Sibling of the new OU (same parent) or the parent itself. */
  near: boolean
  staging: boolean
}

/** Links of one GPO target in link order (both lists). */
export function targetLinks(target: Obj | undefined): GpoLink[] {
  const out: GpoLink[] = []
  for (const kind of GPO_KINDS)
    for (const g of gpoList(target, kind))
      if (g?.name) out.push({ name: String(g.name), kind, linkOrder: typeof g.linkOrder === 'number' ? g.linkOrder : 999, linkEnabled: !!g.linkEnabled, entry: g })
  return out.sort((a, b) => a.linkOrder - b.linkOrder)
}

/**
 * GPO targets of the same tier as templates for a new OU below `parentRel` (relative DN):
 * siblings and the parent first, staging targets last.
 */
export function gpoSources(gpos: Obj | undefined, tier: TierNum, parentRel: string): GpoSource[] {
  const map = (gpos?.gpos ?? {}) as Obj
  const parentFull = lower(toFullDn(parentRel || DOMAIN))
  const out: GpoSource[] = []
  for (const [key, tx] of Object.entries(map)) {
    if (!isLinked(key) || numericTier(key) !== tier) continue
    const links = targetLinks(tx)
    if (!links.length) continue
    const k = lower(key)
    const parentOfKey = k.slice(k.indexOf(',') + 1)
    const near = k === parentFull || parentOfKey === parentFull
    out.push({ key, title: targetTitle(key, tx), links, near, staging: /staging/i.test(key.split(',')[0]) })
  }
  const rank = (s: GpoSource) => (s.staging ? 2 : 0) + (s.near ? 0 : 1) + (inAdminArea(s.key) ? 2 : 0)
  return out.sort((a, b) => rank(a) - rank(b))
}

/** Default template: the first non-staging source (siblings / parent preferred). */
export function defaultGpoSource(sources: GpoSource[], staging = false): GpoSource | undefined {
  return sources.find((s) => s.staging === staging) ?? (staging ? undefined : sources[0])
}

/** All GPO names usable for the tier with the source they come from (first occurrence wins). */
export function gpoNameCatalog(sources: GpoSource[]): Map<string, { link: GpoLink; source: GpoSource }> {
  const m = new Map<string, { link: GpoLink; source: GpoSource }>()
  for (const s of sources) for (const l of s.links) if (!m.has(lower(l.name))) m.set(lower(l.name), { link: l, source: s })
  return m
}

/**
 * Builds a GPO target linking the given GPO names (in the given order = link order 1..n). Each entry is
 * copied from `preferred` when it has the GPO, else from the first source that has it, and keeps its list
 * (ImportOnlyGpo / PostConfigureGpo) as the source uses it.
 */
export function buildGpoTarget(names: string[], sources: GpoSource[], preferred?: string): { target: Obj; links: GpoLink[] } {
  const catalog = gpoNameCatalog(sources)
  const pref = sources.find((s) => s.key === preferred)
  const links: GpoLink[] = []
  names.forEach((name) => {
    const hit = pref?.links.find((l) => lower(l.name) === lower(name)) ?? catalog.get(lower(name))?.link
    if (!hit) return
    const entry = { ...clone(hit.entry), linkOrder: links.length + 1 }
    links.push({ ...hit, linkOrder: links.length + 1, entry })
  })
  const target: Obj = {}
  for (const kind of GPO_KINDS) target[kind] = links.filter((l) => l.kind === kind).map((l) => l.entry)
  return { target, links }
}

// ------------------------------------------------------------------ plan: server area

export interface ServerAreaInput {
  tier: TierNum
  name: string
  /** Parent OU, relative DN (as used by `path` in tiermodel-ous.json) or {{DOMAIN_DN}}. */
  parentPath: string
  staging: boolean
  groupName: string
  groupSam: string
  groupDescription: string
  /** Full DN of the OU the admin group is created in. */
  groupOu: string
  presetId: string
  /** GPO names to link to the new OU, in link order. */
  gpoNames: string[]
  gpoSourceKey?: string
}

export const stagingName = (name: string) => `${name.trim()} Staging`

export function serverAreaDns(input: Pick<ServerAreaInput, 'name' | 'parentPath'>) {
  const ou: OuItem = { name: input.name.trim(), path: input.parentPath || DOMAIN }
  const dn = ouFullDn(ou)
  const stagingDn = ouFullDn({ name: stagingName(input.name), path: ouRelativeDn(ou) })
  return { ou, dn, rel: ouRelativeDn(ou), stagingDn }
}

export function buildServerAreaPlan(contents: Contents, input: ServerAreaInput): Plan {
  const ous = ousOf(contents)
  const groups = groupsOf(contents)
  const sentences: ChangeSentence[] = []
  const issues: TierIssue[] = []
  const updated: Plan['updated'] = {}
  const tx = input.tier
  const name = input.name.trim()
  const { dn, rel } = serverAreaDns(input)

  // ---- consistency
  const nameErr = ouNameError(name)
  if (nameErr) issues.push({ severity: 'Error', message: `OU-Name: ${nameErr}` })
  const parentFull = lower(toFullDn(input.parentPath || DOMAIN))
  if (input.parentPath && input.parentPath !== DOMAIN && !ous.some((o) => lower(ouFullDn(o)) === parentFull))
    issues.push({ severity: 'Error', message: `Die übergeordnete OU „${shortDn(toFullDn(input.parentPath))}“ existiert nicht in der Konfiguration.` })
  if (ous.some((o) => lower(ouFullDn(o)) === lower(dn))) issues.push({ severity: 'Error', message: `Die OU „${shortDn(dn)}“ existiert bereits.` })
  const ouTier = numericTier(dn)
  if (name && ouTier !== tx)
    issues.push({
      severity: 'Error',
      message: `Die neue OU „${shortDn(dn)}“ gehört ${ouTier === null ? 'zu keinem Tier' : `zu Tier ${ouTier}`}, gewählt ist aber Tier ${tx}. Wählen Sie eine übergeordnete OU aus Tier ${tx}.`,
    })
  if (tx === 0)
    issues.push({
      severity: 'Warning',
      message: 'Tier 0 ist die höchste Schutzstufe: Server hier können die gesamte Domäne kontrollieren. Nur Systeme wie PKI, ADFS oder Identitätssynchronisation gehören in Tier 0.',
    })
  const samErr = groupSamError(input.groupSam, groups)
  if (samErr) issues.push({ severity: 'Error', message: `Admin-Gruppe: ${samErr}` })
  if (!input.groupName.trim()) issues.push({ severity: 'Error', message: 'Admin-Gruppe: Name ist erforderlich.' })
  if (!input.groupOu.trim()) issues.push({ severity: 'Error', message: 'Admin-Gruppe: Ziel-OU ist erforderlich.' })
  else {
    const gt = numericTier(input.groupOu)
    if (gt !== tx) issues.push({ severity: 'Warning', message: `Die Admin-Gruppe wird in „${shortDn(input.groupOu)}“ angelegt – ${gt === null ? 'keinem Tier zugeordnet' : `Tier ${gt}`}, nicht Tier ${tx}.` })
  }

  // ---- ous
  const newOus: OuItem[] = [
    { name, path: input.parentPath || DOMAIN, protectFromAccidentalDeletion: true, disableInheritance: false, blockGpoInheritance: input.gpoNames.length > 0, comment: `Tier ${tx}: ${name} server objects` },
  ]
  sentences.push({ section: 'ous', text: `OU „${name}“ wird unter „${shortDn(toFullDn(input.parentPath || DOMAIN))}“ angelegt (Tier ${tx}${input.gpoNames.length ? ', GPO-Vererbung blockiert' : ''}).` })
  if (input.staging) {
    newOus.push({ name: stagingName(name), path: rel, protectFromAccidentalDeletion: true, disableInheritance: false, blockGpoInheritance: true, comment: `Tier ${tx}: ${name} staging server objects` })
    sentences.push({ section: 'ous', text: `Staging-OU „${stagingName(name)}“ wird unter „${name}“ angelegt (GPO-Vererbung blockiert).` })
  }
  updated.ous = { ...(contents.ous ?? {}), organizationUnits: [...ous, ...newOus] }

  // ---- groups
  const group: Obj = {
    name: input.groupName.trim(),
    samaccountname: input.groupSam.trim(),
    description: input.groupDescription.trim() || `Members of this group administer the Tier ${tx} ${name} servers`,
    groupscope: 'Global',
    groupcategory: 'Security',
    path: input.groupOu,
    comment: `Created by the server area assistant for OU=${name}`,
  }
  updated.groups = { ...(contents.groups ?? {}), groups: [...groups, group] }
  sentences.push({ section: 'groups', text: `Gruppe „${group.name}“ (${group.samaccountname}) wird in „${shortDn(input.groupOu)}“ angelegt – global, Sicherheit.` })

  // ---- acls
  const preset = SERVER_RIGHTS_PRESETS.find((p) => p.id === input.presetId) ?? SERVER_RIGHTS_PRESETS[0]
  const newAcls = preset.entries.map((template) =>
    buildAcl({ target: dn, principal: group.samaccountname, template, comment: `Grant ${group.samaccountname} ${preset.id === 'join' ? 'domain join rights' : 'full control'} over ${template.objecttype} objects in OU=${name}` }),
  )
  updated.acls = { ...(contents.acls ?? {}), aclDelegations: [...aclsOf(contents), ...newAcls] }
  newAcls.forEach((a) => sentences.push({ section: 'acls', text: aclSentence(a) }))

  // ---- gpos
  if (input.gpoNames.length) {
    const sources = gpoSources(contents.gpos, tx, input.parentPath)
    const { target, links } = buildGpoTarget(input.gpoNames, sources, input.gpoSourceKey)
    const map = (contents.gpos?.gpos ?? {}) as Obj
    if (Object.keys(map).some((k) => lower(k) === lower(dn))) issues.push({ severity: 'Error', message: `Für „${shortDn(dn)}“ gibt es bereits GPO-Verknüpfungen.` })
    const missing = input.gpoNames.filter((n) => !links.some((l) => lower(l.name) === lower(n)))
    if (missing.length) issues.push({ severity: 'Error', message: `Unbekannte GPO: ${missing.map((m) => `„${m}“`).join(', ')}.` })
    updated.gpos = addTarget(contents.gpos ?? { gpos: {} }, dn, target)
    links.forEach((l) =>
      sentences.push({ section: 'gpos', text: `GPO „${l.name}“ wird mit „${name}“ verknüpft (Reihenfolge ${l.linkOrder}, ${kindLabels[l.kind]}, Link ${l.linkEnabled ? 'aktiv' : 'deaktiviert'}).` }),
    )
    for (const l of links) issues.push(...gpoLinkTierIssues(l.name, dn))
  }

  // ---- tier rules (with the new group known)
  const tierMap = buildGroupTierMap([...groups, group])
  for (const a of newAcls) issues.push(...aclTierIssues(a, tierMap))
  return { updated, sentences, issues: dedupe(issues) }
}

// ------------------------------------------------------------------ plan: admin account

export const PROTECTED_USERS = 'Protected Users'

export interface AdminAccountInput {
  tier: TierNum
  samAccountName: string
  displayName: string
  description: string
  ouPath: string
  memberOf: string[]
  protectedUsers: boolean
  enabled: boolean
}

export function buildAdminUser(input: AdminAccountInput): Obj {
  const memberOf = input.memberOf.filter((g) => lower(g) !== lower(PROTECTED_USERS))
  if (input.protectedUsers) memberOf.push(PROTECTED_USERS)
  return {
    samAccountName: input.samAccountName.trim(),
    displayName: input.displayName.trim() || input.samAccountName.trim(),
    ouPath: input.ouPath,
    description: input.description.trim(),
    enabled: input.enabled,
    memberOf,
  }
}

export function buildAdminAccountPlan(contents: Contents, input: AdminAccountInput): Plan {
  const users = usersOf(contents)
  const issues: TierIssue[] = []
  const user = buildAdminUser(input)
  const samErr = userSamError(user.samAccountName, users)
  if (samErr) issues.push({ severity: 'Error', message: `sAMAccountName: ${samErr}` })
  if (!input.ouPath.trim()) issues.push({ severity: 'Error', message: 'Ziel-OU ist erforderlich.' })
  else {
    const ot = numericTier(input.ouPath)
    if (ot !== input.tier)
      issues.push({ severity: 'Error', message: `Die Ziel-OU „${shortDn(input.ouPath)}“ gehört ${ot === null ? 'zu keinem Tier' : `zu Tier ${ot}`} – Konten für Tier ${input.tier} gehören in eine Tier-${input.tier}-OU.` })
    else if (!ousOf(contents).some((o) => lower(ouFullDn(o)) === lower(input.ouPath)))
      issues.push({ severity: 'Warning', message: `Die Ziel-OU „${shortDn(input.ouPath)}“ ist nicht in der Konfiguration enthalten.` })
  }
  const prefix = tierPrefix(input.tier)
  if (user.samAccountName && !user.samAccountName.toLowerCase().startsWith(prefix))
    issues.push({ severity: 'Warning', message: `Namenskonvention: Admin-Konten für Tier ${input.tier} beginnen üblicherweise mit „${prefix}“.` })
  if (!input.protectedUsers && input.tier < 2)
    issues.push({ severity: 'Warning', message: `Tier-${input.tier}-Admin-Konten sollten Mitglied von „Protected Users“ sein (kein NTLM, keine Delegierung, kurze Kerberos-Tickets).` })
  issues.push(...userTierIssues(user, buildGroupTierMap(groupsOf(contents))))

  const sentences: ChangeSentence[] = [
    { section: 'users', text: `Konto „${user.samAccountName}“ (${user.displayName}) wird in „${shortDn(user.ouPath)}“ angelegt – ${user.enabled ? 'aktiviert' : 'deaktiviert'}.` },
  ]
  if (user.memberOf.length) sentences.push({ section: 'users', text: `„${user.samAccountName}“ wird Mitglied von ${user.memberOf.map((g: string) => `„${g}“`).join(', ')}.` })
  else sentences.push({ section: 'users', text: `„${user.samAccountName}“ erhält keine Gruppenmitgliedschaften.` })
  return {
    updated: { users: { ...(contents.users ?? {}), users: [...users, user] } },
    sentences,
    issues: dedupe(issues),
  }
}

// ------------------------------------------------------------------ plan: delegation

export interface DelegationInput {
  principal: string
  rights: string[]
  objecttype: string
  inheritedObjectType: string
  target: string
  inheritance: string
  allow: boolean
  comment: string
}

export function buildDelegationAcl(input: DelegationInput): Obj {
  return buildAcl({
    target: input.target,
    principal: input.principal,
    allow: input.allow,
    comment: input.comment.trim(),
    template: {
      objecttype: input.objecttype,
      activedirectoryrights: input.rights,
      activeDirectorysecurityinheritance: input.inheritance,
      inheritedObjectType: input.inheritedObjectType || undefined,
    },
  })
}

export function delegationIssues(contents: Contents, input: DelegationInput): TierIssue[] {
  const issues: TierIssue[] = []
  if (!input.principal.trim()) issues.push({ severity: 'Error', message: 'Wer: Ein Prinzipal ist erforderlich.' })
  if (!input.rights.length) issues.push({ severity: 'Error', message: 'Was: Mindestens ein Recht auswählen.' })
  if (!input.target.trim()) issues.push({ severity: 'Error', message: 'Wo: Eine Ziel-OU ist erforderlich.' })
  if (issues.length) return issues
  const acl = buildDelegationAcl(input)
  if (aclsOf(contents).some((a) => sameAcl(a, acl))) issues.push({ severity: 'Error', message: 'Eine identische Delegation existiert bereits.' })
  issues.push(...aclTierIssues(acl, buildGroupTierMap(groupsOf(contents))))
  if (input.allow && input.rights.some((r) => lower(r) === 'genericall') && input.target === DOMAIN)
    issues.push({ severity: 'Warning', message: 'Vollzugriff auf den Domänenstamm entspricht praktisch Domänen-Admin-Rechten.' })
  return dedupe(issues)
}

export function buildDelegationPlan(contents: Contents, input: DelegationInput): Plan {
  const acl = buildDelegationAcl(input)
  return {
    updated: { acls: { ...(contents.acls ?? {}), aclDelegations: [...aclsOf(contents), acl] } },
    sentences: [{ section: 'acls', text: aclSentence(acl) }],
    issues: delegationIssues(contents, input),
  }
}

/** Plain-language explanation of the delegation tier rule for a principal/target pair. */
export function delegationTierExplanation(contents: Contents, principal: string, target: string): string | null {
  const p = principalTier(principal, buildGroupTierMap(groupsOf(contents)))
  const tx = target === DOMAIN || /^OU=Domain Controllers,/i.test(target) ? 0 : numericTier(target)
  if (!principal.trim() || !target.trim()) return null
  const pt = p === null ? 'keinem Tier zugeordnet' : p === BROAD ? 'eine breite Gruppe (unterhalb aller Tiers)' : `Tier ${p}`
  const tt = tx === null ? 'keinem Tier zugeordnet' : `Tier ${tx}`
  if (p === null || tx === null) return `Prinzipal: ${pt}, Ziel-OU: ${tt}. Ohne eindeutiges Tier ist keine automatische Prüfung möglich – prüfen Sie die Zuordnung selbst.`
  if (p <= tx) return `Prinzipal: ${pt}, Ziel-OU: ${tt}. Zulässig – Kontrolle fließt nur vom gleichen oder einem höheren Tier nach unten.`
  return `Prinzipal: ${pt}, Ziel-OU: ${tt}. Schreibrechte würden einem weniger geschützten Tier die Kontrolle über ein höheres geben. Nur Leserechte oder Verweigern sind hier zulässig.`
}

function dedupe(issues: TierIssue[]): TierIssue[] {
  const seen = new Set<string>()
  return issues
    .filter((i) => (seen.has(i.message) ? false : (seen.add(i.message), true)))
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'Error' ? -1 : 1))
}
