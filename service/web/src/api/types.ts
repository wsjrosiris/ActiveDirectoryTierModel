// Mirrors service/docs/API.md exactly.

export type Role = 'Viewer' | 'Editor' | 'Operator' | 'Admin'

export type AuthType = 'Local' | 'Windows'

export interface User {
  id: string
  username: string
  displayName: string
  role: Role
  /** Windows: name "DOMÄNE\\konto", no password, role derived from AD groups. */
  authType: AuthType
  isActive: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  lockedUntil: string | null
  createdAt: string
}

export interface MeResponse {
  user: User | null
}

export interface AuthOptions {
  windowsAuth: boolean
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
export type RunStatus = 'AwaitingApproval' | 'Queued' | 'Running' | 'Succeeded' | 'Failed' | 'Cancelled' | 'Rejected'

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
  // Vier-Augen-Prinzip (nur Deploy/Anwenden, wenn in den Einstellungen aktiviert)
  approvalRequired: boolean
  /** On rejection: who rejected / when. */
  approvedBy: string | null
  approvedAt: string | null
  approvalComment: string | null
  /** Only while 'AwaitingApproval'. */
  approvalExpiresAt: string | null
}

export interface ApproveRequest {
  comment?: string
}

export interface RejectRequest {
  comment: string
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
  /** All runs with status 'AwaitingApproval', oldest first. */
  pendingApprovals: RunSummary[]
  validation: { errors: number; warnings: number }
}

// ---------- Einstellungen ----------

export interface Settings {
  defaultPreferredDc: string
  admlLanguage: string
  runRetentionDays: number
  requireApproval: boolean
  approvalTimeoutHours: number
  publicBaseUrl: string
  frameworkPath: string
  pwshPath: string
}

export type SettingsUpdate = Omit<Settings, 'frameworkPath' | 'pwshPath'>

// ---------- Windows-Anmeldung ----------

export interface GroupRef {
  name: string
  sid: string
}

export interface WindowsAuthSettings {
  enabled: boolean
  roleGroups: Record<Role, GroupRef[]>
  /** false when the server does not support Windows authentication (read-only). */
  available: boolean
}

export interface WindowsAuthUpdate {
  enabled: boolean
  /** Per entry "DOMÄNE\\Gruppe" or a SID (S-1-5-…). */
  roleGroups: Record<Role, string[]>
}

// ---------- Benachrichtigungen ----------

export type ChannelType = 'Email' | 'Teams' | 'Webhook'

export interface ChannelEvents {
  drift: boolean
  failure: boolean
  apply: boolean
  approval: boolean
}

export interface NotificationChannel {
  id: number
  name: string
  type: ChannelType
  enabled: boolean
  /** Email: recipients, comma separated · Teams/Webhook: URL (masked in responses: scheme + host + "…"). */
  target: string
  events: ChannelEvents
  lastSentAt: string | null
  lastError: string | null
  createdAt: string
}

export interface ChannelInput {
  name: string
  type: ChannelType
  enabled: boolean
  /** On update: null = unchanged. */
  target: string | null
  events: ChannelEvents
}

export type SmtpSecurity = 'None' | 'StartTls' | 'SslOnConnect'

export interface SmtpSettings {
  host: string
  port: number
  security: SmtpSecurity
  username: string
  from: string
  /** Read-only. */
  hasPassword: boolean
  /** Write-only; omit = unchanged, "" = remove. */
  password?: string
}

export type SmtpUpdate = Omit<SmtpSettings, 'hasPassword'>

// ---------- Fehler ----------

export interface ProblemDetails {
  type?: string
  title?: string
  detail?: string
  status?: number
  errors?: Record<string, string[]>
}

// ---------------------------------------------------------------- lookups (suggestions for form fields)

export interface GpoBackup { path: string; displayName: string; folder: string; backupId: string; backupTime: string | null }
export interface TemplateFile { name: string; md5: string; size: number; modified: string }
export interface TemplateFiles { admx: TemplateFile[]; adml: Record<string, TemplateFile[]>; languages: string[] }
export interface DomainControllers { available: boolean; items: { name: string; site: string | null }[]; recent: string[] }
export interface AdGroup { name: string; samAccountName: string; sid: string; distinguishedName: string | null; description: string | null }
export interface AdGroups { available: boolean; items: AdGroup[] }
