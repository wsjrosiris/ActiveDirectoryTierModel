import type { Role } from '@/api/types'

const rank: Record<Role, number> = { Viewer: 0, Editor: 1, Operator: 2, Admin: 3 }

export function hasRole(actual: Role | undefined | null, required: Role) {
  if (!actual) return false
  return rank[actual] >= rank[required]
}

export const roleLabels: Record<Role, string> = {
  Viewer: 'Betrachter',
  Editor: 'Bearbeiter',
  Operator: 'Operator',
  Admin: 'Administrator',
}

export const roleDescriptions: Record<Role, string> = {
  Viewer: 'Alles lesen',
  Editor: 'Konfiguration bearbeiten, Audits starten, Deploy planen',
  Operator: 'Deploy anwenden, Zeitpläne verwalten, Läufe abbrechen',
  Admin: 'Benutzer und Einstellungen verwalten',
}

export const roles: Role[] = ['Viewer', 'Editor', 'Operator', 'Admin']
