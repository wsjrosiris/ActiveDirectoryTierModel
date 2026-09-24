import type { DeployPlan, PlanAction, PlanDetailValue } from '@/api/types'

/* German wording for the framework's deploy plan (deploy-plan.json). Unknown actions and areas are
 * described generically from their name, so a newer framework version never breaks the view. */

export const planAreaLabels: Record<string, string> = {
  ous: 'Organisationseinheiten',
  groups: 'Gruppen',
  users: 'Benutzer',
  acls: 'OU-Berechtigungen',
  gpos: 'Gruppenrichtlinien',
  admx: 'ADMX-Vorlagen',
  msa: 'MSA-Delegationen',
  gmsa: 'gMSA-Delegationen',
  dmsa: 'dMSA-Delegationen',
  winlaps: 'Windows LAPS',
  authsilos: 'Authentication Silos',
}

export type ActionKind = 'create' | 'update' | 'link' | 'configure' | 'remove' | 'other'

const knownActions: Record<string, { label: string; kind: ActionKind }> = {
  CreateOU: { label: 'OU anlegen', kind: 'create' },
  CreateGroup: { label: 'Gruppe anlegen', kind: 'create' },
  CreateUser: { label: 'Benutzer anlegen', kind: 'create' },
  UpdateUserMembership: { label: 'Mitgliedschaft ändern', kind: 'update' },
  CreateAcl: { label: 'Berechtigung vergeben', kind: 'create' },
  CreateGPO: { label: 'GPO anlegen', kind: 'create' },
  ImportGPO: { label: 'GPO importieren', kind: 'create' },
  LinkGPO: { label: 'GPO verknüpfen', kind: 'link' },
  ConfigureLapsDecryptor: { label: 'LAPS-Entschlüsselung konfigurieren', kind: 'configure' },
  AddDeviceGroupMember: { label: 'Gerät zur Gerätegruppe hinzufügen', kind: 'update' },
  CreateAuthPolicy: { label: 'Authentifizierungsrichtlinie anlegen', kind: 'create' },
  UpdateAuthPolicy: { label: 'Authentifizierungsrichtlinie ändern', kind: 'update' },
  CreateAuthSilo: { label: 'Silo anlegen', kind: 'create' },
  UpdateAuthSilo: { label: 'Silo ändern', kind: 'update' },
  GrantSiloAccess: { label: 'Konto im Silo zulassen', kind: 'configure' },
  AssignSilo: { label: 'Konto dem Silo zuweisen', kind: 'configure' },
}

const verbs: [RegExp, string, ActionKind][] = [
  [/^(create|new|add)/i, 'anlegen', 'create'],
  [/^import/i, 'importieren', 'create'],
  [/^copy/i, 'kopieren', 'create'],
  [/^(update|set|modify)/i, 'aktualisieren', 'update'],
  [/^link/i, 'verknüpfen', 'link'],
  [/^configure/i, 'konfigurieren', 'configure'],
  [/^(remove|delete)/i, 'entfernen', 'remove'],
]

/** "CopyAdmxFile" → ["Copy", "Admx File"] */
function splitAction(action: string): [string, string] {
  const m = /^([A-Z][a-z]+)(.*)$/.exec(action)
  if (!m) return [action, '']
  return [m[1], m[2].replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim()]
}

export function actionKind(action: string): ActionKind {
  return knownActions[action]?.kind ?? verbs.find(([re]) => re.test(action))?.[2] ?? 'other'
}

/** Label for counters and the filter ("GPO verknüpfen", "Admx File kopieren"). */
export function actionLabel(action: string): string {
  if (knownActions[action]) return knownActions[action].label
  const [verb, object] = splitAction(action)
  const v = verbs.find(([re]) => re.test(verb))
  if (v && object) return `${objectLabel(object)} ${v[1]}`
  return action.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
}

function objectLabel(o: string) {
  const map: Record<string, string> = { Admx: 'ADMX-Vorlage', 'Admx File': 'ADMX-Datei', Adml: 'ADML-Datei', 'Adml File': 'ADML-Datei', 'Admx Store': 'Zentraler Speicher', 'Central Store': 'Zentraler Speicher' }
  return map[o] ?? o
}

export const actionKindLabels: Record<ActionKind, string> = {
  create: 'Anlegen',
  update: 'Ändern',
  link: 'Verknüpfen',
  configure: 'Konfigurieren',
  remove: 'Entfernen',
  other: 'Sonstiges',
}

/** "OU=Groups,OU=Tier 1,DC=contoso,DC=local" → "Tier 1 › Groups"; domain root → "Domänenstamm (contoso.local)". */
export function readableDn(dn: string | null | undefined): string {
  if (!dn) return ''
  if (!/^[A-Za-z]+=/.test(dn.trim())) return dn // not a DN (e.g. a file path)
  const parts = dn.split(/,(?=\s*[A-Za-z]+=)/).map((p) => p.trim())
  const rdns = parts.filter((p) => !/^DC=/i.test(p)).map((p) => p.replace(/^[A-Za-z]+=/, ''))
  const domain = parts.filter((p) => /^DC=/i.test(p)).map((p) => p.slice(3)).join('.')
  if (!rdns.length) return domain ? `Domänenstamm (${domain})` : dn
  return rdns.reverse().join(' › ')
}

function text(v: PlanDetailValue | undefined): string | null {
  if (v === undefined || v === null || v === '') return null
  if (Array.isArray(v)) return v.length ? v.join(', ') : null
  if (typeof v === 'boolean') return v ? 'Ja' : 'Nein'
  return String(v)
}

function list(v: PlanDetailValue | undefined): string[] {
  if (Array.isArray(v)) return v
  const t = text(v)
  return t ? [t] : []
}

function detail(a: PlanAction, ...keys: string[]): PlanDetailValue | undefined {
  const d = a.details ?? {}
  for (const k of keys) {
    const hit = Object.keys(d).find((x) => x.toLowerCase() === k.toLowerCase())
    if (hit !== undefined && d[hit] !== undefined && d[hit] !== '') return d[hit]
  }
  return undefined
}

/** A sentence as parts: plain text and quoted names (rendered emphasised). */
export type SentencePart = string | { name: string } | { path: string }

const q = (name: string) => ({ name })
const at = (path: string | null | undefined): SentencePart[] => (path ? [' in ', { path }] : [])

/** One German sentence per planned action, e.g. OU „Tier 1 Servers“ anlegen in „Tier 1“. */
export function describeAction(a: PlanAction): SentencePart[] {
  switch (a.action) {
    case 'CreateOU':
      return ['OU ', q(a.name), ' anlegen', ...at(a.path)]
    case 'CreateGroup':
      return ['Gruppe ', q(a.name), ' anlegen', ...at(a.path)]
    case 'CreateUser':
      return ['Benutzer ', q(a.name), ' anlegen', ...at(a.path)]
    case 'UpdateUserMembership': {
      const groups = [...new Set([...list(detail(a, 'addGroups', 'groups')), ...list(detail(a, 'group', 'memberOf'))])]
      if (!groups.length) return ['Gruppenmitgliedschaften von ', q(a.name), ' aktualisieren']
      const parts: SentencePart[] = [q(a.name), groups.length === 1 ? ' zu Gruppe ' : ' zu den Gruppen ']
      groups.forEach((g, i) => parts.push(...(i ? [i === groups.length - 1 ? ' und ' : ', '] : []), q(g)))
      parts.push(' hinzufügen')
      return parts
    }
    case 'CreateAcl': {
      const principal = text(detail(a, 'principal', 'identityReference', 'identityreference')) ?? a.name
      const rights = text(detail(a, 'rights', 'activeDirectoryRights', 'activedirectoryrights'))
      const target = a.path ? readableDn(a.path) : null
      return ['Berechtigung für ', q(principal), ...(target ? [' auf ', { path: a.path! } as SentencePart] : []), ' vergeben', ...(rights ? [` (Rechte: ${rights})`] : [])]
    }
    case 'CreateGPO':
      return ['GPO ', q(a.name), ' anlegen']
    case 'ImportGPO':
      return ['GPO ', q(a.name), ' aus Sicherung importieren']
    case 'LinkGPO':
      return ['GPO ', q(a.name), ' verknüpfen mit ', ...(a.path ? [{ path: a.path } as SentencePart] : ['–'])]
    case 'AddDeviceGroupMember': {
      const group = text(detail(a, 'group'))
      return ['Gerät ', q(a.name), ' zur Gerätegruppe ', q(group ?? '?'), ' hinzufügen']
    }
    case 'CreateAuthPolicy':
    case 'UpdateAuthPolicy': {
      const parts: SentencePart[] = ['Authentifizierungsrichtlinie ', q(a.name), a.action === 'CreateAuthPolicy' ? ' anlegen' : ' ändern']
      const rule = signInRule(a)
      if (rule) parts.push(` – ${rule}`)
      return parts
    }
    case 'CreateAuthSilo':
    case 'UpdateAuthSilo': {
      const policy = text(detail(a, 'userAuthenticationPolicy'))
      return ['Silo ', q(a.name), a.action === 'CreateAuthSilo' ? ' anlegen' : ' ändern', ...(policy ? [' mit Benutzerrichtlinie ', q(policy)] : [])]
    }
    case 'GrantSiloAccess':
      return ['Konto ', q(a.name), ' im Silo ', q(text(detail(a, 'silo')) ?? '?'), ' zulassen']
    case 'AssignSilo':
      return ['Konto ', q(a.name), ' dem Silo ', q(text(detail(a, 'silo')) ?? '?'), ' zuweisen']
    case 'ConfigureLapsDecryptor':
      return ['LAPS-Entschlüsselung ', q(a.name), ' konfigurieren', ...(a.path ? [' für ', { path: a.path } as SentencePart] : [])]
  }
  // Generic: "<Objekt> „Name“ <verb> in <Pfad>"
  const [verb, object] = splitAction(a.action)
  const v = verbs.find(([re]) => re.test(verb))
  const noun = object ? objectLabel(object) : a.resourceType || 'Objekt'
  if (v) return [`${noun} `, q(a.name), ` ${v[1]}`, ...at(a.path)]
  return [`${actionLabel(a.action)}: `, q(a.name), ...at(a.path)]
}

/** „Anmeldung nur von Domänencontrollern oder Geräten in A, B“ from a policy action's details. */
function signInRule(a: PlanAction): string | null {
  const dcs = detail(a, 'includeDomainControllers')
  const groups = list(detail(a, 'deviceGroups'))
  if (dcs === undefined && !groups.length) return null
  return describeSignInRule(dcs === true || dcs === 'true' || dcs === 'True', groups)
}

/** Readable sentence for the device condition of an authentication policy (no SDDL). */
export function describeSignInRule(includeDomainControllers: boolean, deviceGroups: string[]): string {
  const groups = deviceGroups.filter(Boolean)
  if (!includeDomainControllers && !groups.length) return 'Keine Gerätebedingung – Anmeldung von jedem Gerät'
  const g = groups.length === 1 ? `Geräten in ${groups[0]}` : `Geräten in ${groups.slice(0, -1).join(', ')} oder ${groups[groups.length - 1]}`
  if (includeDomainControllers && groups.length) return `Anmeldung nur von Domänencontrollern oder ${g}`
  if (includeDomainControllers) return 'Anmeldung nur von Domänencontrollern'
  return `Anmeldung nur von ${g}`
}

export function sentenceText(parts: SentencePart[]): string {
  return parts.map((p) => (typeof p === 'string' ? p : 'name' in p ? `„${p.name}“` : `„${readableDn(p.path)}“`)).join('')
}

export interface PlanGroup {
  key: string
  phase: number
  title: string
  area: string
  actions: PlanAction[]
  existing: number | null
}

/** Actions grouped by phase (falling back to area), in phase order. */
export function groupPlan(plan: DeployPlan, actions: PlanAction[]): PlanGroup[] {
  const groups = new Map<string, PlanGroup>()
  for (const a of actions) {
    const key = `${a.phase}:${a.area}`
    let g = groups.get(key)
    if (!g) {
      const phase = plan.phases.find((p) => p.phase === a.phase && (!p.area || p.area.toLowerCase() === a.area)) ?? plan.phases.find((p) => p.phase === a.phase)
      g = {
        key,
        phase: a.phase,
        area: a.area,
        title: planAreaLabels[a.area] ?? phase?.name ?? a.area ?? 'Weitere Änderungen',
        actions: [],
        existing: phase ? phase.existingCount : null,
      }
      groups.set(key, g)
    }
    g.actions.push(a)
  }
  return [...groups.values()].sort((x, y) => x.phase - y.phase || x.title.localeCompare(y.title))
}

export function planTotal(plan: DeployPlan) {
  return Math.max(plan.summary.totalActions, Object.values(plan.actionCounts).reduce((s, n) => s + n, 0))
}

/** "3 anlegen · 2 verknüpfen" for compact displays. */
export function planCountsText(s: { create: number; update: number; link: number; configure: number }) {
  const parts = [
    s.create && `${s.create} anlegen`,
    s.update && `${s.update} ändern`,
    s.link && `${s.link} verknüpfen`,
    s.configure && `${s.configure} konfigurieren`,
  ].filter(Boolean)
  return parts.join(' · ')
}

/** Detail keys already said in the sentence are not repeated below it. */
export function remainingDetails(a: PlanAction): Record<string, PlanDetailValue> {
  const used = new Set<string>()
  if (a.action === 'CreateAcl') ['principal', 'identityreference', 'rights', 'activedirectoryrights'].forEach((k) => used.add(k))
  if (a.action === 'UpdateUserMembership') ['addgroups', 'groups', 'group'].forEach((k) => used.add(k))
  // Authentication silos: the sign-in rule is said in words; SIDs and the generated SDDL are technical detail.
  if (/AuthPolicy|AuthSilo|SiloAccess|AssignSilo|DeviceGroupMember/.test(a.action))
    ['sddl', 'currentsddl', 'devicegroupsids', 'includedomaincontrollers', 'devicegroups', 'silo', 'group'].forEach((k) => used.add(k))
  const out: Record<string, PlanDetailValue> = {}
  for (const [k, v] of Object.entries(a.details ?? {})) if (!used.has(k.toLowerCase())) out[k] = v
  return out
}
