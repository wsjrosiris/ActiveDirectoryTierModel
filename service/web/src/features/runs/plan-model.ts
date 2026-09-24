import type { DeployPlan, PlanAction, PlanDetailValue } from '@/api/types'
import { lazyRecord, t } from '@/i18n'

/* Wording (German/English, see i18n) for the framework's deploy plan (deploy-plan.json). Unknown actions and areas are
 * described generically from their name, so a newer framework version never breaks the view. */

export const planAreaLabels: Record<string, string> = lazyRecord('runs.planModel.area')

export type ActionKind = 'create' | 'update' | 'link' | 'configure' | 'remove' | 'other'

const knownActions: Record<string, { label: string; kind: ActionKind }> = {
  CreateOU: { label: t('runs.planModel.action.CreateOU'), kind: 'create' },
  CreateGroup: { label: t('runs.planModel.action.CreateGroup'), kind: 'create' },
  CreateUser: { label: t('runs.planModel.action.CreateUser'), kind: 'create' },
  UpdateUserMembership: { label: t('runs.planModel.action.UpdateUserMembership'), kind: 'update' },
  CreateAcl: { label: t('runs.planModel.action.CreateAcl'), kind: 'create' },
  CreateGPO: { label: t('runs.planModel.action.CreateGPO'), kind: 'create' },
  ImportGPO: { label: t('runs.planModel.action.ImportGPO'), kind: 'create' },
  LinkGPO: { label: t('runs.planModel.action.LinkGPO'), kind: 'link' },
  ConfigureLapsDecryptor: { label: t('runs.planModel.action.ConfigureLapsDecryptor'), kind: 'configure' },
  AddDeviceGroupMember: { label: t('runs.planModel.action.AddDeviceGroupMember'), kind: 'update' },
  CreateAuthPolicy: { label: t('runs.planModel.action.CreateAuthPolicy'), kind: 'create' },
  UpdateAuthPolicy: { label: t('runs.planModel.action.UpdateAuthPolicy'), kind: 'update' },
  CreateAuthSilo: { label: t('runs.planModel.action.CreateAuthSilo'), kind: 'create' },
  UpdateAuthSilo: { label: t('runs.planModel.action.UpdateAuthSilo'), kind: 'update' },
  GrantSiloAccess: { label: t('runs.planModel.action.GrantSiloAccess'), kind: 'configure' },
  AssignSilo: { label: t('runs.planModel.action.AssignSilo'), kind: 'configure' },
}

const verbs: [RegExp, string, ActionKind][] = [
  [/^(create|new|add)/i, t('runs.planModel.verb.create'), 'create'],
  [/^import/i, t('runs.planModel.verb.import'), 'create'],
  [/^copy/i, t('runs.planModel.verb.copy'), 'create'],
  [/^(update|set|modify)/i, t('runs.planModel.verb.update'), 'update'],
  [/^link/i, t('runs.planModel.verb.link'), 'link'],
  [/^configure/i, t('runs.planModel.verb.configure'), 'configure'],
  [/^(remove|delete)/i, t('runs.planModel.verb.remove'), 'remove'],
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

/** Label for counters and the filter ("GPO verknüpfen", "ADMX-Datei kopieren" / "Link GPO", "Copy ADMX file"). */
export function actionLabel(action: string): string {
  if (knownActions[action]) return knownActions[action].label
  const [verb, object] = splitAction(action)
  const v = verbs.find(([re]) => re.test(verb))
  if (v && object) return t('runs.planModel.objectVerb', { object: objectLabel(object), verb: v[1] })
  return action.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
}

const objectLabels: Record<string, string> = lazyRecord('runs.planModel.object')

function objectLabel(o: string) {
  return objectLabels[o] ?? o
}

export const actionKindLabels: Record<ActionKind, string> = lazyRecord('runs.planModel.kind')

/** "OU=Groups,OU=Tier 1,DC=contoso,DC=local" → "Tier 1 › Groups"; domain root → "Domänenstamm (contoso.local)". */
export function readableDn(dn: string | null | undefined): string {
  if (!dn) return ''
  if (!/^[A-Za-z]+=/.test(dn.trim())) return dn // not a DN (e.g. a file path)
  const parts = dn.split(/,(?=\s*[A-Za-z]+=)/).map((p) => p.trim())
  const rdns = parts.filter((p) => !/^DC=/i.test(p)).map((p) => p.replace(/^[A-Za-z]+=/, ''))
  const domain = parts.filter((p) => /^DC=/i.test(p)).map((p) => p.slice(3)).join('.')
  if (!rdns.length) return domain ? t('runs.planModel.domainRoot', { domain }) : dn
  return rdns.reverse().join(' › ')
}

function text(v: PlanDetailValue | undefined): string | null {
  if (v === undefined || v === null || v === '') return null
  if (Array.isArray(v)) return v.length ? v.join(', ') : null
  if (typeof v === 'boolean') return v ? t('common.yes') : t('common.no')
  return String(v)
}

function list(v: PlanDetailValue | undefined): string[] {
  if (Array.isArray(v)) return v
  const tt = text(v)
  return tt ? [tt] : []
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
const at = (path: string | null | undefined): SentencePart[] => (path ? [t('runs.planModel.in'), { path }] : [])

/** A translated sentence with [[markers]] for names, paths or further parts (word order differs per language). */
function sentence(text: string, vars: Record<string, SentencePart | SentencePart[] | null | undefined>): SentencePart[] {
  const out: SentencePart[] = []
  text.split(/\[\[(\w+)\]\]/).forEach((p, i) => {
    if (i % 2 === 0) {
      if (p) out.push(p)
    } else {
      const v = vars[p]
      if (Array.isArray(v)) out.push(...v)
      else if (v) out.push(v)
    }
  })
  return out
}

/** "a, b und c" / "a, b and c" */
function listParts(items: string[], last: string): SentencePart[] {
  const parts: SentencePart[] = []
  items.forEach((g, i) => parts.push(...(i ? [i === items.length - 1 ? last : ', '] : []), q(g)))
  return parts
}

/** One sentence per planned action, e.g. OU „Tier 1 Servers“ anlegen in „Tier 1“ / Create OU "Tier 1 Servers" in "Tier 1". */
export function describeAction(a: PlanAction): SentencePart[] {
  const name = q(a.name)
  switch (a.action) {
    case 'CreateOU':
      return sentence(t('runs.planModel.s.createOu'), { name, at: at(a.path) })
    case 'CreateGroup':
      return sentence(t('runs.planModel.s.createGroup'), { name, at: at(a.path) })
    case 'CreateUser':
      return sentence(t('runs.planModel.s.createUser'), { name, at: at(a.path) })
    case 'UpdateUserMembership': {
      const groups = [...new Set([...list(detail(a, 'addGroups', 'groups')), ...list(detail(a, 'group', 'memberOf'))])]
      if (!groups.length) return sentence(t('runs.planModel.s.updateMemberships'), { name })
      return sentence(t('runs.planModel.s.addToGroups', { count: groups.length }), { name, groups: listParts(groups, t('runs.planModel.and')) })
    }
    case 'CreateAcl': {
      const principal = text(detail(a, 'principal', 'identityReference', 'identityreference')) ?? a.name
      const rights = text(detail(a, 'rights', 'activeDirectoryRights', 'activedirectoryrights'))
      const target = a.path ? readableDn(a.path) : null
      return sentence(t('runs.planModel.s.grantPermission'), {
        principal: q(principal),
        target: target ? [t('runs.planModel.on'), { path: a.path! }] : null,
        rights: rights ? t('runs.planModel.rights', { rights }) : null,
      })
    }
    case 'CreateGPO':
      return sentence(t('runs.planModel.s.createGpo'), { name })
    case 'ImportGPO':
      return sentence(t('runs.planModel.s.importGpo'), { name })
    case 'LinkGPO':
      return sentence(t('runs.planModel.s.linkGpo'), { name, target: a.path ? { path: a.path } : '–' })
    case 'AddDeviceGroupMember':
      return sentence(t('runs.planModel.s.addDevice'), { name, group: q(text(detail(a, 'group')) ?? '?') })
    case 'CreateAuthPolicy':
    case 'UpdateAuthPolicy': {
      const rule = signInRule(a)
      return sentence(t(a.action === 'CreateAuthPolicy' ? 'runs.planModel.s.createPolicy' : 'runs.planModel.s.updatePolicy'), { name, rule: rule ? ` – ${rule}` : null })
    }
    case 'CreateAuthSilo':
    case 'UpdateAuthSilo': {
      const policy = text(detail(a, 'userAuthenticationPolicy'))
      return sentence(t(a.action === 'CreateAuthSilo' ? 'runs.planModel.s.createSilo' : 'runs.planModel.s.updateSilo'), {
        name,
        policy: policy ? [t('runs.planModel.withUserPolicy'), q(policy)] : null,
      })
    }
    case 'GrantSiloAccess':
      return sentence(t('runs.planModel.s.grantSilo'), { name, silo: q(text(detail(a, 'silo')) ?? '?') })
    case 'AssignSilo':
      return sentence(t('runs.planModel.s.assignSilo'), { name, silo: q(text(detail(a, 'silo')) ?? '?') })
    case 'ConfigureLapsDecryptor':
      return sentence(t('runs.planModel.s.configureLaps'), { name, for: a.path ? [t('runs.planModel.for'), { path: a.path }] : null })
  }
  // Generic: "<Objekt> „Name“ <verb> in <Pfad>" / "<Verb> <object> "name" in <path>"
  const [verb, object] = splitAction(a.action)
  const v = verbs.find(([re]) => re.test(verb))
  const noun = object ? objectLabel(object) : a.resourceType || t('runs.planModel.objectFallback')
  if (v) return sentence(t('runs.planModel.s.generic'), { noun, name, verb: v[1], at: at(a.path) })
  return [`${actionLabel(a.action)}: `, name, ...at(a.path)]
}

/** „Anmeldung nur von Domänencontrollern oder Geräten in A, B“ (sign-in rule) from a policy action's details. */
function signInRule(a: PlanAction): string | null {
  const dcs = detail(a, 'includeDomainControllers')
  const groups = list(detail(a, 'deviceGroups'))
  if (dcs === undefined && !groups.length) return null
  return describeSignInRule(dcs === true || dcs === 'true' || dcs === 'True', groups)
}

/** Readable sentence for the device condition of an authentication policy (no SDDL). */
export function describeSignInRule(includeDomainControllers: boolean, deviceGroups: string[]): string {
  const groups = deviceGroups.filter(Boolean)
  if (!includeDomainControllers && !groups.length) return t('runs.planModel.rule.anyDevice')
  const g = t('runs.planModel.rule.devicesIn', {
    groups: groups.length === 1 ? groups[0] : `${groups.slice(0, -1).join(', ')}${t('runs.planModel.or')}${groups[groups.length - 1]}`,
  })
  if (includeDomainControllers && groups.length) return t('runs.planModel.rule.dcsOr', { devices: g })
  if (includeDomainControllers) return t('runs.planModel.rule.dcsOnly')
  return t('runs.planModel.rule.only', { devices: g })
}

export function sentenceText(parts: SentencePart[]): string {
  return parts.map((p) => (typeof p === 'string' ? p : 'name' in p ? t('common.quoted', { text: p.name }) : t('common.quoted', { text: readableDn(p.path) }))).join('')
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
        title: planAreaLabels[a.area] ?? phase?.name ?? a.area ?? t('runs.planModel.otherChanges'),
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
    s.create && t('runs.planModel.count.create', { count: s.create }),
    s.update && t('runs.planModel.count.update', { count: s.update }),
    s.link && t('runs.planModel.count.link', { count: s.link }),
    s.configure && t('runs.planModel.count.configure', { count: s.configure }),
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
