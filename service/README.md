# TierModel Service

Ein dauerhaft laufender Windows-Dienst mit Weboberfläche für das Active Directory Tier Model.
Die Konfiguration liegt versioniert in **PostgreSQL**. Deploy und Audit laufen über eine
Warteschlange und werden live protokolliert. Audits lassen sich zeitgesteuert ausführen.
Jede Änderung landet im Änderungsprotokoll.

```
┌──────────────┐  HTTPS   ┌──────────────────────────────────────────┐        ┌────────────┐
│  Browser     │ ───────► │  TierModel.Service.exe (Windows-Dienst)  │ ─────► │ PostgreSQL │
│  (React-SPA) │          │  ASP.NET Core 10 · Kestrel               │        │            │
└──────────────┘          │  ├─ REST-API + Anmeldung (Cookie, CSRF)  │        └────────────┘
                          │  ├─ RunWorker ─► pwsh.exe ─► Deploy-/Audit-TierModel.ps1 ─► AD
                          │  └─ ScheduleWorker (geplante Audits)     │
                          └──────────────────────────────────────────┘
```

## Installation auf dem Windows Server

1. Release-Paket `TierModelService-<version>.zip` bauen (siehe unten) oder bereitgestellt bekommen.
2. Auf dem Server entpacken und **`Setup.cmd`** doppelklicken.
3. Den Fragen folgen. Enter übernimmt jeweils den Vorschlag.

Der Assistent (`installer/Install-TierModelService.ps1`) übernimmt:

| Schritt | Was passiert |
|---|---|
| Voraussetzungen | Prüft Windows Server, Domänenmitgliedschaft, PowerShell 7 und die RSAT-Module `ActiveDirectory`/`GroupPolicy`. Fehlendes installiert er auf Wunsch (winget/MSI, `Install-WindowsFeature`). |
| PostgreSQL | **a)** vorhandenen Server nutzen: Datenbank und Benutzer werden automatisch angelegt, **b)** PostgreSQL lokal installieren (nur `localhost`), **c)** bestehende Datenbank nur verbinden. Der DB-Benutzer bekommt ein zufälliges 32-stelliges Passwort. |
| Dienstkonto | gMSA (empfohlen, inkl. `Install-ADServiceAccount`), Domänenkonto oder LocalSystem. Das Recht „Als Dienst anmelden“ wird gesetzt. |
| HTTPS | Vorhandenes Zertifikat aus `LocalMachine\My` auswählen oder ein selbstsigniertes erzeugen. Das Dienstkonto erhält Leserecht auf den privaten Schlüssel. |
| Firewall | Eingehende Regel für den Port (Profil Domäne), optional auf Subnetze beschränkt. |
| Dienst | Registriert `TierModelService` mit verzögertem Autostart und Neustart bei Fehlern, prüft danach `/healthz`. |
| Admin | Legt das erste Administratorkonto der Weboberfläche an. |

Ein erneuter Start von `Setup.cmd` bietet **Aktualisieren** (Einstellungen und Daten bleiben erhalten,
automatische Sicherung und Rücksprung bei Fehlern), **Neu konfigurieren** und **Deinstallieren**.

Installierte Struktur:

```
C:\Program Files\TierModelService\
  app\                          Dienst (self-contained, kein .NET-Runtime nötig) + Weboberfläche
  app\appsettings.Production.json   Verbindungsdaten – nur SYSTEM, Administratoren, Dienstkonto
  framework\                    Deploy-/Audit-Skripte, Modul, GPO-/ADMX-Dateien
C:\ProgramData\TierModelService\
  runs\000042\                  Arbeitskopie je Lauf (Skripte + Konfiguration aus der DB + Berichte)
  logs\setup-*.log              Installationsprotokolle
```

> **Sicherheit:** Der Dienst ändert das Active Directory mit den Rechten seines Dienstkontos.
> Der Server ist deshalb als **Tier-0-System** zu behandeln: Anmeldung nur für Tier-0-Admins,
> Patches, Überwachung, kein Internetzugang.

## Funktionen

- **Konfiguration** – Formulare für OUs, Gruppen, Benutzer, ACL-Delegationen, MSA/gMSA/dMSA
  und Windows LAPS. Die übrigen Dateien bearbeitet man im JSON-Editor. Jede Speicherung
  erzeugt eine neue Version (mit Kommentar, Diff und Wiederherstellung). Gleichzeitige
  Änderungen erkennt der Dienst (HTTP 409). Vor jedem Lauf prüft er die Querverweise.
- **Deploy** – Planung (WhatIf) oder Anwenden. Anwenden ist Operatoren vorbehalten und muss
  ausdrücklich bestätigt werden. Bei Validierungsfehlern startet Anwenden nicht.
- **Audit** – manuell oder per Zeitplan (Cron + Zeitzone), mit Drift-Befunden und Trend.
- **Läufe** – Warteschlange, Live-Log, Abbrechen. Jeder Lauf hält fest, welche
  Konfigurationsversion er genutzt hat.
- **Änderungsprotokoll** – Konfiguration, Läufe, Benutzer, Zeitpläne, Einstellungen, Anmeldungen.
- **Benutzer und Rollen** – `Viewer` < `Editor` < `Operator` < `Admin`. Passwörter werden mit
  PBKDF2 gehasht (ASP.NET Core Identity). Nach 5 Fehlversuchen sperrt sich das Konto für
  15 Minuten. Neue Konten müssen ihr Passwort bei der ersten Anmeldung ändern.

### Sicherheitsmaßnahmen

- Nur HTTPS (HSTS), Cookie `HttpOnly` + `Secure` + `SameSite=Strict`, CSRF-Token für jeden schreibenden Aufruf
- Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`
- Rate Limit für die Anmeldung, Sperre nach Fehlversuchen, Sitzungen enden sofort bei Deaktivierung, Rollen- oder Passwortänderung
- Eingaben, die als Prozessargumente enden (DC-Name, Sprache), prüft der Dienst streng per Regex. PowerShell startet mit `ArgumentList` (keine Shell)
- Passwörter gibt der Installer nur über stdin weiter, nie auf der Kommandozeile
- Konfigurationsdateinamen stammen aus einem festen Katalog (kein Path Traversal)

## Entwicklung

Voraussetzungen: .NET 10 SDK, Node.js 20+, PostgreSQL.

```bash
# Datenbank (einmalig)
psql -U postgres -c "CREATE ROLE tiermodel LOGIN PASSWORD 'devpass'" -c "CREATE DATABASE tiermodel OWNER tiermodel"

# Backend – http://localhost:5080 (appsettings.Development.json)
cd service/src/TierModel.Service
dotnet run
echo 'Mein-Dev-Passwort1' | dotnet run -- admin create --username admin

# Frontend – http://localhost:5173 (Proxy auf :5080)
cd service/web
npm install
npm run dev
```

In der Entwicklungsumgebung ersetzt `dev/fake-pwsh.sh` das echte PowerShell. Das Skript
simuliert Ausgabe und Audit-Bericht, sodass kein Active Directory nötig ist.

Tests:

```bash
cd service
dotnet test                                    # Unit-Tests
TIERMODEL_TEST_ADMIN_CONNECTION="Host=localhost;Username=postgres;Password=…" dotnet test   # + API-Tests mit Wegwerf-Datenbank
```

Release-Paket bauen (Windows, Linux oder macOS mit PowerShell 7):

```powershell
pwsh service/build/Build-Release.ps1          # → service/artifacts/TierModelService-<VERSION>.zip
```

Datenbankmigration nach Modelländerungen:

```bash
dotnet ef migrations add <Name> -p service/src/TierModel.Service -o Data/Migrations
```

Der Dienst wendet Migrationen beim Start automatisch an. Der Installer ruft zusätzlich `TierModel.Service.exe migrate` auf.

### Kommandozeile des Dienstes

```
TierModel.Service.exe migrate                                   Schema anlegen/aktualisieren, Framework-Konfiguration importieren
TierModel.Service.exe admin create --username NAME              Admin anlegen (Passwort über stdin)
TierModel.Service.exe admin reset-password --username NAME      Passwort zurücksetzen und Konto aktivieren (stdin)
TierModel.Service.exe db provision --host H --admin-user postgres   DB und DB-Benutzer anlegen (stdin: Admin-PW, App-PW)
TierModel.Service.exe db test --connection "…"                  Verbindung prüfen
```

Die REST-API ist in [`docs/API.md`](docs/API.md) beschrieben.
