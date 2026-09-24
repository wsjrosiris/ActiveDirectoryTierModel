import type { RunStatus, Scope } from '@/api/types'

export const scopeLabels: Record<Scope, string> = {
  FullDeployment: 'Vollständig',
  OuOnly: 'Nur OUs',
  GroupOnly: 'Nur Gruppen',
  UserOnly: 'Nur Benutzer',
  GposOnly: 'Nur GPOs',
  OuAclsOnly: 'Nur OU-ACLs',
  AdmxOnly: 'Nur ADMX',
  AuthSilosOnly: 'Nur Authentication Silos',
}

export const scopes = Object.keys(scopeLabels) as Scope[]

export const statusLabels: Record<RunStatus, string> = {
  AwaitingApproval: 'Wartet auf Freigabe',
  Queued: 'In Warteschlange',
  Running: 'Läuft',
  Succeeded: 'Erfolgreich',
  Failed: 'Fehlgeschlagen',
  Cancelled: 'Abgebrochen',
  Rejected: 'Abgelehnt',
  Scheduled: 'Geplant',
}

/** Statuses in which the run is not finished yet (the detail page keeps refreshing). */
export const pendingStatuses: RunStatus[] = ['AwaitingApproval', 'Scheduled', 'Queued', 'Running']

export const includeLabels: Record<string, string> = {
  Msa: 'MSA',
  Gmsa: 'gMSA',
  Dmsa: 'dMSA',
  WinLaps: 'Windows LAPS',
}

export const entityTypeLabels: Record<string, string> = {
  config: 'Konfiguration',
  run: 'Lauf',
  user: 'Benutzer',
  schedule: 'Zeitplan',
  settings: 'Einstellungen',
  notification: 'Benachrichtigung',
  auth: 'Anmeldung',
  maintenance: 'Wartungsfenster',
  token: 'API-Token',
}

export const actionLabels: Record<string, string> = {
  'config.update': 'Konfiguration geändert',
  'config.restore': 'Version wiederhergestellt',
  'run.deploy': 'Deploy gestartet',
  'run.audit': 'Audit gestartet',
  'run.monitor': 'Überwachung gestartet',
  'run.cancel': 'Lauf abgebrochen',
  'run.approve': 'Deploy freigegeben',
  'run.reject': 'Deploy abgelehnt',
  'run.approval-expired': 'Freigabe abgelaufen',
  'run.window-start': 'Wartungsfenster erreicht',
  'maintenance.window-create': 'Wartungsfenster angelegt',
  'maintenance.window-update': 'Wartungsfenster geändert',
  'maintenance.window-delete': 'Wartungsfenster gelöscht',
  'maintenance.freeze-create': 'Sperrzeit angelegt',
  'maintenance.freeze-update': 'Sperrzeit geändert',
  'maintenance.freeze-delete': 'Sperrzeit gelöscht',
  'token.create': 'API-Token erstellt',
  'token.revoke': 'API-Token widerrufen',
  'user.create': 'Benutzer angelegt',
  'user.update': 'Benutzer geändert',
  'user.delete': 'Benutzer gelöscht',
  'user.reset-password': 'Passwort zurückgesetzt',
  'user.unlock': 'Benutzer entsperrt',
  'auth.login': 'Anmeldung',
  'auth.logout': 'Abmeldung',
  'auth.login-failed': 'Fehlgeschlagene Anmeldung',
  'auth.change-password': 'Passwort geändert',
  'auth.windows-login': 'Windows-Anmeldung',
  'auth.windows-denied': 'Windows-Anmeldung abgelehnt',
  'auth.entra-login': 'Entra-ID-Anmeldung',
  'auth.entra-denied': 'Entra-ID-Anmeldung abgelehnt',
  'settings.entra-auth': 'Entra-ID-Anmeldung geändert',
  'settings.report-schedules': 'Berichtszeitpläne geändert',
  'report.send': 'Bericht versendet',
  'report.failed': 'Berichtsversand fehlgeschlagen',
  'schedule.create': 'Zeitplan angelegt',
  'schedule.update': 'Zeitplan geändert',
  'schedule.delete': 'Zeitplan gelöscht',
  'schedule.run': 'Zeitplan ausgeführt',
  'settings.update': 'Einstellungen geändert',
  'settings.windows-auth': 'Windows-Anmeldung geändert',
  'notification.create': 'Benachrichtigungskanal angelegt',
  'notification.update': 'Benachrichtigungskanal geändert',
  'notification.delete': 'Benachrichtigungskanal gelöscht',
  'notification.test': 'Testnachricht gesendet',
  'notification.failed': 'Benachrichtigung fehlgeschlagen',
  'smtp.update': 'SMTP-Einstellungen geändert',
  'setup.complete': 'Einrichtung abgeschlossen',
}

export const findingTypeLabels: Record<string, string> = {
  Missing: 'Fehlend',
  Unexpected: 'Unerwartet',
  Mismatch: 'Abweichung',
  Error: 'Fehler',
  Ok: 'OK',
  Match: 'Übereinstimmung',
}

export const sectionGroups: { title: string; keys: string[] }[] = [
  { title: 'Struktur', keys: ['ous', 'groups', 'users'] },
  { title: 'Delegationen', keys: ['acls', 'msa', 'gmsa', 'dmsa', 'winlaps'] },
  { title: 'Richtlinien', keys: ['gpos', 'authsilos', 'admx', 'adml-en-US'] },
  { title: 'System', keys: ['metadata', 'guid-mappings', 'dependencies'] },
]

export const sectionFallbackTitles: Record<string, string> = {
  ous: 'Organisationseinheiten',
  groups: 'Gruppen',
  users: 'Benutzer',
  acls: 'ACL-Delegationen',
  msa: 'MSA-Delegationen',
  gmsa: 'gMSA-Delegationen',
  dmsa: 'dMSA-Delegationen',
  winlaps: 'Windows LAPS',
  gpos: 'Gruppenrichtlinien',
  authsilos: 'Authentication Silos',
  admx: 'ADMX-Vorlagen',
  'adml-en-US': 'ADML (en-US)',
  metadata: 'Metadaten',
  'guid-mappings': 'GUID-Zuordnungen',
  dependencies: 'Abhängigkeiten',
}

export const severityLabels: Record<string, string> = {
  High: 'Hoch',
  Medium: 'Mittel',
  Low: 'Niedrig',
}

/** Areas of audit findings and plan actions. */
export const areaLabels: Record<string, string> = {
  ous: 'OUs',
  groups: 'Gruppen',
  users: 'Benutzer',
  acls: 'OU-ACLs',
  gpos: 'GPOs',
  admx: 'ADMX',
  msa: 'MSA',
  gmsa: 'gMSA',
  dmsa: 'dMSA',
  winlaps: 'Windows LAPS',
  authsilos: 'Authentication Silos',
}

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
export const areaPlanLabels: Record<string, string> = {
  ous: 'Nur OUs',
  groups: 'Nur Gruppen',
  users: 'Nur Benutzer',
  acls: 'Nur OU-ACLs',
  gpos: 'Nur GPOs',
  admx: 'Nur ADMX',
  msa: 'Add-on MSA',
  gmsa: 'Add-on gMSA',
  dmsa: 'Add-on dMSA',
  winlaps: 'Add-on Windows LAPS',
  authsilos: 'Nur Authentication Silos',
}

export const objectClassLabels: Record<string, string> = {
  user: 'Benutzer',
  inetOrgPerson: 'Benutzer',
  group: 'Gruppe',
  computer: 'Computer',
  'msDS-GroupManagedServiceAccount': 'gMSA',
  'msDS-ManagedServiceAccount': 'MSA',
  'msDS-DelegatedManagedServiceAccount': 'dMSA',
  foreignSecurityPrincipal: 'Fremder Prinzipal',
  other: 'Objekt',
}

export const aclObjectTypeLabels: Record<string, string> = {
  DomainRoot: 'Domänenstamm',
  AdminSDHolder: 'AdminSDHolder',
  ProtectedGroup: 'Geschützte Gruppe',
  Tier0OU: 'Tier-0-OU',
  Tier0GPO: 'Tier-0-GPO',
  DomainControllersOU: 'OU der Domänencontroller',
}

/** Short German explanation of dangerous AD rights. */
export const rightDescriptions: Record<string, string> = {
  GenericAll: 'Vollzugriff auf das Objekt',
  GenericWrite: 'Darf alle Attribute schreiben',
  WriteDacl: 'Darf die Berechtigungen ändern',
  WriteOwner: 'Darf den Besitz übernehmen',
  Owner: 'Ist Besitzer des Objekts',
  AllExtendedRights: 'Alle erweiterten Rechte (z. B. Replikation, Kennwort zurücksetzen)',
  WriteMember: 'Darf Mitglieder hinzufügen',
  ResetPassword: 'Darf Kennwörter zurücksetzen',
  WriteProperty: 'Darf Attribute schreiben',
}
