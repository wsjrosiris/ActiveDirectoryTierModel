# Betrieb

## Dienst

| | |
|---|---|
| Dienstname | `TierModelService` („TierModel Service“) |
| Start | Automatisch (verzögert); bei Absturz Neustart nach 1, 1 und 5 Minuten |
| Programm | `C:\Program Files\TierModelService\app\TierModel.Service.exe` |
| Zustand prüfen | `Get-Service TierModelService` bzw. `https://<server>:<port>/healthz` → `{"status":"ok"}` (200, sonst 503 = Datenbank nicht erreichbar) |

Beim Start wendet der Dienst ausstehende Datenbankmigrationen an und importiert neu hinzugekommene
Konfigurationsbereiche. Läufe, die beim Beenden noch liefen, werden als *Fehlgeschlagen* markiert
(„Der Dienst wurde während des Laufs beendet“).

## Konfigurationsdatei

Maschinenspezifische Einstellungen stehen in `app\appsettings.Production.json`. Der Installer schreibt die Datei;
sie ist nur für SYSTEM, Administratoren und das Dienstkonto lesbar, weil sie das Datenbankpasswort enthält.
Nach Änderungen den Dienst neu starten.

```json
{
  "ConnectionStrings": {
    "TierModel": "Host=localhost;Port=5432;Database=tiermodel;Username=tiermodel;Password=…;SSL Mode=Prefer"
  },
  "TierModel": {
    "FrameworkPath": "C:\\Program Files\\TierModelService\\framework",
    "WorkPath": "C:\\ProgramData\\TierModelService",
    "PwshPath": "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    "DefaultPreferredDc": "dc01.contoso.com",
    "AdmlLanguage": "en-US",
    "CertificateThumbprint": "…",
    "RequireHttps": true
  },
  "Kestrel": { "Endpoints": { "Https": { "Url": "https://*:8443" } } }
}
```

| Schlüssel | Standard | Bedeutung |
|---|---|---|
| `ConnectionStrings:TierModel` | – | Npgsql-Verbindungszeichenfolge |
| `TierModel:FrameworkPath` | `<app>\framework` | Ordner mit `Deploy-TierModel.ps1`, `Audit-TierModel.ps1`, `modules\`, `config\` |
| `TierModel:WorkPath` | `<app>\data` | Arbeitskopien und Berichte je Lauf (`runs\`) |
| `TierModel:PwshPath` | `pwsh.exe` | PowerShell 7 |
| `TierModel:RunTimeoutMinutes` | `240` | Läufe darüber werden beendet und als fehlgeschlagen markiert |
| `TierModel:DefaultPreferredDc` | leer | Vorgabe, solange unter *Einstellungen* nichts gespeichert ist |
| `TierModel:AdmlLanguage` | `en-US` | dito |
| `TierModel:RunRetentionDays` | `90` | dito |
| `TierModel:CertificateThumbprint` | leer | HTTPS-Zertifikat aus `LocalMachine\My` |
| `TierModel:RequireHttps` | `true` | HSTS, HTTPS-Umleitung, `Secure`-Cookies. Nur für die Entwicklung abschalten. |
| `Kestrel:Endpoints:Https:Url` | `https://*:8443` | Adresse und Port |

Werte aus der Oberfläche (*Administration › Einstellungen*) liegen in der Datenbank und haben Vorrang vor den
Vorgaben in der Datei.

## Protokolle

| Was | Wo |
|---|---|
| Dienst (Start, Fehler, abgeschlossene Läufe) | Ereignisanzeige › Windows-Protokolle › **Anwendung**, Quelle `TierModel.Service` |
| Ausgabe jedes Laufs | Oberfläche › Läufe › Protokoll (Datenbank) |
| Berichte der Skripte | `C:\ProgramData\TierModelService\runs\<Nr>\out\` (`deploy-*.log`, `audit-*.json`) |
| Installationsassistent | `C:\ProgramData\TierModelService\logs\setup-*.log` |
| Fachliches Änderungsprotokoll | Oberfläche › Änderungsprotokoll (Datenbank) |

## Aufbewahrung

Einmal täglich löscht der Dienst Protokollzeilen und Arbeitsverzeichnisse von Läufen, die älter als die
eingestellte Aufbewahrung sind (Standard 90 Tage). Status, Parameter, Zusammenfassung und Befunde der Läufe,
Konfigurationsversionen und das Änderungsprotokoll bleiben dauerhaft erhalten.

## Sicherung und Wiederherstellung

Alle fachlichen Daten liegen in der PostgreSQL-Datenbank. Das Programmverzeichnis lässt sich jederzeit aus dem
Paket neu installieren; zusätzlich `appsettings.Production.json` sichern.

```powershell
# Sicherung (auf dem Datenbankserver; pg_dump liegt im bin-Ordner von PostgreSQL)
& 'C:\Program Files\PostgreSQL\17\bin\pg_dump.exe' -U postgres -Fc -f "D:\Backup\tiermodel-$(Get-Date -f yyyyMMdd).dump" tiermodel

# Wiederherstellung (Dienst vorher stoppen)
Stop-Service TierModelService
& 'C:\Program Files\PostgreSQL\17\bin\pg_restore.exe' -U postgres -d tiermodel --clean --if-exists "D:\Backup\tiermodel-20260924.dump"
Start-Service TierModelService
```

Empfehlung: täglich per Aufgabenplanung sichern und die Sicherung wie andere Tier-0-Daten schützen.

Unabhängig davon lässt sich die aktuelle Konfiguration jederzeit über **Konfiguration › Export** als ZIP im
Framework-Format sichern.

## Häufige Aufgaben

### Administrator-Passwort zurücksetzen

Falls sich kein Administrator mehr anmelden kann (auf dem Server, als lokaler Administrator):

```powershell
cd 'C:\Program Files\TierModelService\app'
Read-Host 'Neues Passwort' | .\TierModel.Service.exe admin reset-password --username admin
```

Das Konto wird dabei auch reaktiviert und entsperrt.

### Zertifikat erneuern oder tauschen

1. Neues Zertifikat in `LocalMachine\My` importieren.
2. Dem Dienstkonto Leserecht auf den privaten Schlüssel geben
   (`certlm.msc` › Zertifikat › Alle Aufgaben › Private Schlüssel verwalten).
3. Fingerabdruck in `appsettings.Production.json` unter `TierModel:CertificateThumbprint` eintragen.
4. `Restart-Service TierModelService`

Alternativ `Setup.cmd` › **Neu konfigurieren** ausführen und das neue Zertifikat auswählen.

### Port ändern

`Kestrel:Endpoints:Https:Url` anpassen, Firewall-Regel `TierModelService-HTTPS` anpassen, Dienst neu starten.

### Datenbankpasswort ändern

```powershell
cd 'C:\Program Files\TierModelService\app'
# Zeile 1: Passwort des PostgreSQL-Administrators, Zeile 2: neues Passwort für den Dienstbenutzer (≥ 16 Zeichen)
"<admin-passwort>`n<neues-passwort>" | .\TierModel.Service.exe db provision --host <server> --admin-user postgres
```

Danach das neue Passwort in `appsettings.Production.json` eintragen und den Dienst neu starten.

### PowerShell-/Framework-Aktualisierung

- Neue PowerShell-7-Version: normal installieren; der Pfad bleibt gleich.
- Neue Framework-Version: kommt mit dem nächsten Paket (**Aktualisieren**). Die Konfiguration in der Datenbank
  bleibt unverändert; neue Konfigurationsbereiche werden beim Start automatisch importiert.

## Kommandozeile

```
TierModel.Service.exe migrate                                        Schema aktualisieren, Framework-Konfiguration importieren
TierModel.Service.exe admin create --username NAME [--display TEXT]  Administrator anlegen (Passwort: stdin)
TierModel.Service.exe admin reset-password --username NAME           Passwort setzen, Konto aktivieren/entsperren (stdin)
TierModel.Service.exe db provision --host H [--port 5432] [--ssl-mode Prefer|Require|VerifyFull]
                                   [--admin-user postgres] [--database tiermodel] [--app-user tiermodel]
                                                                     Datenbank und Benutzer anlegen (stdin: Admin-PW, App-PW)
TierModel.Service.exe db test [--connection "…"]                     Verbindung prüfen (ohne --connection: stdin)
```

Passwörter werden grundsätzlich über die Standardeingabe übergeben, damit sie nicht in Prozesslisten oder der
Befehlshistorie erscheinen. Die Befehle verwenden `appsettings.Production.json` im selben Ordner.

## Fehlerbehebung

| Symptom | Ursache / Lösung |
|---|---|
| Dienst startet nicht, Ereignis „Zertifikat … nicht gefunden“ | Fingerabdruck falsch oder Zertifikat gelöscht → [Zertifikat tauschen](#zertifikat-erneuern-oder-tauschen) |
| Ereignis „kein privater Schlüssel verfügbar“ | Dienstkonto hat kein Leserecht auf den privaten Schlüssel |
| `/healthz` liefert 503 | Datenbank nicht erreichbar: Dienst `postgresql-x64-*` läuft? Firewall/TLS bei entferntem Server? `TierModel.Service.exe db test` |
| Browser: Seite lädt, Anmeldung meldet „CSRF-Token“ | Seite neu laden; Proxy darf Cookies nicht entfernen; Zugriff immer über dieselbe Adresse |
| Lauf endet sofort mit „Domain Admin membership required“ | Dienstkonto ist nicht (rekursiv) Mitglied von *Domain Admins* bzw. Mitgliedschaft noch nicht im Ticket → Dienst neu starten |
| „Elevation required“ / Administratorrechte | Dienstkonto ist nicht lokaler Administrator (bei Domain-Admins-Mitgliedschaft normalerweise automatisch) |
| „ActiveDirectory module not available“ | RSAT fehlt: `Install-WindowsFeature RSAT-AD-PowerShell, GPMC` |
| „'pwsh.exe' konnte nicht gestartet werden“ | PowerShell 7 fehlt oder `TierModel:PwshPath` falsch |
| „Framework nicht gefunden“ | `TierModel:FrameworkPath` zeigt nicht auf den Ordner mit `Deploy-TierModel.ps1` |
| Anwenden startet nicht: „Validierungsfehler“ | *Konfiguration › Validierung* öffnen und Fehler beheben |
| Lauf „Zeitüberschreitung nach 240 Minuten“ | `TierModel:RunTimeoutMinutes` erhöhen oder Bereich verkleinern |
| Konto gesperrt | 15 Minuten warten oder Administrator entsperrt unter *Benutzer* |
| Zeitplan läuft nicht | Zeitplan aktiv? „Nächste Ausführung“ gesetzt? Läuft der vorherige Lauf noch (dann wird übersprungen)? |
