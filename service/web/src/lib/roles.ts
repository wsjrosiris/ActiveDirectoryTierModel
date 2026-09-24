import type { Role } from '@/api/types'
import { lazyRecord } from '@/i18n'

const rank: Record<Role, number> = { Viewer: 0, Editor: 1, Operator: 2, Admin: 3 }

export function hasRole(actual: Role | undefined | null, required: Role) {
  if (!actual) return false
  return rank[actual] >= rank[required]
}

export const roleLabels: Record<Role, string> = lazyRecord('lib.roles.label')

export const roleDescriptions: Record<Role, string> = lazyRecord('lib.roles.description')

export const roles: Role[] = ['Viewer', 'Editor', 'Operator', 'Admin']
