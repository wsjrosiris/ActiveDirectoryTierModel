// Mirrors service/docs/API.md exactly.

export type Role = 'Viewer' | 'Editor' | 'Operator' | 'Admin'

export type AuthType = 'Local' | 'Windows' | 'Entra'

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
  /** Sign-in with Microsoft Entra ID is enabled and configured. */
  entraAuth?: boolean
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
  | 'AuthSilosOnly'

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
  /** Apply: the reviewed planning run (required when settings.requirePlanBeforeApply). */
  planRunId?: number | null
}

export type RunKind = 'Deploy' | 'Audit' | 'Monitor' | 'Jit'
export type RunStatus = 'AwaitingApproval' | 'Queued' | 'Running' | 'Succeeded' | 'Failed' | 'Cancelled' | 'Rejected' | 'Scheduled'

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
  /** Apply runs: the planning run whose result is applied. */
  planRunId: number | null
  admlLanguage: string
  /** Only while 'Scheduled': start of the maintenance window the apply waits for. */
  scheduledFor?: string | null
  /** Kind 'Jit': grant, revoke or prerequisite check, and the JIT request it belongs to. */
  jitAction?: 'Grant' | 'Revoke' | 'Check' | null
  jitRequestId?: number | null
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
  /** ous, groups, users, acls, gpos, admx, msa, gmsa, dmsa, winlaps (newer framework versions). */
  area?: string
  severity?: Severity
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any
}

export interface RunDetail extends RunSummary {
  /** Audit: auditSummary counts · Monitor: MonitorSummary. */
  summary: Record<string, number> | null
  findings: Finding[]
  configVersions: Record<string, number>
  /** Deploy/Plan runs: the planned changes (null when the framework wrote no plan file). */
  plan: DeployPlan | null
  /** Deploy/Plan runs: whether this plan can be applied now. */
  planApplicability: PlanApplicability | null
}

// ---------- Planung ----------

export type PlanArea = 'ous' | 'groups' | 'users' | 'acls' | 'gpos' | 'admx' | 'msa' | 'gmsa' | 'dmsa' | 'winlaps'

export type PlanDetailValue = string | number | boolean | string[]

export interface PlanAction {
  phase: number
  area: PlanArea | string
  /** CreateOU, CreateGroup, CreateUser, UpdateUserMembership, CreateAcl, CreateGPO, ImportGPO, LinkGPO, ConfigureLapsDecryptor, … */
  action: string
  resourceType: string
  name: string
  path: string | null
  details: Record<string, PlanDetailValue> | null
}

export interface PlanSummary {
  totalActions: number
  create: number
  update: number
  link: number
  configure: number
  existing: number
}

export interface PlanPhase {
  phase: number
  name: string
  area: string
  actionCount: number
  existingCount: number
}

export interface DeployPlan {
  metadata: { version: string | null; scope: string | null; preferredDc: string | null; timestamp: string | null; includes: string[] }
  summary: PlanSummary
  phases: PlanPhase[]
  actions: PlanAction[]
  /** Per action type, counted before truncation. */
  actionCounts: Record<string, number>
  warnings: string[]
  errors: string[]
  /** Only the first 5000 actions are stored. */
  truncated: boolean
}

export interface PlanApplicability {
  applicable: boolean
  reason: string | null
  expiresAt: string | null
}

export interface PlanCandidate {
  id: number
  requestedBy: string
  finishedAt: string | null
  expiresAt: string | null
  summary: PlanSummary | null
  changes: number
}

export interface PlanCandidates {
  requirePlan: boolean
  maxAgeHours: number
  candidate: PlanCandidate | null
  latestPlanRunId: number | null
  reason: string | null
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

export type ScheduleKind = 'Audit' | 'Monitor'

export interface Schedule extends RunRequest {
  id: number
  kind: ScheduleKind
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
  /** Apply only with a reviewed, matching planning run. */
  requirePlanBeforeApply: boolean
  planMaxAgeHours: number
  frameworkPath: string
  pwshPath: string
  /** Hygiene: accounts without logon for this many days are stale. */
  staleDays: number
  /** Hygiene: maximum password age of privileged user accounts. */
  passwordMaxAgeDays: number
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

export type ChannelType = 'Email' | 'Teams' | 'Webhook' | 'Syslog' | 'LogAnalytics'

export type SyslogProtocol = 'Udp' | 'Tcp' | 'Tls'
export type SyslogFormat = 'Cef' | 'Rfc5424'

export interface SyslogSettings {
  host: string
  port: number
  protocol: SyslogProtocol
  format: SyslogFormat
  /** TLS only: false accepts self-signed certificates (test receivers). */
  validateCertificate: boolean
}

export interface LogAnalyticsSettings {
  tenantId: string
  clientId: string
  endpointUrl: string
  dcrImmutableId: string
  streamName: string
  hasClientSecret: boolean
}

export interface LogAnalyticsInput extends Omit<LogAnalyticsSettings, 'hasClientSecret'> {
  /** Empty or null keeps the stored secret. */
  clientSecret?: string | null
}

export interface ChannelEvents {
  drift: boolean
  failure: boolean
  apply: boolean
  approval: boolean
  certificate: boolean
  /** Changes in privileged groups or new privileged findings (monitor runs). */
  privileged: boolean
  /** Just-in-Time access requested / granted. */
  jitRequested: boolean
  jitGranted: boolean
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
  /** SIEM channels only. */
  syslog?: SyslogSettings | null
  logAnalytics?: LogAnalyticsSettings | null
  /** SIEM channels: every change-log entry is forwarded as well. */
  forwardChangeLog?: boolean
  /** SIEM channels: events lost (queue full or not deliverable) since the service started. */
  droppedEvents?: number
}

export interface ChannelInput {
  name: string
  type: ChannelType
  enabled: boolean
  /** On update: null = unchanged. */
  target: string | null
  events: ChannelEvents
  /** SIEM channels: null/undefined keeps the stored settings. */
  syslog?: SyslogSettings | null
  logAnalytics?: LogAnalyticsInput | null
  forwardChangeLog?: boolean
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

// ---------- Systemzustand ----------

export type HealthStatus = 'ok' | 'warn' | 'error'

export interface HealthItem {
  key: string
  title: string
  status: HealthStatus
  message: string
  facts: { label: string; value: string }[]
}

export interface HealthDetails {
  status: HealthStatus
  checkedAt: string
  version: string
  items: HealthItem[]
}

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

// ---------- Privilegierte Zugriffe (Überwachung) ----------

export type Severity = 'High' | 'Medium' | 'Low'

export interface MonitorSummary {
  groupCount: number
  memberCount: number
  accountCount: number
  addedCount: number
  removedCount: number
  unexpectedCount: number
  hygieneCount: number
  hygieneHighCount: number
  attackPathCount: number
  errorCount: number
  baseline: boolean
}

export interface PrivilegedMember {
  sid: string
  samAccountName: string | null
  name: string
  objectClass: string
  distinguishedName: string | null
  direct: boolean
  /** Nested groups, outermost first. */
  via: string[]
  enabled: boolean | null
  unexpected: boolean
  /** Why the member is expected (e.g. "Tier-0-Konto laut Konfiguration"). */
  note: string | null
}

export interface PrivilegedGroup {
  sid: string
  name: string
  wellKnownName: string | null
  source: 'builtin' | 'config' | string
  tier: number | null
  distinguishedName: string | null
  memberCount: number
  directCount: number
  unexpectedCount: number
  members: PrivilegedMember[]
}

export interface UnexpectedMember {
  groupSid: string
  groupName: string
  memberSid: string
  memberSam: string | null
  memberName: string
  objectClass: string
  direct: boolean
  via: string[]
  enabled: boolean | null
}

export interface HygieneFinding {
  rule: string
  title: string
  severity: Severity
  sid: string
  account: string
  distinguishedName: string | null
  objectClass: string
  tier: number | null
  value: string
}

export interface AttackPath {
  objectDn: string
  objectType: string
  objectName: string
  principalSid: string
  principalName: string
  principalClass: string
  rights: string[]
  memberCount: number | null
  sampleMembers: string[]
  inherited: boolean
  severity: Severity
  sentence: string
  membershipPath: string | null
}

export interface MembershipChange {
  change: 'Added' | 'Removed'
  groupSid: string
  groupName: string
  memberSid: string
  memberSam: string | null
  memberName: string
  objectClass: string
  direct: boolean
  via: string[]
}

export interface PrivilegedOverview {
  snapshot: {
    runId: number
    takenAt: string
    preferredDc: string | null
    domain: string | null
    baseline: boolean
    groupCount: number
    memberCount: number
    accountCount: number
    errors: string[]
  } | null
  thresholds: { staleDays: number; passwordMaxAgeDays: number }
  groups: PrivilegedGroup[]
  unexpected: UnexpectedMember[]
  hygiene: HygieneFinding[]
  attackPaths: AttackPath[]
  /** Latest monitor run of any status. */
  lastRun: RunSummary | null
  monitorSchedules: number
  snapshotCount: number
}

export interface PrivilegedChanges {
  items: { runId: number; takenAt: string; changes: MembershipChange[] }[]
  snapshotCount: number
  firstSnapshotAt: string | null
}

// ---------- Compliance ----------

export interface ComplianceDeduction {
  category: 'audit' | 'unexpected' | 'hygiene' | 'attackPath'
  severity: Severity | null
  label: string
  count: number
  pointsEach: number
  points: number
}

export interface TierCompliance {
  tier: 0 | 1 | 2
  score: number
  deductions: ComplianceDeduction[]
}

export interface Compliance {
  weights: { auditDrift: Record<Severity, number>; unexpectedMember: number; hygiene: Record<Severity, number>; attackPath: number }
  audit: { runId: number; at: string } | null
  monitor: { runId: number; at: string } | null
  current: TierCompliance[] | null
  history: { date: string; tier0: number | null; tier1: number | null; tier2: number | null }[]
}

// ---------- Live AD view (Ist-Ansicht) ----------

export interface AdDomainController {
  name: string
  site: string | null
  isGlobalCatalog: boolean
}

export interface AdDomainInfo {
  dnsName: string
  distinguishedName: string
  netBiosName: string
  domainFunctionalLevel: string
  forestFunctionalLevel: string
  forestName: string
  domainControllers: AdDomainController[]
}

export interface AdTreeNode {
  dn: string
  name: string
  parentDn: string
  childCount: number
  protected: boolean
  blockInheritance: boolean
  description: string | null
  gpos: string[]
}

export interface AdTree {
  available: boolean
  source: string
  message: string | null
  readAt: string | null
  domain: AdDomainInfo | null
  truncated: boolean
  nodes: AdTreeNode[]
}

export interface AdAce {
  principal: string
  principalSid: string | null
  rights: string[]
  type: 'Allow' | 'Deny' | string
  objectTypeGuid: string | null
  inheritedObjectTypeGuid: string | null
  inheritance: string
  isDefault: boolean
  objectType: string | null
  inheritedObjectType: string | null
}

export interface AdGpoLink {
  name: string
  gpoGuid: string | null
  order: number
  enabled: boolean
  enforced: boolean
}

export interface AdMember {
  name: string
  samAccountName: string
  objectClass: string
  distinguishedName: string
  enabled: boolean | null
}

export interface AdObject {
  available: boolean
  source: string
  message: string | null
  dn: string
  kind: string
  name: string
  ou: {
    childOus: AdTreeNode[]
    counts: { users: number; groups: number; computers: number; other: number } | null
    gpoLinks: AdGpoLink[]
    protected: boolean
    blockInheritance: boolean
  } | null
  members: AdMember[] | null
  aces: AdAce[]
}

export type CompareStatus = 'same' | 'missing' | 'extra' | 'different'

export interface OuComparison {
  dn: string
  configDn: string
  name: string
  parentDn: string | null
  status: CompareStatus
  inConfig: boolean
  inAd: boolean
  builtin: boolean
  isRoot: boolean
  configIndex: number | null
  suggestedPath: string | null
  protected: boolean | null
  blockInheritance: boolean | null
  desiredAces: number
  actualAces: number
  desiredLinks: number
  actualLinks: number
  differences: { kind: string; text: string }[]
}

export interface AdCompare {
  available: boolean
  source: string
  message: string | null
  readAt: string | null
  domain: AdDomainInfo | null
  result: { domainDn: string; items: OuComparison[]; summary: { same: number; missing: number; extra: number; different: number } } | null
}

// ---------- Setup wizard ----------

export interface SetupState {
  needed: boolean
  completed: boolean
  sampleConfiguration: boolean
  userVersions: number
  directoryAvailable: boolean
  directorySource: string
  completedBy: string | null
  completedAt: string | null
}

export interface GpoRename {
  section: 'gpos' | 'winlaps'
  target: string
  field: string
  from: string
  to: string
}

export interface PrefixPreview {
  current: string
  prefix: string
  renames: GpoRename[]
  gpoCount: number
}

// ---------- Entra ID ----------

export type EntraEntryKind = 'Group' | 'AppRole'

export interface EntraRoleEntry {
  kind: EntraEntryKind
  /** Group: object ID (GUID) · AppRole: value of the "roles" claim. */
  value: string
  displayName?: string | null
}

export interface EntraAuthSettings {
  enabled: boolean
  tenantId: string
  clientId: string
  hasClientSecret: boolean
  roleMappings: Record<Role, EntraRoleEntry[]>
  callbackPath: string
}

export interface EntraAuthUpdate {
  enabled: boolean
  tenantId: string
  clientId: string
  /** Empty or null keeps the stored secret. */
  clientSecret?: string | null
  roleMappings: Record<Role, EntraRoleEntry[]>
}

export interface EntraMetadataCheck {
  ok: boolean
  message: string
  issuer: string | null
  authorizationEndpoint: string | null
  tokenEndpoint: string | null
}

// ---------- Berichte ----------

export type ReportType = 'soll-ist' | 'aenderungen' | 'privilegiert'

export interface ReportTypeInfo {
  type: ReportType
  title: string
  description: string
  needsRange: boolean
  basis: string | null
  basisAt: string | null
}

export type ReportFrequency = 'Weekly' | 'Monthly'

export interface ReportSchedule {
  id: string
  name: string
  type: ReportType
  frequency: ReportFrequency
  /** Weekly: 0 (Sunday) … 6 · Monthly: 1–28. */
  day: number
  /** HH:mm, server time zone. */
  time: string
  recipients: string[]
  enabled: boolean
  createdAt: string
  lastSentAt: string | null
  lastError: string | null
  nextRunAt: string | null
}

export interface ReportScheduleInput {
  id?: string | null
  name: string
  type: ReportType
  frequency: ReportFrequency
  day: number
  time: string
  recipients: string[]
  enabled: boolean
}
