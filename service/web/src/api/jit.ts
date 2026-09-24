// Roadmap 6: Just-in-Time admin access (time-limited group membership with four-eyes approval).
import { request } from './client'
import type { Role, RunSummary } from './types'

export type JitStatus = 'Pending' | 'Approved' | 'Rejected' | 'Active' | 'Expired' | 'Revoked' | 'Failed' | 'Cancelled'

export interface JitRequest {
  id: number
  requestedBy: string
  memberAccount: string
  groupId: number | null
  group: string
  groupDisplayName: string
  tier: number | null
  minutes: number
  justification: string
  status: JitStatus
  approvalRequired: boolean
  requestedAt: string
  approvalExpiresAt: string | null
  decidedBy: string | null
  decidedAt: string | null
  decisionComment: string | null
  grantedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  revokedBy: string | null
  runId: number | null
  revokeRunId: number | null
  dc: string | null
  message: string | null
  /** Requested by the current user. */
  mine: boolean
  canDecide: boolean
  canWithdraw: boolean
  canRevoke: boolean
}

export interface JitRequestInput {
  groupId: number
  minutes: number
  justification: string
  /** Empty: the requester's own AD account. Only administrators may choose another account. */
  memberAccount?: string | null
}

export type JitPrerequisiteStatus = 'Unknown' | 'Running' | 'Ready' | 'NotReady' | 'Error'

export interface JitPrerequisite {
  status: JitPrerequisiteStatus
  runId: number | null
  checkedAt: string | null
  dc: string | null
  pamEnabled: boolean | null
  forestMode: string | null
  forestLevelSufficient: boolean | null
  messages: string[]
  error: string | null
}

export interface EligibleJitGroup {
  id: number
  group: string
  displayName: string
  tier: number | null
  maxMinutes: number
  requiresApproval: boolean
}

export interface JitOverview {
  prerequisite: JitPrerequisite
  groups: EligibleJitGroup[]
  defaultMemberAccount: string
  canChooseMember: boolean
  canDecide: boolean
  canCheck: boolean
  defaultDc: string | null
  durations: number[]
}

export interface JitGroup {
  id: number
  group: string
  groupSid: string | null
  displayName: string
  tier: number | null
  maxMinutes: number
  requiresApproval: boolean
  minimumRole: Role
  eligibleUsers: string[]
  enabled: boolean
  createdBy: string
  createdAt: string
  updatedAt: string | null
}

export type JitGroupInput = Pick<JitGroup, 'group' | 'groupSid' | 'displayName' | 'tier' | 'maxMinutes' | 'requiresApproval' | 'minimumRole' | 'eligibleUsers' | 'enabled'>

export interface JitGroupCandidate { group: string; displayName: string; sid: string | null; tier: number | null; source: string }
export interface JitAccountCandidate { account: string; displayName: string; source: string }

const post = <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body })
const enc = encodeURIComponent

export const jitApi = {
  overview: () => request<JitOverview>('/api/jit/overview'),
  requests: () => request<JitRequest[]>('/api/jit/requests'),
  create: (body: JitRequestInput) => post<JitRequest>('/api/jit/requests', body),
  approve: (id: number, comment?: string) => post<JitRequest>(`/api/jit/requests/${id}/approve`, comment ? { comment } : {}),
  reject: (id: number, comment: string) => post<JitRequest>(`/api/jit/requests/${id}/reject`, { comment }),
  withdraw: (id: number) => post<JitRequest>(`/api/jit/requests/${id}/withdraw`),
  revoke: (id: number) => post<JitRequest>(`/api/jit/requests/${id}/revoke`),
  check: (preferredDc?: string) => post<RunSummary>('/api/jit/prerequisite/check', { preferredDc: preferredDc || null }),
  groups: {
    list: () => request<JitGroup[]>('/api/jit/groups'),
    create: (body: JitGroupInput) => post<JitGroup>('/api/jit/groups', body),
    update: (id: number, body: JitGroupInput) => request<JitGroup>(`/api/jit/groups/${id}`, { method: 'PUT', body }),
    remove: (id: number) => request<void>(`/api/jit/groups/${id}`, { method: 'DELETE' }),
  },
  lookup: {
    groups: (q: string, signal?: AbortSignal) => request<JitGroupCandidate[]>(`/api/jit/lookup/groups?q=${enc(q)}`, { signal }),
    accounts: (q: string, signal?: AbortSignal) => request<JitAccountCandidate[]>(`/api/jit/lookup/accounts?q=${enc(q)}`, { signal }),
  },
}
