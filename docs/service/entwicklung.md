# Entwicklung

## Projektstruktur

```
service/
├── TierModel.Service.slnx
├── VERSION                         Versionsnummer des Release-Pakets
├── src/TierModel.Service/          Backend (ASP.NET Core 10)
│   ├── Program.cs                  Hosting, Windows-Dienst, Kestrel/Zertifikat, Middleware, Endpunkte
│   ├── Cli.cs                      migrate · admin · db (für den Installer)
│   ├── Options.cs                  Abschnitt "TierModel" der appsettings
│   ├── Auth/                       Cookie-Anmeldung, Rollen-Policies, CSRF, Security-Header, Benutzerdienst
│   ├── Config/                     Katalog der Konfigurationsbereiche, Versionierung, Validierung
│   ├── Data/                       EF Core DbContext, Entitäten, Migrationen
│   ├── Endpoints/                  Minimal-API-Endpunkte je Bereich
│   ├── Runs/                       Warteschlange, RunWorker (pwsh), Arbeitskopie, Log-Writer, Zeitpläne
│   └── Services/                   Änderungsprotokoll, Einstellungen
├── web/                            Weboberfläche (React 19, TypeScript, Vite, Tailwind CSS 4)
│   └── src/
│       ├── api/                    typisierter Client + Typen (entsprechen der REST-API)
│       ├── components/ui/          Basiskomponenten auf Radix UI
│       ├── components/layout/      Shell, Navigation, Suche (Strg+K), Befehlspalette
│       ├── features/<bereich>/     Seiten: auth, dashboard, config, runs, changelog, admin
│       └── lib/                    OU-/Tier-Logik, Rollen, Beschriftungen, Theme
├── tests/TierModel.Service.Tests/  xUnit: Unit-Tests + API-Tests gegen PostgreSQL
├── installer/                      Setup.cmd, Install-TierModelService.ps1, README.txt
├── build/Build-Release.ps1         baut das Installationspaket
└── dev/fake-pwsh.sh                simuliert Deploy/Audit für die Entwicklung (ohne AD)
```

## Lokale Umgebung

Benötigt: **.NET 10 SDK**, **Node.js 20+**, **PostgreSQL 14+**. Linux, macOS und Windows funktionieren; ohne
Active Directory ersetzt `dev/fake-pwsh.sh` PowerShell (unter Windows `TierModel:PwshPath` auf `pwsh.exe` lassen
– die echten Skripte scheitern ohne AD dann an der Voraussetzungsprüfung).

```bash
# Datenbank (einmalig)
psql -U postgres -c "CREATE ROLE tiermodel LOGIN PASSWORD 'devpass'" -c "CREATE DATABASE tiermodel OWNER tiermodel"

# Backend – http://localhost:5080, Einstellungen aus appsettings.Development.json
cd service/src/TierModel.Service
dotnet run
echo 'Mein-Dev-Passwort1' | dotnet run -- admin create --username admin

# Frontend mit Hot Reload – http://localhost:5173 (leitet /api an :5080 weiter)
cd service/web
npm install
npm run dev
```

`appsettings.Development.json` setzt `RequireHttps=false`, den Framework-Pfad auf das Repository und
`PwshPath` auf `dev/fake-pwsh.sh`. Relative Pfade gelten ab dem Ausgabeordner (`bin/Debug/net10.0`).
Ein anderes Backend für den Vite-Server: `TIERMODEL_BACKEND=http://host:port npm run dev`.

Soll der Dienst die Oberfläche selbst ausliefern: `npm run build` schreibt nach
`src/TierModel.Service/wwwroot` (nicht eingecheckt).

## Tests

```bash
cd service
dotnet test                                     # Unit-Tests; API-Tests werden übersprungen
TIERMODEL_TEST_ADMIN_CONNECTION="Host=localhost;Username=postgres;Password=…" dotnet test
                                                # + API-Tests: legen je Lauf eine Wegwerf-Datenbank an und löschen sie
cd web && npm run typecheck                     # TypeScript
```

| Testklasse | Prüft |
|---|---|
| `ConfigValidatorTests` | OU-DN-Auflösung, Validierung der echten Framework-Konfiguration (muss fehlerfrei sein), Fehler/Warnungen |
| `RunTests` | Eingabeprüfung (DC-Name gegen Argument-Injection), Prozessargumente für Planen/Anwenden/Audit, Log-Klassifizierung |
| `ScheduleTests` | Cron + Zeitzone → UTC, Validierung |
| `ApiTests` | CSRF-Pflicht, 401 ohne Anmeldung, Versionierung mit 409-Konflikt, kompletter Audit-Lauf mit Befunden, Rollen und Pflicht-Passwortänderung, 404 für unbekannte API-Pfade |

Die PowerShell-Tests des Frameworks (Pester) liegen unverändert unter `tests/` im Repository-Stamm.

## Release-Paket bauen

```powershell
pwsh service/build/Build-Release.ps1            # Version aus service/VERSION
pwsh service/build/Build-Release.ps1 -Version 1.1.0
```

Das Skript baut die Oberfläche, veröffentlicht den Dienst **self-contained für win-x64**, kopiert Framework
(`Deploy-/Audit-TierModel.ps1`, `modules\`, `config\`) und Installer dazu und erzeugt
`service/artifacts/TierModelService-<Version>.zip` samt SHA-256-Prüfsumme. Es läuft unter Windows, Linux und macOS.

## Datenbank

Schema per EF-Core-Migrationen (`Data/Migrations`). Der Dienst migriert beim Start automatisch.

```bash
dotnet tool install --global dotnet-ef
dotnet ef migrations add <Name> -p service/src/TierModel.Service -o Data/Migrations
```

| Tabelle | Inhalt |
|---|---|
| `users` | Konten, Rolle, Passwort-Hash, Sperre, Security-Stamp |
| `config_sections` | ein Eintrag je Konfigurationsbereich mit aktueller Version |
| `config_versions` | vollständiger JSON-Inhalt jeder Version (als Text, damit Reihenfolge und Format erhalten bleiben), SHA-256, Autor, Kommentar |
| `runs` | Läufe mit Parametern, Status, Ergebnis, verwendeten Versionen, Zusammenfassung und Befunden (jsonb) |
| `run_log_lines` | Ausgabezeilen je Lauf |
| `schedules` | Zeitpläne (Cron, Zeitzone, Parameter, nächste/letzte Ausführung) |
| `change_log` | Änderungsprotokoll |
| `settings` | Einstellungen aus der Oberfläche |

Alle Zeitstempel werden in UTC gespeichert (`timestamptz`).

## Einen Konfigurationsbereich ergänzen

1. Datei im Framework unter `config/` anlegen.
2. Eintrag in `Config/ConfigCatalog.cs` (Schlüssel, Dateiname, Titel, optional die Eigenschaft mit der Liste).
3. Optional Prüfregeln in `Config/ConfigValidator.cs` und ein Formular in `web/src/features/config/`;
   ohne eigenes Formular erscheint der Bereich automatisch im generischen strukturierten Formular (`object-form.tsx`).

Beim nächsten Start importiert der Dienst die neue Datei als Version 1.

## Konventionen

- Oberfläche und Meldungen an Anwender auf **Deutsch**, Code und Code-Kommentare auf Englisch.
- API in camelCase, Enums als Strings, Fehler als RFC-7807-ProblemDetails.
- Neue Endpunkte immer mit Rollen-Policy (`RequireAuthorization(nameof(Role.…))`) und in [REST-API](api.md) dokumentieren.
- Alles, was als Prozessargument endet, strikt validieren.
