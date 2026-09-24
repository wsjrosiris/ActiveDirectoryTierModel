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
| POST | `/api/auth/change-password` | `{ currentPassword, newPassword }` | 204 (nur lokale Konten) |
| GET  | `/api/auth/options` | – | `{ windowsAuth: boolean }` – ob die Schaltfläche „Mit Windows-Konto anmelden“ angezeigt wird |
| GET  | `/api/auth/windows?returnUrl=/pfad` | – | **Browser-Navigation**, kein fetch: Kerberos/NTLM-Anmeldung (Negotiate). Erfolg → 302 auf `returnUrl` (nur lokale Pfade). Fehler → 302 auf `/login?error=<code>` |

Fehlercodes für `/login?error=`: `windows-disabled` (nicht aktiviert), `windows-failed` (Windows-Anmeldung fehlgeschlagen),
`windows-norole` (Konto in keiner zugeordneten AD-Gruppe), `windows-inactive` (Konto in der Oberfläche deaktiviert).

```ts
type Role = 'Viewer' | 'Editor' | 'Operator' | 'Admin'
interface User {
  id: string; username: string; displayName: string; role: Role
  authType: 'Local' | 'Windows'           // Windows: Name "DOMÄNE\\konto", kein Passwort, Rolle aus AD-Gruppen
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
| POST   | `/api/users/{id}/reset-password` | `{ newPassword }` → 204 (setzt `mustChangePassword`; 400 bei Windows-Konten) |
| POST   | `/api/users/{id}/unlock` | → 204 |
| DELETE | `/api/users/{id}` | → 204 (eigenes Konto nicht löschbar) |

Windows-Konten legt der Dienst bei der ersten Windows-Anmeldung selbst an. Ihre Rolle wird bei jeder Anmeldung aus den
AD-Gruppen neu bestimmt (die Rolle im PUT wird für sie ignoriert); `isActive: false` sperrt sie trotzdem.

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
  preferredDc: string; scope: Scope | null      // null nur erlaubt, wenn mind. ein include* gesetzt ist;
                                                 // include* nur mit scope 'FullDeployment' oder null (wie in den Skripten)
  includeMsa: boolean; includeGmsa: boolean; includeDmsa: boolean; includeWinLaps: boolean
  admlLanguage?: string                          // Standard aus Einstellungen
}
interface DeployRequest extends RunRequest { confirmApply: boolean }   // true erfordert Operator

type RunKind = 'Deploy' | 'Audit'
type RunStatus = 'AwaitingApproval' | 'Queued' | 'Running' | 'Succeeded' | 'Failed' | 'Cancelled' | 'Rejected'
interface RunSummary {
  id: number; kind: RunKind; status: RunStatus; trigger: 'Manual' | 'Schedule'
  mode: 'Plan' | 'Apply' | null            // nur bei Deploy
  scope: Scope | null; includes: string[]  // z. B. ['Msa','WinLaps']
  preferredDc: string; requestedBy: string; scheduleId: number | null
  createdAt: string; startedAt: string | null; finishedAt: string | null
  exitCode: number | null
  driftCount: number | null; errorCount: number | null   // aus dem Audit-Report
  message: string | null
  // Vier-Augen-Prinzip (nur Deploy/Anwenden, wenn in den Einstellungen aktiviert)
  approvalRequired: boolean
  approvedBy: string | null; approvedAt: string | null     // bei Ablehnung: wer/wann abgelehnt hat
  approvalComment: string | null
  approvalExpiresAt: string | null                          // nur solange 'AwaitingApproval'
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
| GET  | `/api/runs?kind=Audit&status=Succeeded&page=1&pageSize=25` | → `{ items: RunSummary[], total }` – Filter weglassen statt leer übergeben (leere Werte → 400) |
| POST | `/api/runs/deploy` | `DeployRequest` → `RunSummary` (202) |
| POST | `/api/runs/audit` | `RunRequest` → `RunSummary` (202) |
| GET  | `/api/runs/{id}` | → `RunDetail` |
| GET  | `/api/runs/{id}/log?after=0` | → `{ status: RunStatus, lines: LogLine[] }` (Zeilen mit `seq > after`, max. 2000) |
| POST | `/api/runs/{id}/cancel` | → 204 (Operator; bei `AwaitingApproval` darf auch der Antragsteller zurückziehen); 404 unbekannt, 409 bereits beendet |
| POST | `/api/runs/{id}/approve` | `{ comment?: string }` → `RunSummary` (Operator, **nicht** der Antragsteller → 403); 409 wenn nicht `AwaitingApproval` |
| POST | `/api/runs/{id}/reject` | `{ comment: string }` (Pflicht) → `RunSummary` (Operator, nicht der Antragsteller); 409 wenn nicht `AwaitingApproval` |

**Freigabe:** Ist `requireApproval` aktiv, erhält ein Deploy mit `confirmApply: true` den Status `AwaitingApproval`.
Die Konfigurationsversionen werden dabei **festgeschrieben** (`configVersions` ist sofort gefüllt) – ausgeführt wird genau
der Stand, den die freigebende Person sieht, auch wenn die Konfiguration inzwischen weiter bearbeitet wurde. Nach der
Freigabe → `Queued`. Ablehnung oder Ablauf (`approvalTimeoutHours`) → `Rejected`.

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
  recentChanges: ChangeEntry[]   // 8, ohne Anmeldeereignisse (entityType 'auth')
  queue: { running: number; queued: number }
  pendingApprovals: RunSummary[]  // alle Läufe mit Status 'AwaitingApproval', älteste zuerst
  validation: { errors: number; warnings: number }
}
```

## Einstellungen (Lesen: alle, Schreiben: Admin)

`GET /api/settings`, `PUT /api/settings` →

```ts
interface Settings {
  defaultPreferredDc: string
  admlLanguage: string            // Pflicht, Format xx-XX
  runRetentionDays: number        // 0–3650, 0 = unbegrenzt
  requireApproval: boolean        // Vier-Augen-Prinzip für Deploy/Anwenden
  approvalTimeoutHours: number    // 1–720, danach verfällt ein Antrag
  publicBaseUrl: string           // z. B. https://tiermodel01.contoso.com:8443 – für Links in Benachrichtigungen; leer erlaubt
  frameworkPath: string           // nur lesen
  pwshPath: string                // nur lesen
}
```

PUT sendet alle Felder außer den beiden nur lesbaren.

### Windows-Anmeldung (Admin)

`GET /api/settings/windows-auth`, `PUT /api/settings/windows-auth` →

```ts
interface GroupRef { name: string; sid: string }
interface WindowsAuthSettings {
  enabled: boolean
  roleGroups: { Viewer: GroupRef[]; Editor: GroupRef[]; Operator: GroupRef[]; Admin: GroupRef[] }
  available: boolean              // false, wenn der Server Windows-Anmeldung nicht unterstützt (nur lesen)
}
// PUT-Body: { enabled, roleGroups: { Viewer: string[], … } } – je Eintrag "DOMÄNE\\Gruppe" oder eine SID (S-1-5-…).
// Der Dienst löst Namen in SIDs auf; nicht auflösbare Einträge → 400 mit errors["roleGroups.<Rolle>"].
```

Bei Mitgliedschaft in mehreren zugeordneten Gruppen gilt die höchste Rolle.

## Benachrichtigungen (Admin)

```ts
type ChannelType = 'Email' | 'Teams' | 'Webhook'
interface NotificationChannel {
  id: number; name: string; type: ChannelType; enabled: boolean
  target: string       // Email: Empfänger, durch Komma getrennt · Teams/Webhook: URL (in Antworten gekürzt: nur Schema+Host+"…")
  events: { drift: boolean; failure: boolean; apply: boolean; approval: boolean }
  lastSentAt: string | null; lastError: string | null; createdAt: string
}
interface SmtpSettings {
  host: string; port: number; security: 'None' | 'StartTls' | 'SslOnConnect'
  username: string; from: string
  hasPassword: boolean  // nur lesen
  password?: string     // nur schreiben; weglassen = unverändert, "" = löschen
}
```

| Methode | Pfad | Body / Antwort |
|---|---|---|
| GET    | `/api/notifications/channels` | → `NotificationChannel[]` |
| POST   | `/api/notifications/channels` | `{ name, type, enabled, target, events }` → `NotificationChannel` |
| PUT    | `/api/notifications/channels/{id}` | wie POST; `target` weglassen oder `null` = unverändert (die URL wird nie vollständig zurückgegeben) |
| DELETE | `/api/notifications/channels/{id}` | → 204 |
| POST   | `/api/notifications/channels/{id}/test` | → 204 wenn zugestellt, sonst 502 mit Fehlertext in `detail` |
| GET    | `/api/notifications/smtp` | → `SmtpSettings` |
| PUT    | `/api/notifications/smtp` | `SmtpSettings` → `SmtpSettings` |

Ereignisse: **drift** (Audit mit Abweichungen), **failure** (Lauf fehlgeschlagen), **apply** (Deploy/Anwenden erfolgreich
abgeschlossen), **approval** (Freigabe angefordert). Geheimnisse (SMTP-Passwort, Webhook-URLs) werden verschlüsselt gespeichert.

## Vorschläge für Eingabefelder (alle angemeldeten Benutzer)

Damit keine Werte aus dem Gedächtnis getippt oder als JSON eingegeben werden müssen, liefert der Dienst Vorschläge:

| Methode | Pfad | Antwort |
|---|---|---|
| GET | `/api/lookup/gpo-backups` | `{ path, displayName, folder, backupId, backupTime }[]` – GPO-Sicherungen unter `framework\config\gpo` (Wert für `importPath`) |
| GET | `/api/lookup/template-files` | `{ admx: File[], adml: { "<xx-XX>": File[] }, languages: string[] }` mit `File = { name, md5, size, modified }` – ADMX/ADML-Dateien samt MD5 |
| GET | `/api/lookup/domain-controllers` | `{ available, items: { name, site }[], recent: string[] }` – DCs der Domäne (live, nur auf dem Windows-Server) und zuletzt verwendete |
| GET | `/api/lookup/ad-groups?q=…` | `{ available, items: { name, samAccountName, sid, distinguishedName, description }[] }` – AD-Gruppensuche ab 2 Zeichen, max. 25 (nur auf dem Windows-Server) |

## Sonstiges

- `GET /healthz`: 200 wenn die Datenbank erreichbar ist.
- Alles außerhalb von `/api` liefert die SPA aus (Fallback auf `index.html`).
