# Roadmap

!!! success "Stand"
    Alle 25 Punkte sind umgesetzt. Was nur mit simuliertem AD getestet werden konnte, listet der
    [Testplan für eine echte Domäne](testplan-windows.md).

Umsetzungsplan für die Funktionen aus dem zweiten Brainstorming. Die Nummern (1–25) entsprechen dem Brainstorming;
die Reihenfolge ergibt sich aus den Abhängigkeiten, nicht aus der Nummer.

!!! note "Test-Grenzen"
    Alles, was das echte Active Directory liest oder ändert, lässt sich in der Linux-Entwicklungsumgebung nur mit
    Pester-Mocks und dem Fake-`pwsh` des Dienstes prüfen. Jede Phase endet deshalb mit einer Checkliste für einen
    Test auf einem Domain Controller (Englisch **und** Deutsch).

## Überblick

| Phase | Inhalt | Punkte |
|---|---|---|
| 0 | Grundlagen im Framework: Audit-Bericht korrigieren, Plan als JSON | – |
| 1 | Deutsche Domänen, sicherer Deploy, Tier-Regeln, Health | 1, 2, 3, 13, 21 |
| 2 | Überwachung privilegierter Zugriffe, Behebung, Compliance-Wert | 7, 8, 9, 5, 24 |
| 3 | Arbeitshilfen und Ist-Ansicht | 11, 12, 14, 10 |
| 4 | Betrieb, Integration, Nachweise | 4, 18, 19, 20, 22, 23, 25 |
| 5 | Umgebungen und befristeter Zugriff | 15, 16, 6, 17 |

## Phase 0 – Grundlagen

Mehrere Punkte bauen auf maschinenlesbaren Ergebnissen des Frameworks auf. Die Analyse hat dabei zwei Fehler gezeigt.

**0.1 Audit-Bericht bei `-FullDeployment` korrigieren** (`Audit-TierModel.ps1`)

- `$driftFindings` wird in der Schleife über die Objekttypen jedes Mal neu angelegt; im JSON landen nur die Befunde des
  letzten Typs. `auditSummary` bleibt bei 0.
- Behebung: Befunde über alle Typen sammeln, Zusammenfassung aus den Befunden berechnen.
- Befunde bekommen zusätzlich `area` (ous, groups, users, acls, gpos, admx, msa, …) und `severity`
  (`High` für Tier-0-Objekte, sonst `Medium`/`Low`); vorhandene Felder bleiben unverändert (Abwärtskompatibilität).
- Pester-Tests für Zusammenführung und Zusammenfassung.

**0.2 Plan als JSON** (`Deploy-TierModel.ps1`)

- Neuer Parameter `-PlanOutputPath` (bzw. automatisch `<LogPath>/<OutputFileBase>-plan.json`, wenn `-Logging` aktiv ist).
- Inhalt: die schon vorhandenen Plan-Objekte `{Action, ResourceType, Name, Path, Data}` aller Phasen, dazu
  `phases`, `summary` (create/update/link/configure/existing) und `metadata` (Scope, DC, Konfigurations-Hash, Zeit).
- `Data` wird auf einfache Werte reduziert (keine AD-Objekte, keine Geheimnisse).
- Ohne den Parameter bleibt das Verhalten wie bisher.

**0.3 `Resolve-ADPrincipalSid`** bekommt `-DomainController` explizit statt über die Variable des Aufrufers.

## Phase 1

### 1 – Domänen mit übersetzten Gruppennamen

Ziel: Deploy und Audit laufen in Domänen, deren eingebaute Gruppen z. B. „Domänen-Admins“ heißen.

- **Tabelle der festen SIDs/RIDs** im Modul (`Get-TierModelWellKnownPrincipal`): domänenrelative RIDs
  (500 Administrator, 512 Domain Admins, 513 Domain Users, 514 Domain Guests, 515 Domain Computers,
  516 Domain Controllers, 517 Cert Publishers, 518 Schema Admins, 519 Enterprise Admins, 520 Group Policy Creator Owners,
  521 Read-only Domain Controllers, 522 Cloneable Domain Controllers, 525 Protected Users, 526 Key Admins,
  527 Enterprise Key Admins, 498 Enterprise Read-only Domain Controllers) und die BUILTIN-SIDs (S-1-5-32-5xx).
  Schema Admins, Enterprise Admins, Enterprise Key Admins und Enterprise RODCs werden mit der SID der
  **Stammdomäne** gebildet – das behebt nebenbei das Problem in untergeordneten Domänen.
- `Resolve-TierModelPrincipalSid`: englischer Name → Tabelle → SID, erst danach die Namenssuche im AD. Die
  Konfiguration bleibt damit englisch und funktioniert in jeder Sprache.
- Alle Stellen, die per Name suchen, auf diese Auflösung umstellen:
  `Test-TierModelPrerequisites` (Domain-Admins-Prüfung – derzeit harter Abbruch), `New-TierModelGpo`
  (`denyApplyGroupPolicy`), `Get-/Test-TierModelWinLapsAcl` (`readGroup`/`resetGroup`, Ausnahmeliste),
  `New-TierModelGptTmplContent` (`resolvableGroups`, `forestRootOnly`).
- Vergleiche im Audit über SIDs statt über Namen.
- Die ungenutzte Sprachermittlung in `Test-TierModelPrerequisites` wird zur reinen Information im Bericht.
- README: Einschränkung „übersetzte Gruppennamen nicht unterstützt“ entfernen.
- Tests: Pester mit gemockten deutschen und französischen Gruppennamen.

### 2 – Lesbarer Planungslauf

- Dienst liest nach einem Planungslauf `deploy-plan.json` (Phase 0.2) und speichert es am Lauf (`Run.Plan`, jsonb,
  neue Migration).
- Laufdetails: Tab **Geplante Änderungen** – gruppiert nach Phase, je Aktion ein Satz („OU *Tier 1 Servers* wird unter
  *Tier 1* angelegt“, „Gruppe … wird Mitglied von …“), Filter nach Typ, Zähler je Aktionsart.
- Freigabe (Vier-Augen): Die freigebende Person sieht dieselbe Liste für den zugrunde liegenden Planungslauf.
- Benachrichtigung „Freigabe angefordert“ enthält die Zähler.

### 3 – Anwenden nur nach geprüfter Planung

- Einstellung `requirePlanBeforeApply` (Standard: an).
- „Anwenden“ verlangt die ID eines erfolgreichen Planungslaufs mit **denselben Konfigurationsversionen, Bereich und DC**
  und höchstens *N* Stunden alt (Einstellung `planMaxAgeHours`, Standard 24).
- Anwenden-Lauf übernimmt die Versionen des Planungslaufs (wie bei der Freigabe) und verweist auf ihn (`Run.PlanRunId`).
- UI: Deploy-Seite bietet „Anwenden“ direkt aus dem Ergebnis eines Planungslaufs an; ohne passenden Plan ist der Knopf
  gesperrt, mit Begründung.

### 13 – Tier-Regeln prüfen

Neue Regeln im `ConfigValidator` (laufen bei jeder Validierung und beim Speichern):

- ACL-Delegation: Principal aus einem niedrigeren Tier erhält Rechte auf eine OU eines höheren Tiers → **Fehler**.
- Gruppenmitgliedschaft über Tier-Grenzen (Tier-2-Gruppe in Tier-0-Gruppe) → Fehler.
- Konto aus Tier *n* in Gruppe aus Tier *m ≠ n* → Warnung.
- GPO-Verknüpfung einer Tier-0-GPO auf Tier-1/2-OU → Warnung.
- Tier eines Objekts wird aus seinem OU-Pfad bzw. dem Tier-Feld der Gruppe abgeleitet.
- Die Formulare zeigen die Meldungen direkt am Eintrag.

### 21 – Health-Seite

- `GET /api/health/details` (Admin): Version, Laufzeit, Zertifikat (Ablaufdatum, Warnung < 30 Tage), Datenbank
  (Größe, Version, Migrationen), Warteschlange, letzte erfolgreiche Läufe, Arbeitsverzeichnis (Plattenplatz),
  PowerShell-Version, Framework-Pfad, Worker-Zustand.
- Seite **Administration › Systemzustand** mit Ampel je Punkt.
- Benachrichtigung bei Zertifikatsablauf (neues Ereignis `CertificateExpiring`, täglich geprüft).

## Phase 2 – Überwachung privilegierter Zugriffe

### 7 – Tier-0-Mitgliedschaften überwachen

- Neuer Lauftyp **Überwachung** (`RunKind.Monitor`), eigenes Skript `Watch-TierModelPrivilegedGroups.ps1` im
  Framework: liest Mitglieder (rekursiv) der geschützten Gruppen (per SID aus Phase 1) plus aller Tier-0-Gruppen
  aus der Konfiguration, Ausgabe JSON.
- Dienst speichert je Lauf eine Momentaufnahme (`PrivilegedSnapshot`), vergleicht mit der vorherigen und mit der
  Soll-Konfiguration: *neu*, *entfernt*, *nicht in der Konfiguration*.
- Zeitplan wie bei Audits (Standard alle 15 Minuten), Benachrichtigung `PrivilegedChange`.
- Seite **Privilegierte Gruppen**: Mitglieder je Gruppe, Verlauf der Änderungen.

### 8 – Hygiene-Prüfungen für Admin-Konten

Im selben Skript bzw. als zusätzlicher Abschnitt, je Konto in Tier-0/1-Gruppen:

- nicht in *Protected Users*, `AccountNotDelegated` nicht gesetzt, Passwort älter als *N* Tage,
  letzte Anmeldung älter als *N* Tage, SPN gesetzt (Kerberoasting), `PasswordNeverExpires`, `adminCount` verwaist
  (Konto nicht mehr privilegiert, aber noch mit `adminCount=1`), Konto deaktiviert, aber noch Mitglied.
- Schwellwerte in den Einstellungen; Befunde mit Schweregrad; eigene Liste auf der Seite aus Punkt 7.

### 9 – Angriffspfade zu Tier 0

- Skript liest die ACLs der Tier-0-Objekte (Tier-0-OUs, geschützte Gruppen, AdminSDHolder, Domänenstamm, GPOs auf
  Tier-0-OUs) und meldet Principals mit `GenericAll`, `GenericWrite`, `WriteDacl`, `WriteOwner`, `Owner`,
  `AllExtendedRights`, `Self-Membership` bzw. Schreibrecht auf `member`, die **nicht** Tier-0 sind und **nicht** in der
  Soll-Konfiguration stehen.
- Erste Stufe: direkte Rechte (ein Schritt). Zweite Stufe: Pfade über Gruppenmitgliedschaft (Graph im Dienst,
  Breitensuche bis Tiefe 3).
- Ergebnis als Befundliste mit Pfad („A ist Mitglied von B, B hat WriteDacl auf Domain Admins“).

### 5 – Behebung per Klick

- Audit-Befunde tragen `area` (Phase 0.1). Laufdetails: je Befund bzw. je Bereich **Planung für diesen Bereich
  starten** → Planungslauf mit passendem Scope (`OuOnly`, `GroupOnly`, …), danach über Punkt 3 anwenden.

### 24 – Compliance-Wert

- Wert 0–100 je Tier, berechnet im Dienst aus: Drift des letzten Audits, Hygiene-Befunden, Angriffspfaden,
  nicht erwarteten Mitgliedern; Gewichte dokumentiert.
- Dashboard-Kachel je Tier mit Verlauf (30 Tage) und Aufschlüsselung.

## Phase 3 – Arbeitshilfen

### 11 – Assistenten für typische Aufgaben

Geführte Dialoge, die mehrere Bereiche in **einem** Entwurf ändern (bestehender Draft-Store, ein Speichern):

- *Neuen Server-Bereich in Tier 1/2 aufnehmen*: OU, Admin-Gruppe, ACL-Delegation, GPO-Verknüpfung.
- *Neues Admin-Konto*: Konto im richtigen Tier-OU, Gruppenmitgliedschaften, Hinweis auf Protected Users.
- *Neue Delegation*: Wer darf was auf welche OU – mit Tier-Regeln aus Punkt 13.

### 12 – Einrichtungsassistent

- Beim ersten Start (leere bzw. Beispiel-Konfiguration): Domäne erkennen, Namenspräfix wählen, vorgeschlagene
  Tier-Struktur anzeigen, vorhandene OUs aus dem AD übernehmen (Windows), ersten Planungslauf starten.

### 14 – Ist-Ansicht des AD

- `GET /api/ad/tree` und `/api/ad/object` (Windows, nur lesend, begrenzt): OU-Baum, Gruppenmitglieder, ACEs.
- Konfigurationsseite: Umschalter **Soll | Ist | Vergleich**; im Vergleich farbig: fehlt im AD, nur im AD, abweichend.

### 10 – Authentication Silos und PAWs

- Neuer Konfigurationsbereich `authsilos` (Richtlinien, Silos, TGT-Lebensdauer, erlaubte Geräte-Gruppen, Mitglieder
  per OU) mit Formular; Framework-Skript aus `optional/TierModel-AuthSilos` config-gesteuert machen, echte
  `AuthenticationPolicySilo`-Objekte anlegen, SDDL-Fehler (`&&` statt `||`) korrigieren.
- Deploy-Scope `AuthSilosOnly`, Audit-Prüfung dazu.

## Phase 4 – Betrieb, Integration, Nachweise

### 4 – Wartungsfenster und Sperrzeiten

- Tabelle `MaintenanceWindow` (Wochentage, Uhrzeit von/bis, Zeitzone) und `FreezePeriod` (Datum von/bis, Grund).
- Anwenden außerhalb eines Fensters → Status `Scheduled` mit Startzeit; ScheduleWorker startet ihn. Sperrzeit → Ablehnung.
- Admin-Seite **Wartungsfenster**.

### 18 – API-Tokens und PowerShell-Modul

- Tabelle `ApiToken` (Name, Hash, Rolle ≤ Rolle des Erstellers, Ablauf, zuletzt benutzt). Authentifizierung per
  `Authorization: Bearer`, kein CSRF für Token-Anfragen, Rate-Limit.
- Profilseite: Tokens anlegen/widerrufen (Token wird nur einmal angezeigt).
- Modul `TierModel.Service.Client` (`Connect-TierModelService`, `Start-TierModelAudit`, `Get-TierModelRun`,
  `Wait-TierModelRun`, …).

### 19 – SIEM-Anbindung

- Neue Kanalart **Syslog** (RFC 5424 über TCP/TLS oder UDP, CEF-Format) und **Log Analytics** (Logs Ingestion API,
  DCR) für Änderungsprotokoll, Befunde und Ereignisse aus Phase 2.
- Doku: Zuordnung zu den vorhandenen Sentinel-Regeln unter `optional/TIerModel-Sentinel`.

### 20 – Anmeldung mit Entra ID

- OpenID Connect (Authorization Code + PKCE), Rollen über Gruppen-IDs oder App-Rollen, wie bei der
  Windows-Anmeldung konfigurierbar; Client-Secret verschlüsselt gespeichert.

### 22 – Berichte als PDF

- Berichte: *Soll/Ist* (letztes Audit), *Änderungen im Zeitraum* (Konfiguration, Läufe, Freigaben),
  *Privilegierte Zugriffe* (Phase 2).
- Erzeugung serverseitig mit QuestPDF (MIT-kompatible Community-Lizenz prüfen) oder als druckoptimierte HTML-Seite;
  geplanter Versand per E-Mail.

### 23 – Manipulationssicheres Änderungsprotokoll

- Spalte `Hash` = SHA-256(vorheriger Hash + kanonischer Eintrag); Einträge werden in einer Transaktion mit Sperre
  geschrieben.
- Prüfung `GET /api/changelog/verify` und Anzeige auf der Health-Seite; regelmäßiger Export des Ketten-Endes
  (z. B. in die Benachrichtigung), damit auch ein kompletter Austausch auffällt.

### 25 – Oberfläche auf Englisch

- i18n mit `i18next`: alle Texte in `de.json`/`en.json`, Sprache je Benutzer (Profil) mit Browser-Standard;
  Backend-Meldungen mit Fehlercodes, Text im Frontend.
- Schrittweise je Seite; Prüfung auf fehlende Schlüssel im Build.

## Phase 5 – Umgebungen und befristeter Zugriff

### 15 – Test → Produktion

- Import einer Export-ZIP oder direkt von einer anderen Instanz (API-Token aus Punkt 18); Vorschau als Änderungsliste
  je Bereich; Übernahme als neue Versionen mit Kommentar.

### 16 – Git-Anbindung

- Einstellung: Repository-URL, Branch, Zugangsdaten (verschlüsselt). Jede gespeicherte Version wird als Commit
  geschrieben (Autor = Benutzer, Nachricht = Kommentar); Hintergrund-Worker mit Wiederholung.

### 6 – Befristeter Admin-Zugriff (Just-in-Time)

- Voraussetzung: *Privileged Access Management Feature* der Gesamtstruktur (nicht rückgängig zu machen) –
  der Dienst prüft und erklärt das, schaltet es aber nicht selbst ein.
- Anträge: Gruppe (nur freigegebene JIT-Gruppen), Dauer (max. je Gruppe), Begründung; Freigabe nach Vier-Augen-Regel;
  Ausführung per `Add-ADGroupMember -MemberTimeToLive`; Liste aktiver Zugriffe mit vorzeitigem Entzug.
- Protokoll und Benachrichtigung; Überwachung (Punkt 7) erkennt JIT-Mitglieder als erwartet.

### 17 – Mehrere Domänen oder Gesamtstrukturen

- Größter Umbau, daher zuletzt: Entität `Domain` (Name, DC, Dienstkonto); Konfiguration, Läufe, Zeitpläne,
  Überwachung je Domäne; Domänen-Umschalter in der Oberfläche.
- Vorbereitung ab Phase 2: neue Tabellen bekommen bereits eine `DomainId` (Standard: 1).

## Umsetzungsstand

| Punkt | Stand |
|---|---|
| Phase 0 (Audit-Bericht, Plan als JSON, `Resolve-ADPrincipalSid`) | umgesetzt |
| 1 Übersetzte Gruppennamen | umgesetzt (Test auf echtem DC ausstehend) |
| 2 Lesbarer Planungslauf | umgesetzt |
| 3 Anwenden nur nach Planung | umgesetzt |
| 13 Tier-Regeln | umgesetzt |
| 21 Systemzustand | umgesetzt |
| 7 Tier-0-Mitgliedschaften überwachen | umgesetzt |
| 8 Hygiene-Prüfungen | umgesetzt |
| 9 Angriffspfade (direkte Rechte + Mitglieder der berechtigten Gruppe) | umgesetzt |
| 5 Behebung per Klick | umgesetzt |
| 24 Compliance-Wert | umgesetzt |
| 10 Authentication Silos | umgesetzt (Framework + Formular) |
| 11 Assistenten | umgesetzt |
| 12 Einrichtungsassistent | umgesetzt |
| 14 Ist-Ansicht des AD | umgesetzt für OUs (ACL-/GPO-Bereiche ohne Vergleichsmarken) |
| 4 Wartungsfenster und Sperrzeiten | umgesetzt |
| 18 API-Tokens und PowerShell-Modul | umgesetzt |
| 19 SIEM (Syslog/CEF, Log Analytics) | umgesetzt |
| 20 Entra-ID-Anmeldung | umgesetzt (ohne echten Mandanten getestet) |
| 22 Berichte (PDF/HTML, E-Mail-Versand) | umgesetzt |
| 23 Manipulationssicheres Änderungsprotokoll | umgesetzt |
| 25 Oberfläche auf Englisch | umgesetzt |
| 15 Import (Test → Produktion) | umgesetzt |
| 16 Git-Anbindung | umgesetzt (https gegen echten Server ungetestet) |
| 6 Befristeter Zugriff (JIT) | umgesetzt (ohne echtes PAM getestet) |
| 17 Mehrere Domänen | umgesetzt (ein Dienstkonto für alle Domänen) |
