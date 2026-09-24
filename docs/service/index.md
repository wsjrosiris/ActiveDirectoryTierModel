# TierModel Service – Überblick

Der **TierModel Service** ist ein Windows-Dienst mit Weboberfläche. Mit ihm lässt sich das Active Directory
Tier Model dauerhaft betreiben, ohne die PowerShell-Skripte von Hand aufzurufen:

- Die **Soll-Konfiguration** (OUs, Gruppen, Konten, ACL-Delegationen, GPOs, LAPS …) liegt versioniert in
  **PostgreSQL**. Jede Änderung hat Autor, Kommentar, Diff und lässt sich wiederherstellen.
- **Deploy** und **Audit** starten per Klick. Sie laufen nacheinander in einer Warteschlange und zeigen
  ein Live-Protokoll.
- **Zeitpläne** führen Audits regelmäßig aus. Abweichungen (Drift) erscheinen im Dashboard als Trend.
- Das **Änderungsprotokoll** zeigt, wer wann was geändert, gestartet oder freigegeben hat.
- **Benutzer und Rollen** regeln, wer lesen, bearbeiten, planen oder anwenden darf.

![Dashboard](img/dashboard-light.png)

## Dokumentation

| Seite | Für wen | Inhalt |
|---|---|---|
| [Installation](installation.md) | Administratoren | Voraussetzungen, Dienstkonto vorbereiten, Installationsassistent, Aktualisieren, Deinstallieren |
| [Bedienung](bedienung.md) | alle Anwender | Rollen, Konfiguration bearbeiten, Deploy, Audit, Zeitpläne, Läufe, Änderungsprotokoll |
| [Betrieb](betrieb.md) | Betrieb | Konfigurationsdatei, Protokolle, Sicherung, Zertifikat, Passwort-Reset, Fehlerbehebung |
| [Sicherheit](sicherheit.md) | Sicherheitsverantwortliche | Bedrohungsmodell, Schutzmaßnahmen, Härtungsempfehlungen |
| [Entwicklung](entwicklung.md) | Entwickler | Architektur, lokale Umgebung, Tests, Release-Paket, Datenbankmigrationen |
| [REST-API](api.md) | Integratoren | Endpunkte, Datenmodelle, Rollen |

## Architektur

```
┌──────────────┐  HTTPS   ┌─────────────────────────────────────────────┐        ┌────────────┐
│  Browser     │ ───────► │  TierModel.Service.exe  (Windows-Dienst)    │ ─────► │ PostgreSQL │
│  (React-SPA) │ ◄─────── │  ASP.NET Core 10 · Kestrel                  │ ◄───── │            │
└──────────────┘          │                                             │        └────────────┘
                          │  REST-API · Anmeldung · Rollen · CSRF       │
                          │  RunWorker ──► pwsh.exe ──► Deploy-/Audit-  │ ─────► Active Directory
                          │                              TierModel.ps1  │        (bevorzugter DC)
                          │  ScheduleWorker (geplante Audits, Aufräumen)│
                          └─────────────────────────────────────────────┘
```

| Baustein | Aufgabe |
|---|---|
| **Weboberfläche** | React-Anwendung, die der Dienst selbst ausliefert. Braucht keinen Internetzugang (Schriften und Bibliotheken sind im Paket). |
| **REST-API** | Anmeldung per Cookie, Rollenprüfung, CSRF-Schutz. Siehe [REST-API](api.md). |
| **PostgreSQL** | Konfigurationsversionen, Läufe mit Protokollzeilen und Befunden, Zeitpläne, Änderungsprotokoll, Benutzer, Einstellungen. |
| **RunWorker** | Führt Läufe **nacheinander** aus. Änderungen am AD dürfen sich nie überschneiden. |
| **Arbeitskopie je Lauf** | Für jeden Lauf entsteht `…\runs\<Nr>\` mit den Framework-Skripten und der Konfiguration aus der Datenbank. Spätere Änderungen beeinflussen einen laufenden Deploy nicht. |
| **ScheduleWorker** | Prüft alle 30 Sekunden fällige Zeitpläne und löscht einmal täglich abgelaufene Protokolle und Arbeitskopien. |

### Ablauf eines Laufs

1. Ein Anwender startet Deploy oder Audit. Der Lauf kommt mit Status **Wartend** in die Warteschlange.
2. Der RunWorker übernimmt ihn (**Läuft**) und merkt sich die Versionen aller Konfigurationsbereiche.
3. Die Konfiguration wird validiert. Bei Fehlern startet **Anwenden** nicht.
4. Der Dienst legt die Arbeitskopie an und startet `pwsh.exe -File Deploy-TierModel.ps1 …` bzw. `Audit-TierModel.ps1`.
5. Die Ausgabe landet zeilenweise in der Datenbank. Die Oberfläche zeigt sie live.
6. Bei Audits wird der JSON-Bericht ausgewertet: Zusammenfassung, Befunde, Anzahl der Abweichungen.
7. Der Lauf endet mit **Erfolgreich**, **Fehlgeschlagen** oder **Abgebrochen**.

## Verhältnis zum Framework

Der Dienst **verändert das Framework nicht**. Er ruft dieselben Skripte auf, die man auch von Hand
verwenden kann. Zwei Unterschiede:

- Die Konfigurationsdateien kommen aus der Datenbank statt aus `config\*.json`. Beim ersten Start
  importiert der Dienst die mitgelieferten Dateien als Version 1. Über **Export** in der Oberfläche
  lassen sie sich jederzeit wieder als ZIP herausholen.
- Für **Anwenden** übergibt der Dienst `-ConfirmApply -Unattended`. Die Bestätigung erfolgt in der
  Oberfläche (Eingabe von `ANWENDEN`) statt über `Read-Host`.
