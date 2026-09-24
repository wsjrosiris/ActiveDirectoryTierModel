# TierModel Service – REST API

Base URL: `/api`. JSON in camelCase, Enums als Strings. Fehler kommen als
RFC 7807 ProblemDetails (`{ title, detail, status, errors? }`).

## Sicherheit

- Anmeldung per Cookie (`TierModel.Auth`, HttpOnly, Secure, SameSite=Strict).
- CSRF: `GET /api/auth/me` setzt das lesbare Cookie `XSRF-TOKEN`. Jeder
  `POST`/`PUT`/`DELETE` muss den Wert im Header `X-XSRF-TOKEN` mitschicken,
  sonst antwortet der Server mit `400`.
- `401` = nicht angemeldet, `403` = Rolle reicht nicht.

### Rollen (aufsteigend)

| Rolle      | Darf                                                                 |
|------------|----------------------------------------------------------------------|
| `Viewer`   | Alles lesen                                                          |
| `Editor`   | + Konfiguration bearbeiten, Audits starten, Deploy im Planungsmodus   |
| `Operator` | + Deploy mit `confirmApply` (ändert AD), Zeitpläne verwalten, Läufe abbrechen |
| `Admin`    | + Benutzer und Einstellungen verwalten                               |

## Auth

| Methode | Pfad | Body | Antwort |
|---|---|---|---|
| GET  | `/api/auth/me` | – | `{ user: User \| null }` |
| POST | `/api/auth/login` | `{ username, password }` | `User` (401 bei Fehler, 423 wenn gesperrt) |
| POST | `/api/auth/logout` | – | 204 |
| POST | `/api/auth/change-password` | `{ currentPassword, newPassword }` | 204 |

```ts
type Role = 'Viewer' | 'Editor' | 'Operator' | 'Admin'
interface User {
  id: string; username: string; displayName: string; role: Role
  isActive: boolean; mustChangePassword: boolean
  lastLoginAt: string | null; lockedUntil: string | null; createdAt: string
}
```

Passwortregel: mindestens 12 Zeichen.
Solange `mustChangePassword` gesetzt ist, sind nur `/api/auth/*` erlaubt (403 sonst).

## Benutzer (Admin)

| Methode | Pfad | Body |
|---|---|---|
| GET    | `/api/users` | → `User[]` |
| POST   | `/api/users` | `{ username, displayName, role, password }` → `User` |
| PUT    | `/api/users/{id}` | `{ displayName, role, isActive }` → `User` |
| POST   | `/api/users/{id}/reset-password` | `{ newPassword }` → 204 (setzt `mustChangePassword`) |
| POST   | `/api/users/{id}/unlock` | → 204 |
| DELETE | `/api/users/{id}` | → 204 (eigenes Konto nicht löschbar) |

## Konfiguration (Soll-Zustand, versioniert)

Jede Konfigurationsdatei des Frameworks ist eine *Section*.

| key | Datei | Inhalt |
|---|---|---|
| `ous` | tiermodel-ous.json | `organizationUnits[]` |
| `groups` | tiermodel-groups.json | `groups[]` |
| `users` | tiermodel-users.json | `users[]` |
| `acls` | tiermodel-acls.json | `aclDelegations[]` |
| `gpos` | tiermodel-gpos.json | `gpos{ <OU-DN>: {...} }` |
| `admx` | tiermodel-admx.json | |
| `adml-en-US` | tiermodel-adml-en-US.json | |
| `msa` / `gmsa` / `dmsa` | tiermodel-msa/gmsa/dmsa.json | `aclDelegations[]` |
| `winlaps` | tiermodel-winlaps.json | `winLapsDelegations[]` |
| `metadata` | tiermodel-metadata.json | |
| `guid-mappings` | tiermodel-guid-mappings.json | |
| `dependencies` | dependencies.json | |

| Methode | Pfad | Body / Antwort |
|---|---|---|
| GET  | `/api/config/sections` | → `SectionSummary[]` |
| GET  | `/api/config/sections/{key}` | → `Section` |
| PUT  | `/api/config/sections/{key}` | `{ content, comment, baseVersion }` → `Section`; **409** wenn `baseVersion` veraltet |
| GET  | `/api/config/sections/{key}/versions` | → `VersionInfo[]` (neueste zuerst) |
| GET  | `/api/config/sections/{key}/versions/{version}` | → `Section` (Stand dieser Version) |
| POST | `/api/config/sections/{key}/versions/{version}/restore` | `{ comment }` → `Section` |
| GET  | `/api/config/validate` | → `ValidationIssue[]` |
| GET  | `/api/config/export` | → ZIP mit allen JSON-Dateien |

```ts
interface SectionSummary {
  key: string; fileName: string; title: string; description: string
  version: number; itemCount: number | null
  updatedAt: string; updatedBy: string
}
interface Section extends SectionSummary { content: any }
interface VersionInfo { version: number; createdAt: string; createdBy: string; comment: string | null; sha256: string }
interface ValidationIssue { severity: 'Error' | 'Warning'; section: string; message: string; item?: string }
```

Feldnamen in `content` bleiben exakt wie in den Framework-Dateien
(z. B. `samaccountname`, `groupscope`, `identityreference`,
`activedirectoryrights`, `activeDirectorysecurityinheritance`). `{{DOMAIN_DN}}`
ist ein Platzhalter, den das Framework zur Laufzeit ersetzt.

## Läufe (Deploy / Audit)

Läufe werden in eine Warteschlange gestellt und nacheinander ausgeführt.

```ts
type Scope = 'FullDeployment' | 'OuOnly' | 'GroupOnly' | 'UserOnly' | 'GposOnly' | 'OuAclsOnly' | 'AdmxOnly'
interface RunRequest {
  preferredDc: string; scope: Scope | null      // null nur erlaubt, wenn mind. ein include* gesetzt ist
  includeMsa: boolean; includeGmsa: boolean; includeDmsa: boolean; includeWinLaps: boolean
  admlLanguage?: string                          // Standard aus Einstellungen
}
interface DeployRequest extends RunRequest { confirmApply: boolean }   // true erfordert Operator

type RunKind = 'Deploy' | 'Audit'
type RunStatus = 'Queued' | 'Running' | 'Succeeded' | 'Failed' | 'Cancelled'
interface RunSummary {
  id: number; kind: RunKind; status: RunStatus; trigger: 'Manual' | 'Schedule'
  mode: 'Plan' | 'Apply' | null            // nur bei Deploy
  scope: Scope | null; includes: string[]  // z. B. ['Msa','WinLaps']
  preferredDc: string; requestedBy: string; scheduleId: number | null
  createdAt: string; startedAt: string | null; finishedAt: string | null
  exitCode: number | null
  driftCount: number | null; errorCount: number | null   // aus dem Audit-Report
  message: string | null
}
interface Finding { type: string; resourceType: string; identifier: string; details: string; [k: string]: any }
interface RunDetail extends RunSummary {
  summary: Record<string, number> | null   // auditSummary aus dem Report
  findings: Finding[]
  configVersions: Record<string, number>   // Section-Key → verwendete Version
}
interface LogLine { seq: number; at: string; stream: 'stdout' | 'stderr' | 'system'; level: 'info' | 'warn' | 'error' | 'success'; text: string }
```

| Methode | Pfad | Body / Antwort |
|---|---|---|
| GET  | `/api/runs?kind=&status=&page=1&pageSize=25` | → `{ items: RunSummary[], total }` |
| POST | `/api/runs/deploy` | `DeployRequest` → `RunSummary` (202) |
| POST | `/api/runs/audit` | `RunRequest` → `RunSummary` (202) |
| GET  | `/api/runs/{id}` | → `RunDetail` |
| GET  | `/api/runs/{id}/log?after=0` | → `{ status: RunStatus, lines: LogLine[] }` (Zeilen mit `seq > after`, max. 2000) |
| POST | `/api/runs/{id}/cancel` | → 204 (Operator) |

## Zeitpläne (geplante Audits)

```ts
interface Schedule extends RunRequest {
  id: number; name: string; cron: string   // 5-Feld-Cron, z. B. "0 2 * * *"
  timeZone: string                         // IANA, z. B. "Europe/Berlin"
  enabled: boolean
  nextRunAt: string | null; lastRunAt: string | null; lastRunId: number | null
  createdBy: string; createdAt: string
}
```

| Methode | Pfad |
|---|---|
| GET    | `/api/schedules` → `Schedule[]` |
| POST   | `/api/schedules` (Operator) Body ohne `id/nextRunAt/lastRun*/created*` → `Schedule` |
| PUT    | `/api/schedules/{id}` (Operator) → `Schedule` |
| DELETE | `/api/schedules/{id}` (Operator) → 204 |
| POST   | `/api/schedules/{id}/run` (Operator) → `RunSummary` sofort ausführen |

## Änderungsprotokoll

`GET /api/changelog?entityType=&page=1&pageSize=50` → `{ items: ChangeEntry[], total }`

```ts
interface ChangeEntry {
  id: number; at: string; username: string
  action: string        // z. B. 'config.update', 'config.restore', 'run.deploy', 'run.audit', 'run.cancel', 'user.create', 'auth.login', 'auth.login-failed'
  entityType: string    // 'config' | 'run' | 'user' | 'schedule' | 'settings' | 'auth'
  entityId: string | null
  summary: string
  details: any | null   // bei config.update: { section, fromVersion, toVersion, comment }
}
```

## Dashboard

`GET /api/dashboard` →

```ts
{
  counts: { ous: number; groups: number; users: number; acls: number; gpos: number; gpoLinks: number }
  lastAudit: RunSummary | null
  lastDeploy: RunSummary | null
  driftTrend: { runId: number; at: string; driftCount: number }[]   // letzte 30 erfolgreiche Audits, aufsteigend
  recentRuns: RunSummary[]       // 8
  recentChanges: ChangeEntry[]   // 8
  queue: { running: number; queued: number }
  validation: { errors: number; warnings: number }
}
```

## Einstellungen (Lesen: alle, Schreiben: Admin)

`GET /api/settings`, `PUT /api/settings` →
`{ defaultPreferredDc: string, admlLanguage: string, runRetentionDays: number, frameworkPath: string (nur lesen), pwshPath: string (nur lesen) }`

## Sonstiges

- `GET /healthz`: 200 wenn die Datenbank erreichbar ist.
- Alles außerhalb von `/api` liefert die SPA aus (Fallback auf `index.html`).
