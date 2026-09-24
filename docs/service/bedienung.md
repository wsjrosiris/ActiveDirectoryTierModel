# Bedienung

Die Oberfläche ist unter `https://<server>:<port>/` erreichbar (Standard-Port 8443). Hell- und Dunkelmodus
schalten sich über das Symbol oben rechts um; Voreinstellung ist die Einstellung des Betriebssystems.

## Anmeldung und Rollen

Jede Person meldet sich mit einem **eigenen Konto** an. Konten legt ein Administrator unter
**Administration › Benutzer** an. Neue Konten und zurückgesetzte Passwörter müssen bei der nächsten Anmeldung
ein eigenes Passwort (mindestens 12 Zeichen) vergeben. Nach **5 Fehlversuchen** ist ein Konto 15 Minuten
gesperrt; ein Administrator kann es vorher entsperren.

| Rolle | Darf |
|---|---|
| **Betrachter** (Viewer) | Alles ansehen: Konfiguration, Versionen, Läufe, Protokolle, Änderungsprotokoll |
| **Bearbeiter** (Editor) | + Konfiguration ändern und Versionen wiederherstellen, Audits starten, Deploy im **Planungsmodus** |
| **Operator** | + Deploy **anwenden** (ändert das AD), Läufe abbrechen, Zeitpläne verwalten |
| **Administrator** | + Benutzer und Einstellungen verwalten |

Aktionen, die die eigene Rolle nicht erlaubt, sind ausgeblendet oder deaktiviert. Der Dienst prüft die Rolle
zusätzlich bei jedem Aufruf.

## Tastenkürzel

| Kürzel | Funktion |
|---|---|
| `Strg` + `K` | Globale Suche über OUs, Gruppen, Konten, ACLs, GPOs und Seiten |
| `Strg` + `Umschalt` + `P` | Befehlspalette (Navigation, neuer Deploy, Audit starten, Design, Abmelden) |
| `Strg` + `Z` / `Strg` + `Y` | Rückgängig / Wiederholen in der Konfiguration |
| `Strg` + `S` | Konfigurationsänderungen speichern |

## Dashboard

- **Kennzahlen**: OUs, Gruppen, Konten, ACL-Delegationen, GPOs und GPO-Verknüpfungen der aktuellen Konfiguration
- **Letztes Audit**: Status und Anzahl der Abweichungen (grün „Kein Drift“ oder rot)
- **Letzter Deploy**, **Warteschlange** und **Validierung** der Konfiguration
- **Drift-Verlauf** der letzten 30 erfolgreichen Audits
- **Letzte Läufe** und **letzte Änderungen**
- **OU-Baum** mit Tier-Farben (Tier 0 rot, Tier 1 bernstein, Tier 2 grün)

## Konfiguration

Links stehen die Bereiche, gruppiert nach *Struktur*, *Delegationen*, *Richtlinien* und *System*. Jeder Bereich
entspricht einer Datei des Frameworks (z. B. `tiermodel-groups.json`); die Versionsnummer steht neben dem Titel.

![Konfiguration](img/config-acls-light.png)

### Einträge bearbeiten

**OUs, Gruppen, Konten, ACL-Delegationen, MSA/gMSA/dMSA und Windows LAPS** werden in Tabellen mit Suche, Tier-Filter
und Sortierung angezeigt. Ein Klick auf eine Zeile öffnet das Bearbeitungsfenster; über **…** lässt sich ein Eintrag
duplizieren oder löschen. Auswahlfelder bieten die gültigen Werte an, z. B. Ziel-OUs aus der OU-Struktur und
Principals aus den konfigurierten Gruppen.

![Eintrag bearbeiten](img/config-edit-sheet-light.png)

Felder, die das Formular nicht kennt, bleiben beim Speichern unverändert erhalten.

Die übrigen Bereiche (**GPOs, ADMX, ADML, Metadaten, GUID-Zuordnungen, Abhängigkeiten**) werden im JSON-Editor
bearbeitet (Syntaxprüfung, Formatieren). Für GPOs gibt es zusätzlich eine Übersicht „OU → verknüpfte GPOs“.

### OU umbenennen

Beim Umbenennen einer OU zeigt eine Vorschau alle betroffenen Verweise: untergeordnete OUs, Gruppen- und
Kontopfade, ACL-/MSA-/gMSA-/dMSA-Ziele, LAPS-OUs und GPO-Verknüpfungen. Alle Verweise werden in einem Schritt
angepasst und lassen sich mit einem Rückgängig zurücknehmen.

### Speichern

Änderungen sind zunächst ein **Entwurf** (Leiste „Ungespeicherte Änderungen“), auch über mehrere Bereiche hinweg.
**Speichern** zeigt für jeden geänderten Bereich einen Diff und verlangt einen **Kommentar**. Jeder gespeicherte
Bereich erhält eine neue Version.

Hat jemand anderes denselben Bereich inzwischen gespeichert, erscheint ein **Konflikt**:
*Neu laden* verwirft den eigenen Entwurf, *Weiter bearbeiten* behält ihn und speichert anschließend auf Basis der
neuesten Version.

### Versionen

**Versionen** zeigt alle Stände eines Bereichs mit Autor, Zeit und Kommentar. Jede Version lässt sich mit dem
aktuellen Stand vergleichen (einheitlich oder nebeneinander) und **wiederherstellen** – das erzeugt eine neue
Version, es geht nichts verloren.

### Validierung und Export

**Validierung** prüft die Querverweise der gespeicherten Konfiguration:

| Schwere | Beispiele |
|---|---|
| Fehler | übergeordnete OU fehlt, OU doppelt, `samaccountname` doppelt, ACL ohne Rechte |
| Warnung | Ziel-OU oder Principal nicht in der Konfiguration (kann im AD existieren), unbekannte LAPS-Gruppe |

Solange **Fehler** bestehen, startet kein Deploy im Modus *Anwenden*.
**Export** lädt alle Bereiche als ZIP im Format des Frameworks herunter (`config\*.json` + `versions.json`).

## Deploy

![Deploy](img/deploy-light.png)

1. **Modus** wählen:
    - **Planen (WhatIf)** zeigt, was sich ändern würde, ohne das AD zu verändern.
    - **Anwenden** führt die Änderungen aus. Nur für Operatoren.
2. **Domain Controller** (vorbelegt aus den Einstellungen) und optional die **ADML-Sprache**.
3. **Bereich**: Vollständig oder nur OUs / Gruppen / Konten / GPOs / OU-ACLs / ADMX.
4. **Add-ons**: MSA, gMSA, dMSA, Windows LAPS. „Kein Bereich“ ist möglich, wenn mindestens ein Add-on gewählt ist.
5. Starten. Beim Anwenden muss zur Bestätigung `ANWENDEN` eingegeben werden.

Anschließend öffnet sich der Lauf mit Live-Protokoll.

!!! tip "Empfohlenes Vorgehen"
    Immer zuerst planen, das Protokoll prüfen und erst dann mit denselben Parametern anwenden.

## Audits und Zeitpläne

Unter **Audits** startet man ein Audit sofort (gleiche Parameter wie beim Deploy, ohne Modus) und sieht die
bisherigen Audits mit Anzahl der Abweichungen.

**Zeitpläne** führen Audits automatisch aus:

| Feld | Beispiel |
|---|---|
| Name | „Nächtliches Audit“ |
| Zeitplan | Vorlagen wie „Täglich 02:00“ oder eigener Cron-Ausdruck (`Minute Stunde Tag Monat Wochentag`), z. B. `0 6 * * 1` = montags 06:00 |
| Zeitzone | Standard `Europe/Berlin` (Sommer-/Winterzeit wird berücksichtigt) |
| Parameter | DC, Bereich, Add-ons |

Läuft der vorherige Lauf eines Zeitplans noch, wird der nächste Termin übersprungen. **Jetzt ausführen** startet
einen Zeitplan sofort.

![Zeitpläne](img/schedules-light.png)

## Läufe

Die Liste zeigt alle Deploys und Audits mit Status, Auslöser, Dauer und Ergebnis und lässt sich nach Art und Status filtern.

| Status | Bedeutung |
|---|---|
| Wartend | in der Warteschlange – Läufe werden nacheinander ausgeführt |
| Läuft | PowerShell arbeitet |
| Erfolgreich | Skript mit Code 0 beendet (ein Audit mit Abweichungen ist trotzdem erfolgreich) |
| Fehlgeschlagen | Skript mit Fehlercode beendet, Validierungsfehler, Zeitüberschreitung oder Dienst-Neustart |
| Abgebrochen | durch einen Operator abgebrochen |

Die Detailseite eines Laufs enthält:

- **Protokoll**: Live-Ausgabe mit Zeitstempel, farbig nach Fehler/Warnung/Erfolg, Filter, „Nur Probleme“,
  Kopieren und Herunterladen. „Folgen“ scrollt automatisch mit.
- **Befunde** (Audits): Zusammenfassung (geprüft, Abweichungen, fehlend, unerwartet, abweichend, verwaiste
  GPO-Links, Sicherheitsabweichungen) und filterbare Befundliste.
- **Konfiguration**: welche Version jedes Bereichs der Lauf verwendet hat.
- **Abbrechen** (Operator): beendet den PowerShell-Prozess samt Unterprozessen.

![Lauf](img/run-log-light.png)

## Änderungsprotokoll

Chronologisch nach Tagen: Konfigurationsänderungen (mit Versionssprung und Kommentar), gestartete und abgebrochene
Läufe, Zeitpläne, Benutzerverwaltung, Einstellungen sowie An- und fehlgeschlagene Abmeldungen. Filterbar nach Art;
Details lassen sich aufklappen.

## Administration

**Benutzer**: anlegen (mit Passwortgenerator), Anzeigename, Rolle und Aktiv-Status ändern, Passwort zurücksetzen,
entsperren, löschen. Das eigene Konto kann weder gelöscht noch herabgestuft werden, und der letzte aktive
Administrator bleibt immer erhalten. Änderungen an Rolle, Status oder Passwort beenden die Sitzungen des
betroffenen Kontos sofort.

**Einstellungen**:

| Einstellung | Bedeutung |
|---|---|
| Standard-Domain-Controller | Vorbelegung in Deploy, Audit und Zeitplänen |
| ADML-Sprache | Standard für `-AdmlLanguage` |
| Aufbewahrung von Läufen (Tage) | Protokollzeilen und Arbeitsverzeichnisse älterer Läufe werden gelöscht; Status, Ergebnis und Befunde bleiben. `0` = unbegrenzt |

Framework- und PowerShell-Pfad werden angezeigt, sind aber nur in der Dienstkonfiguration änderbar
([Betrieb](betrieb.md#konfigurationsdatei)).
