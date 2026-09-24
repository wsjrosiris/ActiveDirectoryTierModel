// Mirrors service/docs/API.md exactly.

export type Role = 'Viewer' | 'Editor' | 'Operator' | 'Admin'

export interface User {
  id: string
  username: string
  displayName: string
  role: Role
  isActive: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  lockedUntil: string | null
  createdAt: string
}

export interface MeResponse {
  user: User | null
}

export interface LoginRequest {
  username: string
  password: string
}

export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}

export interface CreateUserRequest {
  username: string
  displayName: string
  role: Role
  password: string
}

export interface UpdateUserRequest {
  displayName: string
  role: Role
  isActive: boolean
}

export interface ResetPasswordRequest {
  newPassword: string
}

// ---------- Konfiguration ----------

export type SectionKey =
  | 'ous'
  | 'groups'
  | 'users'
  | 'acls'
  | 'gpos'
  | 'admx'
  | 'adml-en-US'
  | 'msa'
  | 'gmsa'
  | 'dmsa'
  | 'winlaps'
  | 'metadata'
  | 'guid-mappings'
  | 'dependencies'

export interface SectionSummary {
  key: string
  fileName: string
  title: string
  description: string
  version: number
  itemCount: number | null
  updatedAt: string
  updatedBy: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Section extends SectionSummary {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any
}

export interface SaveSectionRequest {
  content: unknown
  comment: string
  baseVersion: number
}

export interface RestoreRequest {
  comment: string
}

export interface VersionInfo {
  version: number
  createdAt: string
  createdBy: string
  comment: string | null
  sha256: string
}

export interface ValidationIssue {
  severity: 'Error' | 'Warning'
  section: string
  message: string
  item?: string
}

// ---------- Läufe ----------

export type Scope =
  | 'FullDeployment'
  | 'OuOnly'
  | 'GroupOnly'
  | 'UserOnly'
  | 'GposOnly'
  | 'OuAclsOnly'
  | 'AdmxOnly'

export interface RunRequest {
  preferredDc: string
  scope: Scope | null
  includeMsa: boolean
  includeGmsa: boolean
  includeDmsa: boolean
  includeWinLaps: boolean
  admlLanguage?: string
}

export interface DeployRequest extends RunRequest {
  confirmApply: boolean
}

export type RunKind = 'Deploy' | 'Audit'
export type RunStatus = 'Queued' | 'Running' | 'Succeeded' | 'Failed' | 'Cancelled'

export interface RunSummary {
  id: number
  kind: RunKind
  status: RunStatus
  trigger: 'Manual' | 'Schedule'
  mode: 'Plan' | 'Apply' | null
  scope: Scope | null
  includes: string[]
  preferredDc: string
  requestedBy: string
  scheduleId: number | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  exitCode: number | null
  driftCount: number | null
  errorCount: number | null
  message: string | null
}

export interface Finding {
  type: string
  resourceType: string
  identifier: string
  details: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any
}

export interface RunDetail extends RunSummary {
  summary: Record<string, number> | null
  findings: Finding[]
  configVersions: Record<string, number>
}

export interface LogLine {
  seq: number
  at: string
  stream: 'stdout' | 'stderr' | 'system'
  level: 'info' | 'warn' | 'error' | 'success'
  text: string
}

export interface LogResponse {
  status: RunStatus
  lines: LogLine[]
}

export interface Paged<T> {
  items: T[]
  total: number
}

// ---------- Zeitpläne ----------

export interface Schedule extends RunRequest {
  id: number
  name: string
  cron: string
  timeZone: string
  enabled: boolean
  nextRunAt: string | null
  lastRunAt: string | null
  lastRunId: number | null
  createdBy: string
  createdAt: string
}

export type ScheduleInput = Omit<
  Schedule,
  'id' | 'nextRunAt' | 'lastRunAt' | 'lastRunId' | 'createdBy' | 'createdAt'
>

// ---------- Änderungsprotokoll ----------

export interface ChangeEntry {
  id: number
  at: string
  username: string
  action: string
  entityType: string
  entityId: string | null
  summary: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: any | null
}

// ---------- Dashboard ----------

export interface Dashboard {
  counts: { ous: number; groups: number; users: number; acls: number; gpos: number; gpoLinks: number }
  lastAudit: RunSummary | null
  lastDeploy: RunSummary | null
  driftTrend: { runId: number; at: string; driftCount: number }[]
  recentRuns: RunSummary[]
  recentChanges: ChangeEntry[]
  queue: { running: number; queued: number }
  validation: { errors: number; warnings: number }
}

// ---------- Einstellungen ----------

export interface Settings {
  defaultPreferredDc: string
  admlLanguage: string
  runRetentionDays: number
  frameworkPath: string
  pwshPath: string
}

export type SettingsUpdate = Pick<Settings, 'defaultPreferredDc' | 'admlLanguage' | 'runRetentionDays'>

// ---------- Fehler ----------

export interface ProblemDetails {
  type?: string
  title?: string
  detail?: string
  status?: number
  errors?: Record<string, string[]>
}
