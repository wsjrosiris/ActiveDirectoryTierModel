// Phase 4 (roadmap 4, 18, 23): maintenance windows and freezes, API tokens, change-log hash chain.
import { request } from './client'
import type { Role } from './types'

export interface MaintenanceWindow {
  id: number
  name: string
  /** Weekdays as numbers, 0 = Sunday … 6 = Saturday. */
  days: number[]
  /** "HH:mm" local time of timeZone; to <= from ends on the next day, to == from is a whole day. */
  from: string
  to: string
  timeZone: string
  enabled: boolean
  createdBy: string
  createdAt: string
}

export type MaintenanceWindowInput = Pick<MaintenanceWindow, 'name' | 'days' | 'from' | 'to' | 'timeZone' | 'enabled'>

export interface FreezePeriod {
  id: number
  from: string
  to: string
  reason: string
  enabled: boolean
  active: boolean
  past: boolean
  createdBy: string
  createdAt: string
}

export type FreezePeriodInput = Pick<FreezePeriod, 'from' | 'to' | 'reason' | 'enabled'>

export interface FreezeInfo {
  id: number
  reason: string
  from: string
  to: string
}

export interface WindowInstance {
  windowId: number
  name: string
  start: string
  end: string
}

export interface MaintenanceStatus {
  /** At least one enabled window exists. */
  restricted: boolean
  /** An apply requested now starts immediately. */
  allowedNow: boolean
  activeFreeze: FreezeInfo | null
  currentWindow: WindowInstance | null
  /** When an apply requested now would start. */
  nextStart: string | null
  nextWindow: WindowInstance | null
  upcoming: WindowInstance[]
  upcomingFreezes: FreezeInfo[]
  scheduledRuns: number
}

export interface MaintenanceOverview {
  windows: MaintenanceWindow[]
  freezes: FreezePeriod[]
  status: MaintenanceStatus
}

export type ApiTokenState = 'Active' | 'Expired' | 'Revoked' | 'Inactive'

export interface ApiToken {
  id: string
  name: string
  prefix: string
  role: Role
  /** Role capped at the owner's current role. */
  effectiveRole: Role
  userId: string
  username: string
  createdAt: string
  expiresAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  revokedBy: string | null
  state: ApiTokenState
}

export interface CreateTokenRequest {
  name: string
  role: Role
  expiresInDays: number
}

export interface CreatedToken {
  info: ApiToken
  /** Shown exactly once. */
  token: string
}

export interface ChainVerification {
  ok: boolean
  count: number
  lastId: number | null
  /** Admins only. */
  lastHash: string | null
  brokenAtId: number | null
  problem: string | null
  checkedAt: string
}

const post = <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body })
const put = <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body })
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' })

export const opsApi = {
  maintenance: {
    overview: () => request<MaintenanceOverview>('/api/maintenance'),
    status: () => request<MaintenanceStatus>('/api/maintenance/status'),
    createWindow: (body: MaintenanceWindowInput) => post<MaintenanceWindow>('/api/maintenance/windows', body),
    updateWindow: (id: number, body: MaintenanceWindowInput) => put<MaintenanceWindow>(`/api/maintenance/windows/${id}`, body),
    removeWindow: (id: number) => del<void>(`/api/maintenance/windows/${id}`),
    createFreeze: (body: FreezePeriodInput) => post<FreezePeriod>('/api/maintenance/freezes', body),
    updateFreeze: (id: number, body: FreezePeriodInput) => put<FreezePeriod>(`/api/maintenance/freezes/${id}`, body),
    removeFreeze: (id: number) => del<void>(`/api/maintenance/freezes/${id}`),
  },
  tokens: {
    list: (all = false) => request<ApiToken[]>(`/api/tokens${all ? '?all=true' : ''}`),
    create: (body: CreateTokenRequest) => post<CreatedToken>('/api/tokens', body),
    revoke: (id: string) => post<ApiToken>(`/api/tokens/${encodeURIComponent(id)}/revoke`),
  },
  changelog: {
    chain: () => request<ChainVerification>('/api/changelog/chain'),
    verify: () => request<ChainVerification>('/api/changelog/verify'),
  },
}
