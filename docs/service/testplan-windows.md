# Testplan für eine echte Domäne

Die Entwicklungsumgebung ist Linux ohne Active Directory. Alles, was das AD liest oder ändert, ist dort nur mit
Mocks (Pester), einem Fake-`pwsh` und einem Fake-Verzeichnis getestet. Dieser Plan listet, was vor dem produktiven
Einsatz auf Windows in einer **Testdomäne** geprüft werden muss – am besten zweimal: in einer englischen und in einer
**deutschen** Domäne (übersetzte Gruppennamen wie „Domänen-Admins“).

!!! warning "Nur in einer Testdomäne"
    Mehrere Schritte ändern das AD (Deploy *Anwenden*, Authentication Silos, JIT). Nie zuerst in Produktion.

Jeder Punkt: **Schritte** → **Erwartung**. Abweichungen bitte mit Protokoll des Laufs (Seite *Läufe*) und
Ereignisanzeige (Quelle `TierModel.Service`) festhalten.

## Umgebung

| | |
|---|---|
| Domänencontroller | Windows Server 2022/2025, Gesamtstrukturebene 2016 (für JIT), eine Kind-Domäne für Punkt 3.4 |
| Dienst-Server | Windows Server, Mitglied der Domäne, PowerShell 7, RSAT-AD |
| Dienstkonto | gMSA, Mitglied von *Domänen-Admins* der Testdomäne |
| Clients | PAW mit Browser; ein zweites Operator-Konto für Vier-Augen-Tests |

## 1 Installation und Betrieb

| Nr. | Schritte | Erwartung |
|---|---|---|
| 1.1 | Release-Paket bauen (`service/build/Build-Release.ps1`), `Setup.cmd` ausführen, lokale PostgreSQL-Installation wählen | Dienst läuft, Oberfläche per HTTPS erreichbar, erster Admin kann sich anmelden |
| 1.2 | Setup erneut mit vorhandenem PostgreSQL-Server | Datenbank und Benutzer werden angelegt, Passwort nicht auf der Kommandozeile sichtbar (Prozessliste) |
| 1.3 | gMSA als Dienstkonto, Warnung bei fehlender *Domänen-Admins*-Mitgliedschaft | Recht „Anmelden als Dienst“ gesetzt; Warnung erscheint, wenn die Gruppe fehlt |
| 1.4 | *Systemzustand* öffnen | Zertifikat aus `LocalMachine\My` mit Ablaufdatum, Plattenplatz des Arbeitsverzeichnisses, PowerShell-Version, alle Hintergrunddienste aktiv |
| 1.5 | Aktualisieren und Deinstallieren über `Setup.cmd` | Update mit Rollback bei Fehler; Deinstallation lässt die Datenbank stehen |

## 2 Anmeldung

| Nr. | Schritte | Erwartung |
|---|---|---|
| 2.1 | Windows-Anmeldung aktivieren, AD-Gruppen je Rolle zuordnen (Suche im Formular) | AD-Gruppensuche liefert Treffer; Anmeldung ohne Passwortabfrage (Kerberos, SPN `HTTP/<fqdn>`) |
| 2.2 | Benutzer ohne passende Gruppe meldet sich an | Abgelehnt mit Hinweis |
| 2.3 | Entra-ID-Anmeldung mit App-Registrierung und Gruppen-Anspruch | „Mit Microsoft anmelden“, Konto wird angelegt, Rolle aus Gruppe; Conditional Access (MFA) greift |
| 2.4 | API-Token anlegen, `Connect-TierModelService` + `Start-TierModelAudit … | Wait-TierModelRun` | Audit läuft, Token-Nutzung erscheint unter *API-Tokens* |

## 3 Framework gegen das AD

| Nr. | Schritte | Erwartung |
|---|---|---|
| 3.1 | **Deutsche Domäne:** Planung *Vollständig* | Voraussetzungsprüfung besteht (Domain-Admins über SID 512); keine Warnung „Skipping in URA“; *Geplante Änderungen* zeigt alle Phasen |
| 3.2 | Planung anwenden (mit Vier-Augen-Freigabe durch das zweite Konto) | Deploy läuft; GPOs enthalten die Benutzerrechte mit den **deutschen** Gruppen (Gruppenrichtlinienverwaltung prüfen); Deny-Apply für Domänencontroller gesetzt |
| 3.3 | Audit *Vollständig* | Bericht enthält Befunde aller Bereiche, Zusammenfassung ungleich 0 bei Abweichungen; nach dem Deploy „Keine Abweichungen“ |
| 3.4 | Planung in der **Kind-Domäne** | Organisations-/Schema-Admins über die SID der Stammdomäne aufgelöst |
| 3.5 | Windows LAPS mit deutschen Gruppennamen (`readGroup`: Domain Admins) | Keine Planfehler, Rechte korrekt |
| 3.6 | Absichtlich eine OU löschen und eine ACL hinzufügen, Audit, dann *Planung für diesen Bereich starten* | Befunde mit Bereich/Schweregrad; Behebungs-Planung nur für den Bereich |

## 4 Überwachung privilegierter Zugriffe

| Nr. | Schritte | Erwartung |
|---|---|---|
| 4.1 | *Jetzt prüfen* | Alle geschützten Gruppen mit deutschen Namen, verschachtelte Mitglieder mit „über …“ |
| 4.2 | Testkonto zu *Sicherungs-Operatoren* hinzufügen, erneut prüfen | „Nicht erwartet“, Eintrag unter *Änderungen*, Benachrichtigung *Privilegierte Zugriffe* |
| 4.3 | Einer Nicht-Tier-0-Gruppe `WriteDacl` auf *Domänen-Admins* geben | Angriffspfad mit Mitgliedern der Gruppe |
| 4.4 | Konto mit SPN in einer Admin-Gruppe, Konto ohne *Protected Users* | Hygiene-Befunde mit Schweregrad Hoch bzw. Mittel |
| 4.5 | Dienstkonto **ohne** Admin-Rechte (nur Leserechte) | Snapshot entsteht; nicht lesbare ACLs erscheinen als Fehlerhinweis, nicht als Abbruch |

## 5 Erweiterungen

| Nr. | Schritte | Erwartung |
|---|---|---|
| 5.1 | **Authentication Silos:** Richtlinie mit Gerätegruppen, *Erzwingen* aus, Deploy *Nur Authentication Silos* | Richtlinie und Silo existieren; `UserAllowedToAuthenticateFrom` wird von Windows akzeptiert (`Get-ADAuthenticationPolicy`); Ereignisse 105/305 im Überwachungsmodus |
| 5.2 | Anmeldung eines Tier-0-Kontos von einem nicht erlaubten Gerät nach *Erzwingen* | Anmeldung abgelehnt; von PAW erlaubt |
| 5.3 | **JIT:** PAM-Feature (nur Testgesamtstruktur!) aktivieren, *Voraussetzungen prüfen* | „bereit“ |
| 5.4 | Zugriff 15 Minuten beantragen, zweites Konto gibt frei | Mitgliedschaft mit TTL (`Get-ADGroup -Properties member -ShowMemberTimeToLive`); Überwachung zeigt „Erwartet (JIT bis …)“; nach Ablauf entfernt |
| 5.5 | **Ist-Ansicht:** *Organisationseinheiten › Vergleich* | AD-Baum stimmt; zusätzliche Standard-ACEs (LAPS, DC) erzeugen keine falschen „abweichend“-Markierungen |
| 5.6 | **Einrichtungsassistent** in einer neuen Instanz | Domäne, DCs und Funktionsebene erkannt; vorhandene OUs übernehmbar |

## 6 Integration

| Nr. | Schritte | Erwartung |
|---|---|---|
| 6.1 | Syslog/CEF an den SIEM-Collector (TCP+TLS) | Ereignisse in `CommonSecurityLog`; Test-Nachricht kommt an |
| 6.2 | Log Analytics mit DCE/DCR | Einträge in `TierModel_CL` |
| 6.3 | Git-Repository per **https** (z. B. Azure DevOps) | Commit je gespeicherter Version, Autor und Kommentar korrekt; Konflikt nach manueller Änderung im Repo → *Remote übernehmen* |
| 6.4 | Import aus einer zweiten Instanz (Test → Produktion) per API-Token | Vorschau, Übernahme ausgewählter Bereiche |
| 6.5 | Bericht *Soll/Ist* als PDF | Umlaute und Schrift (Segoe UI/Arial) korrekt |
| 6.6 | Wartungsfenster Mo–Fr 18–20 Uhr, *Anwenden* außerhalb | Status *Geplant für …*, Start zu Fensterbeginn; über die Sommer-/Winterzeitumstellung korrekt |
| 6.7 | Zertifikat mit < 30 Tagen Laufzeit | Tägliche Benachrichtigung *Zertifikat* |

## Ergebnis

| Bereich | Englische Domäne | Deutsche Domäne | Bemerkung |
|---|---|---|---|
| 1 Installation | | | |
| 2 Anmeldung | | | |
| 3 Framework | | | |
| 4 Überwachung | | | |
| 5 Erweiterungen | | | |
| 6 Integration | | | |
