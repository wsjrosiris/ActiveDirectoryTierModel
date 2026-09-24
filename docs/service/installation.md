# Installation

Die Installation erledigt ein Assistent: Paket entpacken, **`Setup.cmd`** starten, Fragen beantworten.
Diese Seite beschreibt Voraussetzungen, Vorbereitung und jeden Schritt des Assistenten.

## Voraussetzungen

| Bereich | Anforderung |
|---|---|
| Server | Windows Server 2019, 2022 oder 2025 (x64), **Mitglied der Domäne**. Empfohlen: eigener Server, 2 vCPU, 4 GB RAM, 20 GB frei. |
| Einstufung | Der Server ändert Tier-0-Objekte und ist deshalb **selbst ein Tier-0-System** (siehe [Sicherheit](sicherheit.md)). |
| PowerShell | Windows PowerShell 5.1 für den Installer (immer vorhanden). **PowerShell 7** für Deploy/Audit – installiert der Assistent bei Bedarf. |
| Module | `ActiveDirectory` und `GroupPolicy` (RSAT) – installiert der Assistent bei Bedarf. |
| .NET | Nicht nötig: Der Dienst bringt seine Laufzeit mit (self-contained). |
| PostgreSQL | Version 14 oder neuer. Entweder ein **vorhandener Server** oder eine **lokale Installation** durch den Assistenten. |
| Netzwerk | Eingehend: HTTPS-Port der Oberfläche (Standard **8443**). Ausgehend: LDAP/Kerberos/SMB/RPC zum bevorzugten DC, bei entfernter Datenbank TCP 5432. |
| Internet | Nur falls der Assistent PowerShell 7 oder PostgreSQL herunterladen soll. Offline: Installer-Dateien vorher bereitlegen (siehe unten). |
| Installierende Person | Lokaler Administrator auf dem Server, für gMSA-Anlage zusätzlich Rechte im AD. |

### Dienstkonto vorbereiten (gMSA, empfohlen)

Der Dienst ruft `Deploy-TierModel.ps1` und `Audit-TierModel.ps1` mit **seinem Dienstkonto** auf. Das Framework
prüft vor jedem Lauf, ob dieses Konto (auch über verschachtelte Gruppen) **Mitglied von „Domain Admins“** ist, und
bricht sonst ab. Ein **Group Managed Service Account (gMSA)** ist dafür ideal: Das Passwort wird automatisch
rotiert, niemand kennt es, und interaktive Anmeldungen sind nicht möglich.

Einmalig auf einem DC bzw. mit RSAT ausführen (Namen anpassen):

```powershell
# Nur falls in der Gesamtstruktur noch nie ein gMSA angelegt wurde:
Add-KdsRootKey -EffectiveImmediately   # Replikation abwarten (bis zu 10 Stunden) oder in Testumgebungen -EffectiveTime ((Get-Date).AddHours(-10))

# gMSA anlegen – nur das Computerkonto des Dienst-Servers darf das Passwort abrufen
New-ADServiceAccount -Name 'svc-tiermodel' -DNSHostName 'svc-tiermodel.contoso.com' `
    -PrincipalsAllowedToRetrieveManagedPassword 'TIERMODEL01$' `
    -Path 'OU=Tier 0 Service Accounts,OU=Tier 0,OU=Tier Model Administration,DC=contoso,DC=com'

# Rechte für das Framework
Add-ADGroupMember -Identity 'Domain Admins' -Members 'svc-tiermodel$'
```

!!! note "Neustart"
    Nach dem Anlegen muss der Dienst-Server seine Gruppenmitgliedschaft neu einlesen – Server neu starten
    oder `klist purge -li 0x3e7` ausführen. Der Assistent installiert das gMSA anschließend selbst
    (`Install-ADServiceAccount`) und prüft es mit `Test-ADServiceAccount`.

Alternativen, die der Assistent ebenfalls anbietet:

- **Domänenkonto mit Passwort** – funktioniert, das Passwort muss aber gepflegt werden.
- **LocalSystem** – nutzt das Computerkonto des Servers. Nur für Tests; das Computerkonto müsste dafür Mitglied
  von „Domain Admins“ sein.

### HTTPS-Zertifikat (empfohlen)

Für den Produktivbetrieb vorab ein Serverzertifikat der Unternehmens-CA in **`LocalMachine\My`** importieren
(Antragstellername/SAN = FQDN des Servers, erweiterte Schlüsselverwendung „Serverauthentifizierung“). Der
Assistent listet alle passenden Zertifikate zur Auswahl. Alternativ erzeugt er ein selbstsigniertes Zertifikat
– Browser zeigen dann eine Warnung, bis es ersetzt wird ([Zertifikat tauschen](betrieb.md#zertifikat-erneuern-oder-tauschen)).

### Offline-Installation

Ohne Internetzugang vorher bereitlegen und im Assistenten den **Pfad** statt der URL angeben:

- PowerShell 7 MSI (`PowerShell-7.x.y-win-x64.msi`) von <https://aka.ms/powershell>
- PostgreSQL-Installer für Windows x64 (EDB) von <https://www.enterprisedb.com/downloads/postgres-postgresql-downloads>
  – nur bei lokaler Datenbank

## Installationspaket

Das Paket `TierModelService-<Version>.zip` wird aus dem Repository gebaut
(siehe [Entwicklung › Release-Paket](entwicklung.md#release-paket-bauen)):

```
TierModelService-1.0.0\
├── Setup.cmd                     ← starten
├── Install-TierModelService.ps1  Assistent
├── README.txt                    Kurzanleitung
├── VERSION
├── app\                          Dienst + Weboberfläche (self-contained)
└── framework\                    Deploy-/Audit-Skripte, Modul, GPO- und ADMX-Dateien
```

## Der Assistent Schritt für Schritt

Paket auf den Server kopieren, entpacken (z. B. nach `C:\Install\TierModelService-1.0.0`) und
**`Setup.cmd` doppelklicken**. Administratorrechte werden bei Bedarf angefordert. Jede Frage hat einen Vorschlag
in `[eckigen Klammern]`, den **Enter** übernimmt. Bis zur Zusammenfassung wird **nichts verändert**.

### 1. Voraussetzungen prüfen

Der Assistent zeigt Betriebssystem und Domäne und prüft PowerShell 7 sowie die Module `ActiveDirectory` und
`GroupPolicy`. Fehlt etwas, bietet er die Installation an:

- PowerShell 7 über `winget` oder als MSI (aktuelle Version von GitHub oder Pfad/URL zu einem MSI)
- RSAT über `Install-WindowsFeature RSAT-AD-PowerShell, GPMC` (Server) bzw. Windows-Funktionen (Client)

### 2. Installationsort

| Frage | Vorschlag |
|---|---|
| Programmverzeichnis | `C:\Program Files\TierModelService` |
| Datenverzeichnis | `C:\ProgramData\TierModelService` (Arbeitskopien und Berichte der Läufe) |

### 3. Datenbank

| Auswahl | Was passiert | Benötigt |
|---|---|---|
| **1 – Vorhandener Server** | Legt Datenbank und Datenbankbenutzer an (bzw. aktualisiert das Passwort, falls vorhanden) und entzieht `PUBLIC` alle Rechte an der Datenbank. | Hostname, Port, Administrator (z. B. `postgres`) und dessen Passwort. Bei entfernten Servern: Verschlüsselung wählen (Standard „TLS erforderlich“). |
| **2 – Lokal installieren** | Installiert PostgreSQL unbeaufsichtigt (Server + Kommandozeilenwerkzeuge, ohne pgAdmin/StackBuilder), bindet es nur an `localhost` und legt dann Datenbank und Benutzer an. | Neues Passwort für den Superuser `postgres` – **im Passwort-Tresor ablegen**. |
| **3 – Vorhandene Datenbank** | Verbindet nur. | Host, Port, Datenbank, Benutzer und dessen Passwort. Der Benutzer braucht das Recht, Tabellen anzulegen (Eigentümer der Datenbank). |

Für 1 und 2 erzeugt der Assistent ein **zufälliges 32-stelliges Passwort** für den Datenbankbenutzer des Dienstes.
Es wird nur in der geschützten Dienstkonfiguration gespeichert.

### 4. Dienstkonto

gMSA (empfohlen), Domänenkonto oder LocalSystem – siehe [Vorbereitung](#dienstkonto-vorbereiten-gmsa-empfohlen).
Beim gMSA wird der Name **ohne `$`** eingegeben; der Assistent ergänzt Domäne und `$`, installiert das Konto
bei Bedarf und prüft es. Beim Domänenkonto werden die Anmeldedaten gegen die Domäne geprüft.
Das Recht **„Als Dienst anmelden“** setzt der Assistent selbst.

### 5. Weboberfläche

| Frage | Hinweis |
|---|---|
| HTTPS-Port | Standard `8443`. Belegte Ports werden abgelehnt. |
| Zertifikat | Auswahl aus `LocalMachine\My` (nur gültige Zertifikate mit privatem Schlüssel) oder neues selbstsigniertes Zertifikat (RSA 3072, 3 Jahre, nicht exportierbar). Das Dienstkonto erhält Leserecht auf den privaten Schlüssel. |
| Firewall-Regel | Eingehend, TCP, Profil **Domäne**. Optional auf Quelladressen beschränken, z. B. das Netz der PAWs: `10.0.10.0/24`. |

### 6. Standardwerte

Bevorzugter Domänencontroller (Vorschlag: automatisch ermittelter DC) und ADML-Sprache. Beides ist später in der
Oberfläche unter **Administration › Einstellungen** änderbar.

### 7. Erstes Administratorkonto

Benutzername, Anzeigename und Passwort (mindestens 12 Zeichen) für die Anmeldung an der Oberfläche.
Existiert der Benutzer bereits (z. B. bei „Neu konfigurieren“), fragt der Assistent, ob das Passwort
zurückgesetzt werden soll.

### 8. Zusammenfassung und Ausführung

Nach Bestätigung führt der Assistent aus:

1. ggf. PostgreSQL installieren
2. Programmdateien kopieren
3. Datenbank und Benutzer anlegen, Verbindung testen
4. ggf. selbstsigniertes Zertifikat erzeugen
5. `app\appsettings.Production.json` schreiben
6. Datenbankschema anlegen und die Framework-Konfiguration als Version 1 importieren
7. Administratorkonto anlegen
8. Dateiberechtigungen setzen (Konfigurationsdatei nur für SYSTEM, Administratoren und Dienstkonto lesbar)
9. Ereignisquelle registrieren, Windows-Dienst `TierModelService` anlegen (verzögerter Autostart,
   Neustart nach Fehlern), Dienstkonto zuweisen
10. Firewall-Regel anlegen
11. Dienst starten und auf `https://localhost:<Port>/healthz` warten

Am Ende steht die Adresse, z. B. `https://tiermodel01.contoso.com:8443/`.

## Nach der Installation

- [ ] Anmelden und unter **Konfiguration › Validierung** prüfen, dass keine Fehler angezeigt werden.
- [ ] Unter **Konfiguration** die importierte Konfiguration an die eigene Umgebung anpassen.
- [ ] Einen **Deploy im Planungsmodus** (WhatIf) starten und das Protokoll prüfen. Schlägt die Voraussetzungsprüfung
      fehl, sind Rechte oder Module des Dienstkontos zu klären ([Fehlerbehebung](betrieb.md#fehlerbehebung)).
- [ ] Weitere Benutzer anlegen (**Administration › Benutzer**) – jede Person mit eigenem Konto und passender Rolle.
- [ ] Einen **Zeitplan** für nächtliche Audits anlegen.
- [ ] Datensicherung der Datenbank einrichten ([Betrieb › Sicherung](betrieb.md#sicherung-und-wiederherstellung)).

## Installierte Struktur

```
C:\Program Files\TierModelService\
├── app\
│   ├── TierModel.Service.exe
│   ├── appsettings.json               Standardwerte (nicht ändern)
│   ├── appsettings.Production.json    Verbindungsdaten, Pfade, Port, Zertifikat  ← geschützt
│   └── wwwroot\                       Weboberfläche
├── framework\                         Skripte, Modul, config\ (Vorlage für den Erstimport)
├── Install-TierModelService.ps1
├── Setup.cmd                          für Deinstallation / Neukonfiguration
└── VERSION
C:\ProgramData\TierModelService\
├── runs\000042\                       Arbeitskopie + Berichte je Lauf (werden nach Aufbewahrungsfrist gelöscht)
└── logs\setup-*.log                   Protokolle des Assistenten
```

## Aktualisieren

1. Neues Paket entpacken (nicht über das alte Programmverzeichnis).
2. `Setup.cmd` **aus dem neuen Paket** starten → **Aktualisieren** wählen.

Der Assistent stoppt den Dienst, sichert `app\` nach `app.bak`, ersetzt Programm- und Framework-Dateien
(`appsettings.Production.json` bleibt erhalten), aktualisiert das Datenbankschema und startet den Dienst.
Antwortet der Dienst danach nicht, bietet er an, die vorherige Programmversion wiederherzustellen.

!!! warning "Datenbank vorher sichern"
    Schemaänderungen werden beim Rücksprung nicht zurückgenommen. Vor jedem Update eine Datenbanksicherung
    erstellen ([Betrieb › Sicherung](betrieb.md#sicherung-und-wiederherstellung)).

## Neu konfigurieren

`Setup.cmd` starten → **Neu konfigurieren**: Der Assistent läuft erneut vollständig durch (z. B. anderer Port,
anderes Zertifikat, anderes Dienstkonto) und registriert den Dienst neu. Daten in der Datenbank bleiben erhalten.

## Deinstallieren

`Setup.cmd` starten → **Deinstallieren** (oder `Setup.cmd -Uninstall`). Entfernt Dienst, Firewall-Regel und auf
Wunsch das Programmverzeichnis. **Datenbank und Datenverzeichnis bleiben erhalten**; bei Bedarf manuell löschen:

```sql
DROP DATABASE tiermodel;
DROP ROLE tiermodel;
```
