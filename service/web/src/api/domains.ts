// Several managed domains (roadmap 17).
import { request } from './client'

export interface Domain {
  id: number
  /** Short name: header X-TierModel-Domain, Git folder, PowerShell -Domain. */
  key: string
  displayName: string
  dnsName: string
  preferredDc: string
  admlLanguage: string
  enabled: boolean
  isDefault: boolean
  createdAt: string
  notes: string | null
}

export type DomainInput = Pick<Domain, 'key' | 'displayName' | 'dnsName' | 'preferredDc' | 'admlLanguage' | 'enabled' | 'isDefault' | 'notes'>

export interface DomainControllerInfo {
  name: string
  site: string | null
  isGlobalCatalog: boolean
}

export interface DomainCheck {
  ok: boolean
  message: string
  source: string
  domain: {
    dnsName: string
    distinguishedName: string
    netBiosName: string
    domainFunctionalLevel: string
    forestFunctionalLevel: string
    forestName: string
    domainControllers: DomainControllerInfo[]
  } | null
}

export interface DomainTierScore {
  tier: number
  score: number
}

export interface DomainRunInfo {
  id: number
  status: string
  at: string | null
  driftCount: number | null
}

export interface DomainOverview {
  id: number
  key: string
  displayName: string
  dnsName: string
  enabled: boolean
  isDefault: boolean
  compliance: DomainTierScore[] | null
  lastAudit: DomainRunInfo | null
  lastMonitor: DomainRunInfo | null
  pendingApprovals: number
  active: number
  setupNeeded: boolean
}

export interface DomainDeletion {
  canDelete: boolean
  reason: string | null
}

const post = <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body })

export const domainsApi = {
  list: () => request<Domain[]>('/api/domains'),
  overview: () => request<DomainOverview[]>('/api/domains/overview'),
  create: (body: DomainInput) => post<Domain>('/api/domains', body),
  update: (id: number, body: DomainInput) => request<Domain>(`/api/domains/${id}`, { method: 'PUT', body }),
  remove: (id: number) => request<void>(`/api/domains/${id}`, { method: 'DELETE' }),
  deletion: (id: number) => request<DomainDeletion>(`/api/domains/${id}/deletion`),
  check: (dnsName: string, preferredDc: string) => post<DomainCheck>('/api/domains/check', { dnsName, preferredDc }),
}
