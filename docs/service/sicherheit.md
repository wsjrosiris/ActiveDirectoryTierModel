# Sicherheit

## Einstufung

Der TierModel Service ändert OUs, Gruppen, ACLs und GPOs der Tier-0-Ebene mit einem Konto, das Mitglied von
*Domain Admins* ist. Wer den Dienst, seinen Server oder seine Datenbank kontrolliert, kontrolliert die Domäne.
Deshalb gilt:

- Der Server ist ein **Tier-0-System** und liegt in der Tier-0-OU (z. B. *Tier 0 Member Servers*).
- Anmelden dürfen sich dort nur Tier-0-Administratoren, idealerweise von einer Tier-0-PAW.
- Die **Datenbank** ist ebenfalls Tier 0: Wer Konfiguration oder Benutzer in der Datenbank ändern kann, kann
  AD-Änderungen herbeiführen. Eine lokale PostgreSQL-Instanz nur an `localhost` (Standard der lokalen Installation)
  ist die einfachste sichere Variante. Ein gemeinsam genutzter Datenbankserver muss dieselbe Schutzstufe haben.
- Die Weboberfläche nur aus dem Tier-0-Verwaltungsnetz erreichbar machen (Firewall-Regel mit Quelladressen).

## Schutzmaßnahmen im Dienst

| Bereich | Maßnahme |
|---|---|
| Transport | Nur HTTPS, HSTS; Zertifikat aus dem Windows-Zertifikatspeicher, privater Schlüssel nicht exportierbar |
| Anmeldung | Eigene Konten, Passwörter mit PBKDF2 gehasht (ASP.NET Core Identity), mindestens 12 Zeichen, Sperre nach 5 Fehlversuchen für 15 Minuten, Rate-Limit 10 Anmeldungen/Minute je IP, Antwortzeit unabhängig davon, ob das Konto existiert |
| Sitzungen | Cookie `HttpOnly`, `Secure`, `SameSite=Strict`, 8 Stunden gleitend; wird bei Deaktivierung, Löschung, Rollen- oder Passwortänderung sofort ungültig |
| CSRF | Antiforgery-Token (Cookie `XSRF-TOKEN` → Header `X-XSRF-TOKEN`) für jeden schreibenden Aufruf, an die angemeldete Identität gebunden |
| Berechtigungen | Rollenprüfung serverseitig an jedem Endpunkt; *Anwenden* nur für Operatoren; der letzte Administrator kann nicht entfernt werden |
| Browser | Content-Security-Policy ohne Inline-Skripte, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, API-Antworten `no-store` |
| Prozessstart | PowerShell wird ohne Shell mit Argumentliste gestartet; DC-Name und Sprache werden per Regex geprüft, bevor sie Argumente werden; stdin ist geschlossen, damit unerwartete Rückfragen nicht hängen |
| Dateien | Konfigurationsdateinamen stammen aus einem festen Katalog – keine Pfadangaben aus Anfragen |
| Nachvollziehbarkeit | Jede Konfigurationsänderung mit Autor, Kommentar und Diff; Änderungsprotokoll für Läufe, Benutzer, Zeitpläne, Einstellungen und Anmeldungen; jeder Lauf speichert die verwendeten Konfigurationsversionen |
| Geheimnisse | Datenbankpasswort nur in `appsettings.Production.json` (ACL: SYSTEM, Administratoren, Dienstkonto); Installer übergibt Passwörter über stdin, nie auf der Kommandozeile; das Superuser-Passwort der lokalen PostgreSQL-Installation wird über eine temporäre, ACL-geschützte Optionsdatei übergeben und danach gelöscht |

## Härtungsempfehlungen

- [ ] Dienstkonto als **gMSA**, nur das Computerkonto des Dienst-Servers darf das Passwort abrufen.
- [ ] Anmeldung des Dienstkontos auf den Dienst-Server beschränken (Benutzerrecht „Anmelden als Dienst“ nur dort,
      interaktive und Netzwerkanmeldung verweigern).
- [ ] Zertifikat der Unternehmens-CA statt selbstsigniert.
- [ ] Firewall-Regel auf das Netz der Tier-0-PAWs beschränken.
- [ ] Bei entfernter Datenbank TLS mit Zertifikatsprüfung (`VerifyFull`) und `pg_hba.conf` nur für den Dienst-Server.
- [ ] Rollen sparsam vergeben: die meisten Personen brauchen *Betrachter* oder *Bearbeiter*; *Operator* nur für
      die, die Änderungen im AD freigeben.
- [ ] Datenbanksicherungen verschlüsselt und getrennt aufbewahren.
- [ ] Ereignisanzeige (Quelle `TierModel.Service`) und das Änderungsprotokoll in das SIEM übernehmen,
      z. B. ergänzend zu den Sentinel-Regeln unter `optional/TIerModel-Sentinel`.
- [ ] Regelmäßig aktualisieren (Paket, PowerShell 7, PostgreSQL, Windows).

## Bekannte Grenzen

- Eine Sperre nach Fehlversuchen lässt sich von jedem auslösen, der einen Benutzernamen kennt (auch für
  Administratoren). Deshalb die Oberfläche nur aus einem geschützten Netz erreichbar machen und notfalls per
  Kommandozeile entsperren (`admin reset-password`).

- Konten werden in der eigenen Datenbank verwaltet; es gibt (noch) keine Anmeldung per Kerberos/Entra ID und keine
  Mehr-Faktor-Authentifizierung. Die Oberfläche deshalb nur aus einem geschützten Netz erreichbar machen.
- Das „Vier-Augen-Prinzip“ (Freigabe eines Deploys durch eine zweite Person) ist nicht erzwungen; die Trennung
  erfolgt über die Rollen *Bearbeiter* und *Operator*.
