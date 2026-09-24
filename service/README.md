# TierModel Service

Windows-Dienst mit Weboberfläche und PostgreSQL-Datenbank für das Active Directory Tier Model.
Die vollständige Dokumentation liegt unter [`docs/service/`](../docs/service/index.md):

| | |
|---|---|
| [Überblick & Architektur](../docs/service/index.md) | Aufbau, Ablauf eines Laufs, Verhältnis zum Framework |
| [Installation](../docs/service/installation.md) | Voraussetzungen, gMSA vorbereiten, Assistent Schritt für Schritt, Aktualisieren, Deinstallieren |
| [Bedienung](../docs/service/bedienung.md) | Rollen, Konfiguration, Deploy, Audits, Zeitpläne, Läufe, Administration |
| [Betrieb](../docs/service/betrieb.md) | `appsettings.Production.json`, Protokolle, Sicherung, Zertifikat, Kommandozeile, Fehlerbehebung |
| [Sicherheit](../docs/service/sicherheit.md) | Tier-0-Einstufung, Schutzmaßnahmen, Härtung, bekannte Grenzen |
| [Entwicklung](../docs/service/entwicklung.md) | Projektstruktur, lokale Umgebung, Tests, Release-Paket, Migrationen |
| [REST-API](../docs/service/api.md) | Endpunkte, Datenmodelle, Rollen |

## Kurzfassung für Entwickler

```bash
# Backend (http://localhost:5080) – braucht PostgreSQL, siehe docs/service/entwicklung.md
cd service/src/TierModel.Service && dotnet run

# Oberfläche mit Hot Reload (http://localhost:5173)
cd service/web && npm install && npm run dev

# Tests
cd service && dotnet test

# Installationspaket
pwsh service/build/Build-Release.ps1
```

| Ordner | Inhalt |
|---|---|
| `src/TierModel.Service/` | Backend: ASP.NET Core 10, EF Core/Npgsql, Windows-Dienst |
| `web/` | Weboberfläche: React 19, TypeScript, Vite, Tailwind CSS 4 |
| `tests/` | xUnit: Unit-Tests und API-Tests gegen PostgreSQL |
| `installer/` | `Setup.cmd` und `Install-TierModelService.ps1` |
| `build/` | `Build-Release.ps1` |
| `dev/` | `fake-pwsh.sh` – simuliert Deploy/Audit ohne Active Directory |
