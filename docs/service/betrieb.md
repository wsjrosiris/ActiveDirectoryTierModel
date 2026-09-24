# Betrieb

## Dienst

| | |
|---|---|
| Dienstname | `TierModelService` („TierModel Service“) |
| Start | Automatisch (verzögert); bei Absturz Neustart nach 1, 1 und 5 Minuten |
| Programm | `C:\Program Files\TierModelService\app\TierModel.Service.exe` |
| Zustand prüfen | `Get-Service TierModelService` bzw. `https://<server>:<port>/healthz` → `{"status":"ok"}` (200, sonst 503 = Datenbank nicht erreichbar) |

Die Schlüssel, mit denen der Dienst Anmelde-Cookies schützt, liegen in `<WorkPath>\keys` (per DPAPI für das
Dienstkonto verschlüsselt). Wer sie löscht, meldet alle Benutzer ab.

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
| `TierModel:PublicBaseUrl` | leer | Vorgabe für die öffentliche Adresse (Links in Benachrichtigungen) |
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
| Genauer Aufruf eines Laufs | `C:\ProgramData\TierModelService\runs\<Nr>\run.ps1` – lässt sich zur Fehlersuche als Dienstkonto erneut ausführen |
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

## Windows-Anmeldung einrichten

Die Anmeldung mit Windows-Konto nutzt Kerberos (Fallback NTLM) und funktioniert nur auf dem Windows-Server.

1. **SPN registrieren** – der Installer bietet das an. Manuell (Recht zum Schreiben von SPNs nötig):
   ```powershell
   setspn -S HTTP/tiermodel01.contoso.com CONTOSO\svc-tiermodel$
   setspn -S HTTP/tiermodel01 CONTOSO\svc-tiermodel$
   ```
   Läuft der Dienst als LocalSystem, genügt der vorhandene HOST-SPN des Computerkontos.
2. **Browser**: Die Adresse muss in der Zone *Lokales Intranet* liegen, damit Edge/Chrome das Windows-Konto
   automatisch übergeben (GPO *Liste der Site zu Zonenzuweisungen*, z. B. `https://tiermodel01.contoso.com` → 1).
   Sonst fragt der Browser nach Anmeldedaten.
3. **Rollen zuordnen**: *Administration › Windows-Anmeldung* – je Rolle eine oder mehrere AD-Gruppen eintragen,
   aktivieren, speichern. Empfohlen: eigene Gruppen wie `TierModel-Viewers`, `TierModel-Operators` …
4. Abmelden und **Mit Windows-Konto anmelden** testen. Abgelehnte Versuche stehen im Änderungsprotokoll
   („Windows-Anmeldung abgelehnt“).

Hinweise: Gruppenmitgliedschaften werden erst mit einem neuen Kerberos-Ticket wirksam (neu anmelden oder
`klist purge`). Browser wechseln für die Windows-Anmeldung automatisch auf HTTP/1.1.

## Benachrichtigungen einrichten

*Administration › Benachrichtigungen*:

- **E-Mail**: SMTP-Server, Port, Verschlüsselung (StartTLS empfohlen), optional Benutzer/Passwort und Absender
  eintragen; dann einen Kanal vom Typ E-Mail mit Empfängern (durch Komma getrennt) anlegen.
- **Microsoft Teams**: Im gewünschten Kanal einen Workflow *„Beim Empfang einer Teams-Webhookanforderung in einem
  Kanal posten“* anlegen (oder einen eingehenden Webhook) und dessen URL als Ziel eintragen. Nachrichten erscheinen
  als Adaptive Card mit Link zum Lauf.
- **Webhook**: Beliebige https-URL; der Dienst sendet `POST` mit JSON
  (`event`, `title`, `text`, `url`, `facts`, `sentAt`), z. B. für ein Ticketsystem oder SIEM.

Damit die Links funktionieren, unter *Einstellungen* die **öffentliche Adresse** setzen (der Installer trägt sie vor).
Webhook-URLs und das SMTP-Passwort werden verschlüsselt gespeichert und nicht wieder angezeigt. Fehlgeschlagene
Zustellungen werden dreimal wiederholt und stehen danach am Kanal und im Änderungsprotokoll.

Das Ereignis **Zertifikat** meldet einmal täglich, wenn das HTTPS-Zertifikat in weniger als 30 Tagen abläuft. Den
Gesamtzustand des Dienstes zeigt *Administration › Systemzustand*.

Der Dienst braucht für E-Mail Zugang zum SMTP-Server und für Teams/Webhooks ausgehenden HTTPS-Zugang (ggf. über den
System-Proxy).

## SIEM-Anbindung

Unter *Benachrichtigungen* zwei weitere Kanalarten:

- **Syslog**: RFC 5424 über UDP, TCP oder TCP mit TLS (Zertifikatsprüfung abschaltbar, nur für Tests); Format CEF
  (für `CommonSecurityLog` in Sentinel) oder RFC 5424 mit strukturierten Daten (SD-ID `tiermodel@32473` – die
  Enterprise-Nummer 32473 ist die Dokumentationsnummer der IANA; bei Bedarf eigene verwenden).
- **Log Analytics**: Logs Ingestion API von Azure Monitor – Mandant, Client-ID, Client-Secret, DCE-Endpunkt,
  DCR-ID (immutable) und Stream. Tabelle z. B. `TierModel_CL` mit den Spalten `TimeGenerated, EventId, EventName,
  Severity:int, Category, Message, Computer, Actor, Account, AccountSid, GroupName, Action, RunId:long, Url,
  Fields:dynamic`.

Neben den bekannten Ereignissen lassen sich **alle Einträge des Änderungsprotokolls** weiterleiten; außerdem wird
jeder neue Befund der Überwachung (Mitglied hinzugefügt/entfernt, nicht erwartetes Mitglied, Hygiene, Angriffspfad)
als eigenes Ereignis gesendet. Die Weiterleitung blockiert keine Anfrage; läuft die Warteschlange (5000 Ereignisse)
über, zeigt der Kanal die Zahl verworfener Ereignisse (seit dem letzten Dienststart).

Zuordnung zu den Sentinel-Regeln unter `optional/TIerModel-Sentinel`:

| Ereignis (CEF `DeviceEventClassID` / `EventId`) | Felder | Regel |
|---|---|---|
| TM-301 Mitglied hinzugefügt, TM-310 nicht erwartetes Mitglied | `cs1` Gruppe, `duser`/`duid` Konto, `cs2` Gruppen-SID | TM001.1, TM016.1, TM017.1 – TM-310 ist ein Verstoß, TM-301 allein erwartet |
| TM-330 Angriffspfad | `duser` Principal, `cs4` Objekt-DN, `cs5` Rechte | TM006.1, TM009.1, TM015.1 |
| TM-202 Deploy angewendet, TM-400 `run.approve`/`run.deploy` | `suser`, `approvedBy`, `cn1` Lauf | TM002–TM005, TM007, TM008, TM012, TM014: Änderungen während eines freigegebenen Deploys unterdrücken oder annotieren |
| TM-200 Drift | `cn2` Anzahl, `cn1` Lauf | TM005, TM012, TM013 (nicht freigegebene GPO-/OU-Änderungen) |
| TM-302 Mitglied entfernt, TM-320 Hygiene, TM-201/203/204, TM-400 `auth.*` | – | noch ohne Regel |

```kusto
CommonSecurityLog
| where DeviceVendor == "TierModel" and DeviceEventClassID == "TM-310"
| project TimeGenerated, Group = DeviceCustomString1, Account = DestinationUserName,
          Sid = DestinationUserId, RunId = DeviceCustomNumber1
```

## Entra-ID-Anmeldung einrichten

1. In Entra ID eine App-Registrierung (Web) anlegen; Umleitungs-URI `https://<öffentliche Adresse>/signin-oidc`
   (wird auf der Einstellungsseite zum Kopieren angezeigt).
2. Ein Client-Secret erzeugen; unter *Token-Konfiguration* den Gruppen-Anspruch (`groups`) hinzufügen oder
   App-Rollen definieren und zuweisen.
3. *Administration › Entra-ID-Anmeldung*: Mandanten-ID, Client-ID, Secret und je Rolle die Gruppen-Objekt-IDs bzw.
   App-Rollen eintragen, **Konfiguration prüfen**, aktivieren.

Auf der Anmeldeseite erscheint dann **Mit Microsoft anmelden**. Konten werden bei der ersten Anmeldung angelegt;
ohne passende Gruppe wird die Anmeldung abgelehnt. MFA und Gerätevorgaben regelt Conditional Access.

## API-Tokens und PowerShell-Client

Über das Benutzermenü › **API-Tokens** legt man Tokens für Skripte an (Name, Rolle bis zur eigenen, Gültigkeit
30–365 Tage). Das Token wird **nur einmal** angezeigt. Administratoren sehen und widerrufen alle Tokens.

Das Modul `client\TierModel.Service.Client` aus dem Paket auf den Admin-Rechner kopieren:

```powershell
Connect-TierModelService -Uri https://tiermodel01.contoso.com:8443 -Token (Read-Host -AsSecureString)
$run = Start-TierModelAudit -PreferredDc dc01.contoso.com -FullDeployment | Wait-TierModelRun
Get-TierModelRun -Id $run.Id
Get-TierModelCompliance
```

Weitere Befehle: `Start-TierModelMonitor`, `Start-TierModelDeploy -Plan` / `-Apply -PlanRunId`,
`Get-TierModelRunLog`, `Get-TierModelPrivileged`, `Get-TierModelConfigSection`, `Disconnect-TierModelService`.

## Git-Anbindung

*Einstellungen › Git*: Repository (https), Branch, Benutzer und Token, Pfad im Repository (Standard `config`),
Absender für Commits. Jede gespeicherte Version wird als Commit geschrieben (Autor = speichernde Person,
Nachricht = Kommentar mit den Zeilen `TierModel-Section`, `TierModel-Version`, `TierModel-Instance`) und gepusht;
`versions.json` liegt neben dem Konfigurationsordner wie im Export. Fehlgeschlagene Pushes werden mit wachsendem
Abstand (30 s bis 15 min) wiederholt. Hat jemand im Repository dieselben Dateien geändert, meldet der Dienst einen
**Konflikt** und pusht nicht mehr, bis ein Administrator **Remote übernehmen** wählt (lokalen Stand verwerfen,
aktuelle Konfiguration neu schreiben). Der lokale Klon liegt unter `WorkPath\git\repo`; Status und letzter Commit
stehen in den Einstellungen und unter *Systemzustand*. Git ist im Dienst enthalten (LibGit2Sharp), auf dem Server
muss kein Git installiert sein.

## Mehrere Domänen

Das Dienstkonto braucht in jeder verwalteten Domäne dieselben Rechte wie in der ersten (für Deploy Mitglied von
*Domänen-Admins* der jeweiligen Domäne); andere Gesamtstrukturen nur über eine Vertrauensstellung – getrennte
Anmeldedaten je Domäne gibt es nicht. Die Warteschlange ist gemeinsam: Läufe verschiedener Domänen laufen
nacheinander. Beim Update auf diese Version legt die Migration die erste Domäne aus Standard-DC und ADML-Sprache an
und ordnet ihr alle vorhandenen Daten zu.

**Git:** Die erste Domäne behält den bisherigen Pfad; weitere Domänen liegen unter `<Schlüssel>/<Pfad>/` mit eigener
`versions.json`, Commits tragen `TierModel-Domain`. Nach einer Schlüsseländerung bleibt der alte Ordner im Repository
stehen und kann dort gelöscht werden.

**PowerShell-Client:** `Connect-TierModelService -Domain <key>` bzw. `-Domain` je Befehl, `Get-TierModelDomain`;
`-PreferredDc` ist optional (Standard-DC der Domäne).

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
| „Mit Windows-Konto anmelden“ fehlt | Windows-Anmeldung unter *Administration* nicht aktiviert |
| Browser fragt nach Anmeldedaten | Seite nicht in der Intranetzone oder SPN fehlt (`setspn -Q HTTP/<fqdn>`) |
| „Ihr Windows-Konto ist keiner Rolle zugeordnet“ | Konto in keiner zugeordneten AD-Gruppe, oder Mitgliedschaft noch nicht im Ticket (neu anmelden) |
| Benachrichtigung kommt nicht an | *Testnachricht senden*, Fehlertext am Kanal prüfen (SMTP-Anmeldung, Proxy, Webhook-URL abgelaufen) |
| Freigabe nicht möglich | nur Operatoren, nicht der Antragsteller; Frist abgelaufen → neu einreichen |
| Zeitplan läuft nicht | Zeitplan aktiv? „Nächste Ausführung“ gesetzt? Läuft der vorherige Lauf noch (dann wird übersprungen)? |
