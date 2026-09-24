// Import from another instance / export ZIP (roadmap 15) and Git mirror (roadmap 16).
import { request } from './client'

export type ImportStatus = 'unchanged' | 'changed' | 'new' | 'invalid' | 'unknown'

export interface ReplacementRule {
  search: string
  replace: string
}

export interface ImportIssue {
  severity: 'Error' | 'Warning'
  section: string
  message: string
  item?: string | null
  /** Caused by the import (not present in the current configuration). */
  isNew: boolean
}

export interface ImportPreviewSection {
  key: string
  title: string
  fileName: string
  status: ImportStatus
  baseVersion: number | null
  sourceVersion: number | null
  replacements: number
  error: string | null
  /** Only for changed / new sections: used to compute the readable change list, never displayed raw. */
  current: unknown
  incoming: unknown
}

export interface ImportPreview {
  id: string
  label: string
  sourceKind: 'file' | 'remote'
  createdAt: string
  replacements: ReplacementRule[]
  notices: string[]
  sections: ImportPreviewSection[]
  issues: ImportIssue[]
}

export interface ImportApplyResult {
  applied: { key: string; title: string; fromVersion: number; toVersion: number }[]
}

export interface RemoteInstance {
  id: string
  name: string
  url: string
  tokenHint: string
  createdAt: string
  createdBy: string
  lastCheckedAt: string | null
  lastCheckOk: boolean | null
  lastCheckMessage: string | null
}

export interface RemoteInstanceInput {
  name: string
  url: string
  token?: string
}

export interface RemoteCheckResult {
  ok: boolean
  message: string
  sectionCount: number | null
  /** Domains of the other instance (roadmap 17); empty for older instances. */
  domains?: { key: string; displayName: string; dnsName: string; isDefault: boolean }[] | null
}

export type GitState = 'disabled' | 'never' | 'ok' | 'pending' | 'busy' | 'error' | 'conflict'

export interface GitStatus {
  state: GitState
  lastSyncAt: string | null
  lastCommit: string | null
  lastError: string | null
  lastErrorAt: string | null
  conflict: boolean
  conflictSince: string | null
  pending: number
  busy: boolean
  nextRetryAt: string | null
}

export interface GitSettings {
  enabled: boolean
  repositoryUrl: string
  branch: string
  username: string
  hasPassword: boolean
  authorName: string
  authorEmail: string
  pathInRepo: string
  pushOnSave: boolean
  /** file:// repositories are accepted (development only). */
  allowFileUrls: boolean
  status: GitStatus
}

export interface GitSettingsInput {
  enabled: boolean
  repositoryUrl: string
  branch: string
  username: string
  password?: string
  clearPassword?: boolean
  authorName: string
  authorEmail: string
  pathInRepo: string
  pushOnSave: boolean
}

const post = <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body })
const enc = encodeURIComponent

export const transferApi = {
  uploadZip: (file: File) =>
    request<ImportPreview>(`/api/config/import/file?fileName=${enc(file.name)}`, {
      method: 'POST',
      raw: new Blob([file], { type: 'application/zip' }),
    }),
  pullRemote: (instanceId: string, replacements: ReplacementRule[], remoteDomain?: string) =>
    post<ImportPreview>('/api/config/import/remote', { instanceId, replacements, remoteDomain: remoteDomain || null }),
  preview: (id: string) => request<ImportPreview>(`/api/config/import/${enc(id)}`),
  replacements: (id: string, replacements: ReplacementRule[]) => post<ImportPreview>(`/api/config/import/${enc(id)}/replacements`, { replacements }),
  validate: (id: string, keys: string[]) => post<ImportIssue[]>(`/api/config/import/${enc(id)}/validate`, { keys }),
  apply: (id: string, keys: string[], comment: string) => post<ImportApplyResult>(`/api/config/import/${enc(id)}/apply`, { keys, comment }),
  instances: () => request<RemoteInstance[]>('/api/config/remote-instances'),
  createInstance: (body: RemoteInstanceInput) => post<RemoteInstance>('/api/config/remote-instances', body),
  updateInstance: (id: string, body: RemoteInstanceInput) =>
    request<RemoteInstance>(`/api/config/remote-instances/${enc(id)}`, { method: 'PUT', body }),
  removeInstance: (id: string) => request<void>(`/api/config/remote-instances/${enc(id)}`, { method: 'DELETE' }),
  checkInstance: (body: { id?: string; url?: string; token?: string }) => post<RemoteCheckResult>('/api/config/remote-instances/check', body),
  git: () => request<GitSettings>('/api/settings/git'),
  updateGit: (body: GitSettingsInput) => request<GitSettings>('/api/settings/git', { method: 'PUT', body }),
  syncGit: () => post<void>('/api/settings/git/sync'),
  resolveGit: () => post<void>('/api/settings/git/resolve'),
}
