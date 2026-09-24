/* Data model, constants and pure helpers for the GPO section (tiermodel-gpos.json).
 *
 * All helpers treat their input as immutable and preserve unknown keys: objects are always
 * spread from the original, never rebuilt. Kept free of React and path aliases so the
 * round-trip checks can run it directly in Node. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Obj = Record<string, any>

export type GpoKind = 'ImportOnlyGpo' | 'PostConfigureGpo'
export const GPO_KINDS: GpoKind[] = ['ImportOnlyGpo', 'PostConfigureGpo']

export const DOMAIN_DN = '{{DOMAIN_DN}}'
export const DC_OU = `OU=Domain Controllers,${DOMAIN_DN}`
export const TEMPLATE_KEY = 'TemplateGpos'

export const kindLabels: Record<GpoKind, string> = {
  ImportOnlyGpo: 'Nur importieren',
  PostConfigureGpo: 'Importieren & konfigurieren',
}
export const kindDescriptions: Record<GpoKind, string> = {
  ImportOnlyGpo: 'GPOs, deren Einstellungen unverändert aus einem Backup übernommen (oder leer angelegt) werden.',
  PostConfigureGpo: 'GPOs, die nach dem Import zusätzlich mit Benutzerrechten, eingeschränkten Gruppen und Filtern konfiguriert werden.',
}

// ------------------------------------------------------------------ modes & status

export const GPO_MODES = [
  { value: 'create', label: 'Nur anlegen', short: 'Anlegen', description: 'Leere GPO als Platzhalter anlegen – es werden keine Einstellungen importiert.' },
  { value: 'createAndImport', label: 'Anlegen & importieren', short: 'Import', description: 'GPO anlegen und die Einstellungen aus dem angegebenen Backup importieren.' },
  {
    value: 'createImportAndConfigure',
    label: 'Anlegen, importieren & konfigurieren',
    short: 'Konfiguriert',
    description: 'Wie „Anlegen & importieren“, danach zusätzlich Benutzerrechte, eingeschränkte Gruppen und Filter setzen.',
  },
] as const

export const GPO_STATUSES = [
  { value: 'AllSettingsEnabled', label: 'Alle Einstellungen aktiviert', short: 'Alle aktiv' },
  { value: 'UserSettingsDisabled', label: 'Benutzereinstellungen deaktiviert', short: 'Benutzer aus' },
  { value: 'ComputerSettingsDisabled', label: 'Computereinstellungen deaktiviert', short: 'Computer aus' },
  { value: 'AllSettingsDisabled', label: 'Alle Einstellungen deaktiviert', short: 'Alle aus' },
] as const

export const modeMeta = (m: unknown) => GPO_MODES.find((x) => x.value === m)
export const statusMeta = (s: unknown) => GPO_STATUSES.find((x) => x.value === s)

// ------------------------------------------------------------------ user rights

export const USER_RIGHTS: { value: string; label: string }[] = [
  { value: 'SeNetworkLogonRight', label: 'Auf diesen Computer vom Netzwerk aus zugreifen' },
  { value: 'SeDenyNetworkLogonRight', label: 'Zugriff vom Netzwerk auf diesen Computer verweigern' },
  { value: 'SeInteractiveLogonRight', label: 'Lokal anmelden zulassen' },
  { value: 'SeDenyInteractiveLogonRight', label: 'Lokale Anmeldung verweigern' },
  { value: 'SeRemoteInteractiveLogonRight', label: 'Anmelden über Remotedesktopdienste zulassen' },
  { value: 'SeDenyRemoteInteractiveLogonRight', label: 'Anmelden über Remotedesktopdienste verweigern' },
  { value: 'SeBatchLogonRight', label: 'Anmelden als Stapelverarbeitungsauftrag' },
  { value: 'SeDenyBatchLogonRight', label: 'Anmelden als Stapelverarbeitungsauftrag verweigern' },
  { value: 'SeServiceLogonRight', label: 'Anmelden als Dienst' },
  { value: 'SeDenyServiceLogonRight', label: 'Anmelden als Dienst verweigern' },
  { value: 'SeImpersonatePrivilege', label: 'Annehmen der Clientidentität nach Authentifizierung' },
  { value: 'SeAssignPrimaryTokenPrivilege', label: 'Ersetzen eines Tokens auf Prozessebene' },
  { value: 'SeIncreaseQuotaPrivilege', label: 'Anpassen von Speicherkontingenten für einen Prozess' },
  { value: 'SeAuditPrivilege', label: 'Generieren von Sicherheitsüberwachungen' },
  { value: 'SeChangeNotifyPrivilege', label: 'Auslassen der durchsuchenden Überprüfung' },
  { value: 'SeBackupPrivilege', label: 'Sichern von Dateien und Verzeichnissen' },
  { value: 'SeRestorePrivilege', label: 'Wiederherstellen von Dateien und Verzeichnissen' },
  { value: 'SeDebugPrivilege', label: 'Debuggen von Programmen' },
  { value: 'SeTcbPrivilege', label: 'Einsetzen als Teil des Betriebssystems' },
  { value: 'SeTakeOwnershipPrivilege', label: 'Übernehmen des Besitzes von Dateien und Objekten' },
  { value: 'SeLoadDriverPrivilege', label: 'Laden und Entfernen von Gerätetreibern' },
  { value: 'SeSecurityPrivilege', label: 'Verwalten von Überwachungs- und Sicherheitsprotokollen' },
  { value: 'SeSystemtimePrivilege', label: 'Ändern der Systemzeit' },
  { value: 'SeTimeZonePrivilege', label: 'Ändern der Zeitzone' },
  { value: 'SeShutdownPrivilege', label: 'Herunterfahren des Systems' },
  { value: 'SeRemoteShutdownPrivilege', label: 'Erzwingen des Herunterfahrens von einem Remotesystem aus' },
  { value: 'SeMachineAccountPrivilege', label: 'Hinzufügen von Arbeitsstationen zur Domäne' },
  { value: 'SeEnableDelegationPrivilege', label: 'Ermöglichen, dass Computer- und Benutzerkonten für Delegierungszwecke vertraut wird' },
  { value: 'SeCreateTokenPrivilege', label: 'Erstellen eines Tokenobjekts' },
  { value: 'SeCreateGlobalPrivilege', label: 'Erstellen globaler Objekte' },
  { value: 'SeCreatePagefilePrivilege', label: 'Erstellen einer Auslagerungsdatei' },
  { value: 'SeCreatePermanentPrivilege', label: 'Erstellen dauerhaft freigegebener Objekte' },
  { value: 'SeCreateSymbolicLinkPrivilege', label: 'Erstellen symbolischer Verknüpfungen' },
  { value: 'SeIncreaseBasePriorityPrivilege', label: 'Anheben der Zeitplanungspriorität' },
  { value: 'SeIncreaseWorkingSetPrivilege', label: 'Arbeitssatz eines Prozesses vergrößern' },
  { value: 'SeLockMemoryPrivilege', label: 'Sperren von Seiten im Speicher' },
  { value: 'SeManageVolumePrivilege', label: 'Durchführen von Volumewartungsaufgaben' },
  { value: 'SeProfileSingleProcessPrivilege', label: 'Erstellen eines Profils für einen Einzelprozess' },
  { value: 'SeSystemProfilePrivilege', label: 'Erstellen eines Profils der Systemleistung' },
  { value: 'SeSystemEnvironmentPrivilege', label: 'Verändern der Firmwareumgebungsvariablen' },
  { value: 'SeUndockPrivilege', label: 'Entfernen des Computers von der Dockingstation' },
  { value: 'SeSyncAgentPrivilege', label: 'Synchronisieren von Verzeichnisdienstdaten' },
  { value: 'SeTrustedCredManAccessPrivilege', label: 'Auf Anmeldeinformations-Manager als vertrauenswürdigem Aufrufer zugreifen' },
  { value: 'SeRelabelPrivilege', label: 'Bezeichnung eines Objekts ändern' },
  { value: 'SeDelegateSessionUserImpersonatePrivilege', label: 'Identitätswechsel-Token für anderen Benutzer in derselben Sitzung abrufen' },
]
export const rightLabel = (r: string) => USER_RIGHTS.find((x) => x.value === r)?.label

// ------------------------------------------------------------------ principals

/** Well-known literal entries for user rights (written verbatim, not resolved). */
export const LITERAL_SUGGESTIONS: { value: string; label: string }[] = [
  { value: '*S-1-5-32-544', label: 'Administratoren' },
  { value: '*S-1-5-32-545', label: 'Benutzer' },
  { value: '*S-1-5-32-546', label: 'Gäste' },
  { value: '*S-1-5-32-551', label: 'Sicherungs-Operatoren' },
  { value: '*S-1-5-32-555', label: 'Remotedesktopbenutzer' },
  { value: '*S-1-5-32-568', label: 'IIS_IUSRS' },
  { value: '*S-1-5-19', label: 'Lokaler Dienst' },
  { value: '*S-1-5-20', label: 'Netzwerkdienst' },
  { value: '*S-1-5-18', label: 'Lokales System' },
  { value: '*S-1-5-6', label: 'Dienst' },
  { value: '*S-1-5-11', label: 'Authentifizierte Benutzer' },
  { value: '*S-1-1-0', label: 'Jeder' },
  { value: '*S-1-5-113', label: 'Lokales Konto' },
  { value: '*S-1-5-114', label: 'Lokales Konto und Mitglied der Gruppe „Administratoren“' },
  { value: '*S-1-5-9', label: 'Domänencontroller der Organisation' },
  { value: 'NT SERVICE\\ALL SERVICES', label: 'Alle Dienste (NT SERVICE)' },
  { value: 'NT SERVICE\\WdiServiceHost', label: 'Diagnosesystemhost (NT SERVICE)' },
]

export const FOREST_ROOT_SUGGESTIONS: { value: string; label: string }[] = [
  { value: 'Enterprise Admins', label: 'Organisations-Admins (Enterprise Admins)' },
  { value: 'Schema Admins', label: 'Schema-Admins (Schema Admins)' },
  { value: 'Enterprise Key Admins', label: 'Organisationsschlüsseladministratoren (Enterprise Key Admins)' },
  { value: 'Enterprise Read-only Domain Controllers', label: 'Schreibgeschützte Domänencontroller der Organisation' },
]

/** Additional principals used by GPO user rights/memberships (resolved by name). */
export const GPO_BUILTIN_PRINCIPALS = [
  'Administrators', 'Administrator', 'Guest', 'Guests', 'SYSTEM', 'Authenticated Users', 'Everyone',
  'Local account', 'NT AUTHORITY\\Local account', 'IUSR', 'IIS_IUSRS', 'Backup Operators',
  'Domain Admins', 'Domain Controllers', 'Read-only Domain Controllers', 'Cloneable Domain Controllers',
  'Cert Publishers', 'Cryptographic Operators', 'Group Policy Creator Owners', 'Key Admins',
  'Allowed RODC Password Replication Group', 'DnsAdmins', 'DnsUpdateProxy',
]

export const CONDITIONS = [{ type: 'groupExists', operator: 'exists', label: 'Gruppe existiert' }]

// ------------------------------------------------------------------ restricted groups

export const BUILTIN_GROUPS: { value: string; label: string; hint: string }[] = [
  ['544', 'Administratoren'], ['545', 'Benutzer'], ['546', 'Gäste'], ['547', 'Hauptbenutzer'],
  ['548', 'Konten-Operatoren'], ['549', 'Server-Operatoren'], ['550', 'Druck-Operatoren'],
  ['551', 'Sicherungs-Operatoren'], ['552', 'Replikations-Operator'], ['555', 'Remotedesktopbenutzer'],
  ['556', 'Netzwerkkonfigurations-Operatoren'], ['558', 'Leistungsüberwachungsbenutzer'],
  ['559', 'Leistungsprotokollbenutzer'], ['562', 'DCOM-Benutzer'], ['568', 'IIS_IUSRS'],
  ['569', 'Kryptografie-Operatoren'], ['573', 'Ereignisprotokollleser'], ['574', 'Zertifikatdienst-DCOM-Zugriff'],
  ['575', 'RDS-Remotezugriffsserver'], ['576', 'RDS-Endpunktserver'], ['577', 'RDS-Verwaltungsserver'],
  ['578', 'Hyper-V-Administratoren'], ['579', 'Zugriffssteuerungsunterstützungs-Operatoren'],
  ['580', 'Remoteverwaltungsbenutzer'], ['582', 'Speicherreplikatadministratoren'], ['583', 'Geräteeigentümer'],
  ['585', 'OpenSSH Users'],
]
  .map(([rid, label]) => ({ value: `*S-1-5-32-${rid}`, label, hint: `S-1-5-32-${rid}` }))
  .concat([
    { value: 'Power Users', label: 'Power Users', hint: 'Gruppenname (ohne SID)' },
    { value: 'User Mode Hardware Operators', label: 'User Mode Hardware Operators', hint: 'Gruppenname (ohne SID)' },
  ])

export const builtinGroupLabel = (g: string) => BUILTIN_GROUPS.find((b) => b.value.toLowerCase() === g.toLowerCase())?.label ?? g

export type RelationSuffix = 'Members' | 'Memberof'
export const relationLabels: Record<RelationSuffix, string> = { Members: 'Mitglieder', Memberof: 'Mitglied von' }

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
  if (key === TEMPLATE_KEY) return 'Vorlagen (nicht verknüpft)'
  if (key === DOMAIN_DN) return 'Domänenstamm'
  const first = key.split(',')[0] ?? key
  const rdn = first.replace(/^(OU|CN)=/i, '')
  return rdn || (typeof tt?.displayName === 'string' && tt.displayName) || key
}

export function targetHint(key: string): string {
  if (key === TEMPLATE_KEY) return 'Werden angelegt, aber nicht verknüpft'
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
  if (!name) e.name = 'Name ist erforderlich.'
  else {
    const dup = GPO_KINDS.some((k) =>
      gpoList(target, k).some((x, i) => !(k === kind && i === index) && String(x?.name ?? '').trim().toLowerCase() === name.toLowerCase()),
    )
    if (dup) e.name = 'Eine GPO mit diesem Namen ist bereits mit diesem Ziel verknüpft.'
  }
  if (!g.mode) e.mode = 'Modus ist erforderlich.'
  if (g.mode !== 'create' && !String(g.importPath ?? '').trim()) e.importPath = 'Import-Pfad ist erforderlich (außer im Modus „Nur anlegen“).'
  if (isLinked(targetKey) || 'linkOrder' in g) {
    if (!Number.isInteger(g.linkOrder) || g.linkOrder < 1) e.linkOrder = 'Ganze Zahl ≥ 1 erforderlich.'
  }
  const rights = Array.isArray(g.userRightsAssignments) ? g.userRightsAssignments : []
  const seen = new Set<string>()
  for (const r of rights) {
    if (!r?.right) e.userRightsAssignments = 'Jedes Benutzerrecht braucht eine Auswahl.'
    else if (seen.has(r.right)) e.userRightsAssignments = `Das Recht ${r.right} ist doppelt vorhanden.`
    seen.add(r?.right)
    const cg = r?.principals?.conditionalGroups
    if (Array.isArray(cg) && cg.some((c: Obj) => !Array.isArray(c?.names) || c.names.length === 0))
      e.userRightsAssignments = `${r.right}: Jede bedingte Gruppe braucht mindestens einen Gruppennamen.`
  }
  const mg = restrictedAsObject(g.restrictedGroups).membershipGroups
  if (Array.isArray(mg) && mg.some((m: Obj) => !String(m?.groupSidOrName ?? '').trim() || !parseGroupRelation(m.groupSidOrName).group))
    e.restrictedGroups = 'Jede Mitgliedschaft braucht eine Gruppe.'
  return e
}
