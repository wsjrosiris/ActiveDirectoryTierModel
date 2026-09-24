/* Data model, constants and pure helpers for the GPO section (tiermodel-gpos.json).
 *
 * All helpers treat their input as immutable and preserve unknown keys: objects are always
 * spread from the original, never rebuilt. Kept free of React and path aliases so the
 * round-trip checks can run it directly in Node. */

import { t } from '../../i18n/index.ts'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Obj = Record<string, any>

export type GpoKind = 'ImportOnlyGpo' | 'PostConfigureGpo'
export const GPO_KINDS: GpoKind[] = ['ImportOnlyGpo', 'PostConfigureGpo']

export const DOMAIN_DN = '{{DOMAIN_DN}}'
export const DC_OU = `OU=Domain Controllers,${DOMAIN_DN}`
export const TEMPLATE_KEY = 'TemplateGpos'

export const kindLabels: Record<GpoKind, string> = {
  ImportOnlyGpo: t('config.gpoModel.importOnly'),
  PostConfigureGpo: t('config.gpoModel.importConfigure'),
}
export const kindDescriptions: Record<GpoKind, string> = {
  ImportOnlyGpo: t('config.gpoModel.gposWhoseSettingsAreTaken'),
  PostConfigureGpo: t('config.gpoModel.gposThatAreAdditionallyConfigured'),
}

// ------------------------------------------------------------------ modes & status

export const GPO_MODES = [
  { value: 'create', label: t('config.gpoModel.createOnly'), short: t('config.gpoModel.create'), description: t('config.gpoModel.createAnEmptyGpoAs') },
  { value: 'createAndImport', label: t('config.gpoModel.createImport'), short: t('config.gpoModel.import'), description: t('config.gpoModel.createTheGpoAndImport') },
  {
    value: 'createImportAndConfigure',
    label: t('config.gpoModel.createImportConfigure'),
    short: t('config.gpoModel.configured'),
    description: t('config.gpoModel.likeCreateImportThenAdditionally'),
  },
] as const

export const GPO_STATUSES = [
  { value: 'AllSettingsEnabled', label: t('config.gpoModel.allSettingsEnabled'), short: t('config.gpoModel.allOn') },
  { value: 'UserSettingsDisabled', label: t('config.gpoModel.userSettingsDisabled'), short: t('config.gpoModel.userOff') },
  { value: 'ComputerSettingsDisabled', label: t('config.gpoModel.computerSettingsDisabled'), short: t('config.gpoModel.computerOff') },
  { value: 'AllSettingsDisabled', label: t('config.gpoModel.allSettingsDisabled'), short: t('config.gpoModel.allOff') },
] as const

export const modeMeta = (m: unknown) => GPO_MODES.find((x) => x.value === m)
export const statusMeta = (s: unknown) => GPO_STATUSES.find((x) => x.value === s)

// ------------------------------------------------------------------ user rights

export const USER_RIGHTS: { value: string; label: string }[] = [
  { value: 'SeNetworkLogonRight', label: t('config.gpoModel.accessThisComputerFromThe') },
  { value: 'SeDenyNetworkLogonRight', label: t('config.gpoModel.denyAccessToThisComputer') },
  { value: 'SeInteractiveLogonRight', label: t('config.gpoModel.allowLogOnLocally') },
  { value: 'SeDenyInteractiveLogonRight', label: t('config.gpoModel.denyLogOnLocally') },
  { value: 'SeRemoteInteractiveLogonRight', label: t('config.gpoModel.allowLogOnThroughRemote') },
  { value: 'SeDenyRemoteInteractiveLogonRight', label: t('config.gpoModel.denyLogOnThroughRemote') },
  { value: 'SeBatchLogonRight', label: t('config.gpoModel.logOnAsABatch') },
  { value: 'SeDenyBatchLogonRight', label: t('config.gpoModel.denyLogOnAsA') },
  { value: 'SeServiceLogonRight', label: t('config.gpoModel.logOnAsAService') },
  { value: 'SeDenyServiceLogonRight', label: t('config.gpoModel.denyLogOnAsA2') },
  { value: 'SeImpersonatePrivilege', label: t('config.gpoModel.impersonateAClientAfterAuthentication') },
  { value: 'SeAssignPrimaryTokenPrivilege', label: t('config.gpoModel.replaceAProcessLevelToken') },
  { value: 'SeIncreaseQuotaPrivilege', label: t('config.gpoModel.adjustMemoryQuotasForA') },
  { value: 'SeAuditPrivilege', label: t('config.gpoModel.generateSecurityAudits') },
  { value: 'SeChangeNotifyPrivilege', label: t('config.gpoModel.bypassTraverseChecking') },
  { value: 'SeBackupPrivilege', label: t('config.gpoModel.backUpFilesAndDirectories') },
  { value: 'SeRestorePrivilege', label: t('config.gpoModel.restoreFilesAndDirectories') },
  { value: 'SeDebugPrivilege', label: t('config.gpoModel.debugPrograms') },
  { value: 'SeTcbPrivilege', label: t('config.gpoModel.actAsPartOfThe') },
  { value: 'SeTakeOwnershipPrivilege', label: t('config.gpoModel.takeOwnershipOfFilesOr') },
  { value: 'SeLoadDriverPrivilege', label: t('config.gpoModel.loadAndUnloadDeviceDrivers') },
  { value: 'SeSecurityPrivilege', label: t('config.gpoModel.manageAuditingAndSecurityLog') },
  { value: 'SeSystemtimePrivilege', label: t('config.gpoModel.changeTheSystemTime') },
  { value: 'SeTimeZonePrivilege', label: t('config.gpoModel.changeTheTimeZone') },
  { value: 'SeShutdownPrivilege', label: t('config.gpoModel.shutDownTheSystem') },
  { value: 'SeRemoteShutdownPrivilege', label: t('config.gpoModel.forceShutdownFromARemote') },
  { value: 'SeMachineAccountPrivilege', label: t('config.gpoModel.addWorkstationsToDomain') },
  { value: 'SeEnableDelegationPrivilege', label: t('config.gpoModel.enableComputerAndUserAccounts') },
  { value: 'SeCreateTokenPrivilege', label: t('config.gpoModel.createATokenObject') },
  { value: 'SeCreateGlobalPrivilege', label: t('config.gpoModel.createGlobalObjects') },
  { value: 'SeCreatePagefilePrivilege', label: t('config.gpoModel.createAPagefile') },
  { value: 'SeCreatePermanentPrivilege', label: t('config.gpoModel.createPermanentSharedObjects') },
  { value: 'SeCreateSymbolicLinkPrivilege', label: t('config.gpoModel.createSymbolicLinks') },
  { value: 'SeIncreaseBasePriorityPrivilege', label: t('config.gpoModel.increaseSchedulingPriority') },
  { value: 'SeIncreaseWorkingSetPrivilege', label: t('config.gpoModel.increaseAProcessWorkingSet') },
  { value: 'SeLockMemoryPrivilege', label: t('config.gpoModel.lockPagesInMemory') },
  { value: 'SeManageVolumePrivilege', label: t('config.gpoModel.performVolumeMaintenanceTasks') },
  { value: 'SeProfileSingleProcessPrivilege', label: t('config.gpoModel.profileSingleProcess') },
  { value: 'SeSystemProfilePrivilege', label: t('config.gpoModel.profileSystemPerformance') },
  { value: 'SeSystemEnvironmentPrivilege', label: t('config.gpoModel.modifyFirmwareEnvironmentValues') },
  { value: 'SeUndockPrivilege', label: t('config.gpoModel.removeComputerFromDockingStation') },
  { value: 'SeSyncAgentPrivilege', label: t('config.gpoModel.synchronizeDirectoryServiceData') },
  { value: 'SeTrustedCredManAccessPrivilege', label: t('config.gpoModel.accessCredentialManagerAsA') },
  { value: 'SeRelabelPrivilege', label: t('config.gpoModel.modifyAnObjectLabel') },
  { value: 'SeDelegateSessionUserImpersonatePrivilege', label: t('config.gpoModel.obtainAnImpersonationTokenFor') },
]
export const rightLabel = (r: string) => USER_RIGHTS.find((x) => x.value === r)?.label

// ------------------------------------------------------------------ principals

/** Well-known literal entries for user rights (written verbatim, not resolved). */
export const LITERAL_SUGGESTIONS: { value: string; label: string }[] = [
  { value: '*S-1-5-32-544', label: t('config.gpoModel.administrators') },
  { value: '*S-1-5-32-545', label: t('config.gpoModel.users') },
  { value: '*S-1-5-32-546', label: t('config.gpoModel.guests') },
  { value: '*S-1-5-32-551', label: t('config.gpoModel.backupOperators') },
  { value: '*S-1-5-32-555', label: t('config.gpoModel.remoteDesktopUsers') },
  { value: '*S-1-5-32-568', label: 'IIS_IUSRS' },
  { value: '*S-1-5-19', label: t('config.gpoModel.localService') },
  { value: '*S-1-5-20', label: t('config.gpoModel.networkService') },
  { value: '*S-1-5-18', label: t('config.gpoModel.localSystem') },
  { value: '*S-1-5-6', label: t('config.gpoModel.service') },
  { value: '*S-1-5-11', label: t('config.gpoModel.authenticatedUsers') },
  { value: '*S-1-1-0', label: t('config.gpoModel.everyone') },
  { value: '*S-1-5-113', label: t('config.gpoModel.localAccount') },
  { value: '*S-1-5-114', label: t('config.gpoModel.localAccountAndMemberOf') },
  { value: '*S-1-5-9', label: t('config.gpoModel.enterpriseDomainControllers') },
  { value: 'NT SERVICE\\ALL SERVICES', label: t('config.gpoModel.allServicesNtService') },
  { value: 'NT SERVICE\\WdiServiceHost', label: t('config.gpoModel.diagnosticSystemHostNtService') },
]

export const FOREST_ROOT_SUGGESTIONS: { value: string; label: string }[] = [
  { value: 'Enterprise Admins', label: t('config.gpoModel.enterpriseAdmins') },
  { value: 'Schema Admins', label: t('config.gpoModel.schemaAdmins') },
  { value: 'Enterprise Key Admins', label: t('config.gpoModel.enterpriseKeyAdmins') },
  { value: 'Enterprise Read-only Domain Controllers', label: t('config.gpoModel.enterpriseReadOnlyDomainControllers') },
]

/** Additional principals used by GPO user rights/memberships (resolved by name). */
export const GPO_BUILTIN_PRINCIPALS = [
  'Administrators', 'Administrator', 'Guest', 'Guests', 'SYSTEM', 'Authenticated Users', 'Everyone',
  'Local account', 'NT AUTHORITY\\Local account', 'IUSR', 'IIS_IUSRS', 'Backup Operators',
  'Domain Admins', 'Domain Controllers', 'Read-only Domain Controllers', 'Cloneable Domain Controllers',
  'Cert Publishers', 'Cryptographic Operators', 'Group Policy Creator Owners', 'Key Admins',
  'Allowed RODC Password Replication Group', 'DnsAdmins', 'DnsUpdateProxy',
]

export const CONDITIONS = [{ type: 'groupExists', operator: 'exists', label: t('config.gpoModel.groupExists') }]

// ------------------------------------------------------------------ restricted groups

export const BUILTIN_GROUPS: { value: string; label: string; hint: string }[] = [
  ['544', t('config.gpoModel.administrators')], ['545', t('config.gpoModel.users')], ['546', t('config.gpoModel.guests')], ['547', t('config.gpoModel.powerUsers')],
  ['548', t('config.gpoModel.accountOperators')], ['549', t('config.gpoModel.serverOperators')], ['550', t('config.gpoModel.printOperators')],
  ['551', t('config.gpoModel.backupOperators')], ['552', t('config.gpoModel.replicator')], ['555', t('config.gpoModel.remoteDesktopUsers')],
  ['556', t('config.gpoModel.networkConfigurationOperators')], ['558', t('config.gpoModel.performanceMonitorUsers')],
  ['559', t('config.gpoModel.performanceLogUsers')], ['562', t('config.gpoModel.distributedComUsers')], ['568', 'IIS_IUSRS'],
  ['569', t('config.gpoModel.cryptographicOperators')], ['573', t('config.gpoModel.eventLogReaders')], ['574', t('config.gpoModel.certificateServiceDcomAccess')],
  ['575', t('config.gpoModel.rdsRemoteAccessServers')], ['576', t('config.gpoModel.rdsEndpointServers')], ['577', t('config.gpoModel.rdsManagementServers')],
  ['578', t('config.gpoModel.hyperVAdministrators')], ['579', t('config.gpoModel.accessControlAssistanceOperators')],
  ['580', t('config.gpoModel.remoteManagementUsers')], ['582', t('config.gpoModel.storageReplicaAdministrators')], ['583', t('config.gpoModel.deviceOwners')],
  ['585', 'OpenSSH Users'],
]
  .map(([rid, label]) => ({ value: `*S-1-5-32-${rid}`, label, hint: `S-1-5-32-${rid}` }))
  .concat([
    { value: 'Power Users', label: 'Power Users', hint: t('config.gpoModel.groupNameWithoutSid') },
    { value: 'User Mode Hardware Operators', label: 'User Mode Hardware Operators', hint: t('config.gpoModel.groupNameWithoutSid') },
  ])

export const builtinGroupLabel = (g: string) => BUILTIN_GROUPS.find((b) => b.value.toLowerCase() === g.toLowerCase())?.label ?? g

export type RelationSuffix = 'Members' | 'Memberof'
export const relationLabels: Record<RelationSuffix, string> = { Members: t('config.gpoModel.members'), Memberof: t('config.gpoModel.memberOf') }

/** Splits `*S-1-5-32-544__Memberof` into group and relation. Unknown suffixes are kept as raw text. */
export function parseGroupRelation(v: string): { group: string; relation: string } {
  const i = v.lastIndexOf('__')
  if (i < 0) return { group: v, relation: '' }
  return { group: v.slice(0, i), relation: v.slice(i + 2) }
}
export const formatGroupRelation = (group: string, relation: string) => (relation ? `${group}__${relation}` : group)
export function describeGroupRelation(v: string) {
  const { group, relation } = parseGroupRelation(v)
  const rel = relationLabels[relation as RelationSuffix] ?? relation
  return rel ? `${builtinGroupLabel(group)} · ${rel}` : builtinGroupLabel(group)
}

// ------------------------------------------------------------------ targets

export function targetTitle(key: string, tt?: Obj): string {
  if (key === TEMPLATE_KEY) return t('config.gpoModel.templatesNotLinked')
  if (key === DOMAIN_DN) return t('config.gpoModel.domainRoot')
  const first = key.split(',')[0] ?? key
  const rdn = first.replace(/^(OU|CN)=/i, '')
  return rdn || (typeof tt?.displayName === 'string' && tt.displayName) || key
}

export function targetHint(key: string): string {
  if (key === TEMPLATE_KEY) return t('config.gpoModel.createdButNotLinked')
  if (key === DOMAIN_DN) return DOMAIN_DN
  return key.replace(/,\{\{DOMAIN_DN\}\}$/, '')
}

export const isLinked = (key: string) => key !== TEMPLATE_KEY

export function gpoList(tt: Obj | undefined, kind: GpoKind): Obj[] {
  const v = tt?.[kind]
  return Array.isArray(v) ? v : []
}

export function nextLinkOrder(tt: Obj | undefined): number {
  let max = 0
  for (const k of GPO_KINDS) for (const g of gpoList(tt, k)) if (typeof g?.linkOrder === 'number' && g.linkOrder > max) max = g.linkOrder
  return max + 1
}

// ------------------------------------------------------------------ immutable updates

export function setTarget(content: Obj, key: string, target: Obj): Obj {
  return { ...content, gpos: { ...(content.gpos ?? {}), [key]: target } }
}

/** Adds a target; placed before `TemplateGpos` so the unlinked templates stay last. */
export function addTarget(content: Obj, key: string, target: Obj): Obj {
  const out: Obj = {}
  const map = (content.gpos ?? {}) as Obj
  let placed = false
  for (const [k, v] of Object.entries(map)) {
    if (!placed && k === TEMPLATE_KEY && key !== TEMPLATE_KEY) {
      out[key] = target
      placed = true
    }
    out[k] = v
  }
  if (!placed) out[key] = target
  return { ...content, gpos: out }
}

export function removeTarget(content: Obj, key: string): Obj {
  const out: Obj = {}
  for (const [k, v] of Object.entries((content.gpos ?? {}) as Obj)) if (k !== key) out[k] = v
  return { ...content, gpos: out }
}

export function setGpoList(content: Obj, key: string, kind: GpoKind, list: Obj[]): Obj {
  const tt = (content.gpos?.[key] ?? {}) as Obj
  return setTarget(content, key, { ...tt, [kind]: list })
}

export function replaceGpo(content: Obj, key: string, kind: GpoKind, index: number, gpo: Obj): Obj {
  const list = [...gpoList(content.gpos?.[key], kind)]
  list[index] = gpo
  return setGpoList(content, key, kind, list)
}

/** Sets a list-valued key. An existing key is kept (even when emptied); a missing key is only added when non-empty. */
export function setListKeep(obj: Obj, key: string, list: unknown[]): Obj {
  if (list.length === 0 && !(key in obj)) return obj
  return { ...obj, [key]: list }
}

/** Sets a text field; optional fields are removed when cleared (existing keys stay as ""). */
export function setText(obj: Obj, key: string, v: string, removeWhenEmpty: boolean): Obj {
  const next = { ...obj }
  if (v === '' && removeWhenEmpty) delete next[key]
  else next[key] = v
  return next
}

/** restrictedGroups may be `[]` (nothing configured) or `{ emptyGroups, membershipGroups }`. */
export function restrictedAsObject(rg: unknown): Obj {
  if (rg && typeof rg === 'object' && !Array.isArray(rg)) return rg as Obj
  return { emptyGroups: [], membershipGroups: [] }
}

/** Writes restrictedGroups back while keeping the original representation when nothing was configured. */
export function setRestricted(gpo: Obj, next: Obj): Obj {
  const orig = gpo.restrictedGroups
  const onlyEmpty =
    Object.keys(next).every((k) => k === 'emptyGroups' || k === 'membershipGroups') &&
    !(next.emptyGroups?.length) &&
    !(next.membershipGroups?.length)
  if (onlyEmpty && (Array.isArray(orig) || orig === undefined)) return gpo
  return { ...gpo, restrictedGroups: next }
}

/** Final adjustments on submit (e.g. `create` needs no importPath). */
export function finalizeGpo(value: Obj, original: Obj | null): Obj {
  let next = value
  const edit = () => (next === value ? (next = { ...value }) : next)
  // `create` imports nothing: drop the path when the mode was switched to create in this edit.
  if (value.mode === 'create' && 'importPath' in value && (!original || original.mode !== 'create' || !('importPath' in original))) delete edit().importPath
  // Lists added and emptied again in this edit are removed, so the JSON does not change needlessly.
  if (original && !('denyApplyGroupPolicy' in original) && Array.isArray(value.denyApplyGroupPolicy) && !value.denyApplyGroupPolicy.length)
    delete edit().denyApplyGroupPolicy
  // restrictedGroups: go back to the original `[]` / missing key when nothing is configured.
  const rg = value.restrictedGroups
  if (original && (Array.isArray(original.restrictedGroups) || !('restrictedGroups' in original)) && rg && !Array.isArray(rg) && typeof rg === 'object') {
    const onlyEmpty = Object.keys(rg).every((k) => k === 'emptyGroups' || k === 'membershipGroups') && !rg.emptyGroups?.length && !rg.membershipGroups?.length
    if (onlyEmpty) {
      if ('restrictedGroups' in original) edit().restrictedGroups = original.restrictedGroups
      else delete edit().restrictedGroups
    }
  }
  return next
}

export function newGpo(kind: GpoKind, targetKey: string, target: Obj | undefined): Obj {
  const base: Obj = {
    name: '',
    mode: kind === 'PostConfigureGpo' ? 'createImportAndConfigure' : 'createAndImport',
    importPath: '',
    gpoStatus: 'UserSettingsDisabled',
  }
  if (isLinked(targetKey)) {
    base.linkOrder = nextLinkOrder(target)
    base.linkEnabled = false
  }
  base.gpoComment = ''
  if (kind === 'PostConfigureGpo') {
    base.userRightsAssignments = []
    base.restrictedGroups = { emptyGroups: [], membershipGroups: [] }
  }
  base.comment = ''
  return base
}

export function newRight(right: string): Obj {
  return { right, principals: { resolvableGroups: [], forestRootOnly: [], conditionalGroups: [], literalStrings: [] } }
}

// ------------------------------------------------------------------ validation

export function validateGpo(g: Obj, targetKey: string, target: Obj | undefined, kind: GpoKind, index: number | null): Record<string, string> {
  const e: Record<string, string> = {}
  const name = String(g.name ?? '').trim()
  if (!name) e.name = t('config.gpoModel.nameIsRequired')
  else {
    const dup = GPO_KINDS.some((k) =>
      gpoList(target, k).some((x, i) => !(k === kind && i === index) && String(x?.name ?? '').trim().toLowerCase() === name.toLowerCase()),
    )
    if (dup) e.name = t('config.gpoModel.aGpoWithThisName')
  }
  if (!g.mode) e.mode = t('config.gpoModel.modeIsRequired')
  if (g.mode !== 'create' && !String(g.importPath ?? '').trim()) e.importPath = t('config.gpoModel.importPathIsRequiredExcept')
  if (isLinked(targetKey) || 'linkOrder' in g) {
    if (!Number.isInteger(g.linkOrder) || g.linkOrder < 1) e.linkOrder = t('config.gpoModel.wholeNumber1Required')
  }
  const rights = Array.isArray(g.userRightsAssignments) ? g.userRightsAssignments : []
  const seen = new Set<string>()
  for (const r of rights) {
    if (!r?.right) e.userRightsAssignments = t('config.gpoModel.everyUserRightNeedsA')
    else if (seen.has(r.right)) e.userRightsAssignments = t('config.gpoModel.theRightRightIsPresent', { right: r.right })
    seen.add(r?.right)
    const cg = r?.principals?.conditionalGroups
    if (Array.isArray(cg) && cg.some((c: Obj) => !Array.isArray(c?.names) || c.names.length === 0))
      e.userRightsAssignments = t('config.gpoModel.rightEveryConditionalGroupNeeds', { right: r.right })
  }
  const mg = restrictedAsObject(g.restrictedGroups).membershipGroups
  if (Array.isArray(mg) && mg.some((m: Obj) => !String(m?.groupSidOrName ?? '').trim() || !parseGroupRelation(m.groupSidOrName).group))
    e.restrictedGroups = t('config.gpoModel.everyMembershipNeedsAGroup')
  return e
}
