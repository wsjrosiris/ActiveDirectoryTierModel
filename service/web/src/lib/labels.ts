import type { RunStatus, Scope } from '@/api/types'

export const scopeLabels: Record<Scope, string> = {
  FullDeployment: 'Vollständig',
  OuOnly: 'Nur OUs',
  GroupOnly: 'Nur Gruppen',
  UserOnly: 'Nur Benutzer',
  GposOnly: 'Nur GPOs',
  OuAclsOnly: 'Nur OU-ACLs',
  AdmxOnly: 'Nur ADMX',
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
}

/** Statuses in which the run is not finished yet (the detail page keeps refreshing). */
export const pendingStatuses: RunStatus[] = ['AwaitingApproval', 'Queued', 'Running']

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
}

export const actionLabels: Record<string, string> = {
  'config.update': 'Konfiguration geändert',
  'config.restore': 'Version wiederhergestellt',
  'run.deploy': 'Deploy gestartet',
  'run.audit': 'Audit gestartet',
  'run.cancel': 'Lauf abgebrochen',
  'run.approve': 'Deploy freigegeben',
  'run.reject': 'Deploy abgelehnt',
  'run.approval-expired': 'Freigabe abgelaufen',
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
  { title: 'Richtlinien', keys: ['gpos', 'admx', 'adml-en-US'] },
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
  admx: 'ADMX-Vorlagen',
  'adml-en-US': 'ADML (en-US)',
  metadata: 'Metadaten',
  'guid-mappings': 'GUID-Zuordnungen',
  dependencies: 'Abhängigkeiten',
}
