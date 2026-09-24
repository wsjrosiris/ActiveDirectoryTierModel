import type { RunStatus, Scope } from '@/api/types'
import { lazyRecord } from '@/i18n'

export const scopeLabels: Record<Scope, string> = lazyRecord('lib.labels.scope')

export const scopes = Object.keys(scopeLabels) as Scope[]

export const statusLabels: Record<RunStatus, string> = lazyRecord('lib.labels.status')

/** Statuses in which the run is not finished yet (the detail page keeps refreshing). */
export const pendingStatuses: RunStatus[] = ['AwaitingApproval', 'Scheduled', 'Queued', 'Running']

export const includeLabels: Record<string, string> = lazyRecord('lib.labels.include')

export const entityTypeLabels: Record<string, string> = lazyRecord('lib.labels.entityType')

export const actionLabels: Record<string, string> = lazyRecord('lib.labels.action')

export const findingTypeLabels: Record<string, string> = lazyRecord('lib.labels.findingType')

export const sectionGroups: { title: string; keys: string[] }[] = [
  { title: 'Struktur', keys: ['ous', 'groups', 'users'] },
  { title: 'Delegationen', keys: ['acls', 'msa', 'gmsa', 'dmsa', 'winlaps'] },
  { title: 'Richtlinien', keys: ['gpos', 'authsilos', 'admx', 'adml-en-US'] },
  { title: 'System', keys: ['metadata', 'guid-mappings', 'dependencies'] },
]

export const sectionFallbackTitles: Record<string, string> = lazyRecord('lib.labels.sectionTitle')

export const severityLabels: Record<string, string> = lazyRecord('lib.labels.severity')

/** Areas of audit findings and plan actions. */
export const areaLabels: Record<string, string> = lazyRecord('lib.labels.area')

/** Area of an audit finding: the report's `area`, or derived from the resource type of older framework versions. */
export function findingArea(f: { area?: string; resourceType?: string }): string | null {
  if (f.area && areaLabels[f.area]) return f.area
  const r = (f.resourceType ?? '').toLowerCase()
  if (r.includes('authenticationpolicy') || r.includes('devicegroupmember')) return 'authsilos'
  if (r === 'ou' || r.includes('organizationalunit')) return 'ous'
  if (r.includes('group') && !r.includes('policy')) return 'groups'
  if (r === 'user' || r.includes('useraccount')) return 'users'
  if (r.includes('gpo') || r.includes('gplink') || r.includes('grouppolicy')) return 'gpos'
  if (r.includes('acl') || r.includes('accessrule') || r.includes('ace')) return 'acls'
  if (r.includes('admx') || r.includes('adml')) return 'admx'
  if (r.includes('winlaps') || r.includes('laps')) return 'winlaps'
  if (r.includes('gmsa')) return 'gmsa'
  if (r.includes('dmsa')) return 'dmsa'
  if (r.includes('msa')) return 'msa'
  return null
}

/** Scope/extension a remediation plan for this area uses (mirrors the service's mapping, for display only). */
export const areaPlanLabels: Record<string, string> = lazyRecord('lib.labels.areaPlan')

export const objectClassLabels: Record<string, string> = lazyRecord('lib.labels.objectClass')

export const aclObjectTypeLabels: Record<string, string> = lazyRecord('lib.labels.aclObjectType')

/** Short German explanation of dangerous AD rights. */
export const rightDescriptions: Record<string, string> = lazyRecord('lib.labels.rightDescription')
