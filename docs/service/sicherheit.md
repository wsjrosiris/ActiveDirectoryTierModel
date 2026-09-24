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
| Windows-Anmeldung | Kerberos/NTLM über den Windows-Server; Rollen ausschließlich über AD-Gruppen (SIDs, höchste Rolle gilt), bei jeder Anmeldung neu bestimmt; deaktivierte Konten bleiben gesperrt |
| Vier-Augen-Prinzip | optional: *Anwenden* nur nach Freigabe durch einen zweiten Operator; festgeschriebene Konfigurationsversionen; Frist mit automatischem Verfall |
| Anmeldung | Eigene Konten, Passwörter mit PBKDF2 gehasht (ASP.NET Core Identity), mindestens 12 Zeichen, Sperre nach 5 Fehlversuchen für 15 Minuten, Rate-Limit 10 Anmeldungen/Minute je IP, Antwortzeit unabhängig davon, ob das Konto existiert |
| Sitzungen | Cookie `HttpOnly`, `Secure`, `SameSite=Strict`, 8 Stunden gleitend; wird bei Deaktivierung, Löschung, Rollen- oder Passwortänderung sofort ungültig |
| Entra ID | optional: OpenID Connect (Authorization Code + PKCE, `state`, `nonce`), Aussteller auf den Mandanten geprüft; Rollen nur über Gruppen-Objekt-IDs bzw. App-Rollen, bei jeder Anmeldung neu bestimmt; Client-Secret verschlüsselt gespeichert |
| API-Tokens | Format `tmk_<8>_<43>`, gespeichert nur als SHA-256-Hash, einmal angezeigt; nur im Header `Authorization: Bearer` (nie aus Cookie oder URL); Gültigkeit höchstens 365 Tage; Rolle höchstens die des Besitzers und bei jeder Anfrage auf dessen aktuelle Rolle begrenzt; deaktivierte Besitzer sperren ihre Tokens; 300 Anfragen/Minute je Token; Tokens können keine Tokens verwalten, keine Passwörter ändern und sich nicht an-/abmelden |
| CSRF | Antiforgery-Token (Cookie `XSRF-TOKEN` → Header `X-XSRF-TOKEN`) für jeden schreibenden Aufruf, an die angemeldete Identität gebunden |
| Berechtigungen | Rollenprüfung serverseitig an jedem Endpunkt; *Anwenden* nur für Operatoren; der letzte Administrator kann nicht entfernt werden |
| Browser | Content-Security-Policy ohne Inline-Skripte, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, API-Antworten `no-store` |
| Prozessstart | PowerShell wird ohne Shell mit Argumentliste gestartet; DC-Name und Sprache werden per Regex geprüft, bevor sie Argumente werden; stdin ist geschlossen, damit unerwartete Rückfragen nicht hängen |
| Dateien | Konfigurationsdateinamen stammen aus einem festen Katalog – keine Pfadangaben aus Anfragen |
| Änderungsprotokoll | Einträge per SHA-256 verkettet (vorheriger Hash + Inhalt), unter PostgreSQL-Advisory-Lock geschrieben; Prüfung unter *Systemzustand* und `/api/changelog/verify` erkennt geänderte oder gelöschte Einträge. Einen kompletten Austausch der Tabelle erkennt nur der Vergleich mit einem extern notierten Kettenende |
| Wartungsfenster | *Anwenden* nur innerhalb freigegebener Fenster und nie in Sperrzeiten; der Worker prüft unmittelbar vor dem Start erneut |
| Nachvollziehbarkeit | Jede Konfigurationsänderung mit Autor, Kommentar und Diff; Änderungsprotokoll für Läufe, Benutzer, Zeitpläne, Einstellungen und Anmeldungen; jeder Lauf speichert die verwendeten Konfigurationsversionen |
| Benachrichtigungen | SMTP-Passwort und Webhook-URLs mit ASP.NET Core Data Protection verschlüsselt in der Datenbank; URLs werden nur gekürzt angezeigt; Ziele nur per https |
| Geheimnisse | Datenbankpasswort nur in `appsettings.Production.json` (ACL: SYSTEM, Administratoren, Dienstkonto); Installer übergibt Passwörter über stdin, nie auf der Kommandozeile; das Superuser-Passwort der lokalen PostgreSQL-Installation wird über eine temporäre, ACL-geschützte Optionsdatei übergeben und danach gelöscht |

## Härtungsempfehlungen

- [ ] Dienstkonto als **gMSA**, nur das Computerkonto des Dienst-Servers darf das Passwort abrufen.
- [ ] Anmeldung des Dienstkontos auf den Dienst-Server beschränken (Benutzerrecht „Anmelden als Dienst“ nur dort,
      interaktive und Netzwerkanmeldung verweigern).
- [ ] Zertifikat der Unternehmens-CA statt selbstsigniert.
- [ ] Firewall-Regel auf das Netz der Tier-0-PAWs beschränken.
- [ ] Bei entfernter Datenbank TLS mit Zertifikatsprüfung (`VerifyFull`) und `pg_hba.conf` nur für den Dienst-Server.
- [ ] **Windows-Anmeldung** mit eigenen AD-Gruppen je Rolle nutzen; lokale Konten nur als Notfallzugang.
- [ ] **Vier-Augen-Prinzip** aktivieren, sobald mehr als ein Operator existiert.
- [ ] **Benachrichtigungen** für Drift, Fehler und Freigaben an das zuständige Team bzw. SIEM.
- [ ] Rollen sparsam vergeben: die meisten Personen brauchen *Betrachter* oder *Bearbeiter*; *Operator* nur für
      die, die Änderungen im AD freigeben.
- [ ] Datenbanksicherungen verschlüsselt und getrennt aufbewahren.
- [ ] Änderungsprotokoll und Befunde per **Syslog/CEF** oder **Log Analytics** an das SIEM weiterleiten
      (siehe [Betrieb › SIEM](betrieb.md#siem-anbindung)).
- [ ] Das **Kettenende** des Änderungsprotokolls (Systemzustand) regelmäßig außerhalb des Servers notieren.
- [ ] **API-Tokens** mit kurzer Gültigkeit und minimaler Rolle; nicht benötigte Tokens widerrufen.
- [ ] **Wartungsfenster** und Sperrzeiten (z. B. Jahresabschluss) pflegen.
- [ ] Regelmäßig aktualisieren (Paket, PowerShell 7, PostgreSQL, Windows).

## Bekannte Grenzen

- Eine Sperre nach Fehlversuchen lässt sich von jedem auslösen, der einen Benutzernamen kennt (auch für
  Administratoren). Deshalb die Oberfläche nur aus einem geschützten Netz erreichbar machen und notfalls per
  Kommandozeile entsperren (`admin reset-password`).

- Keine eigene Mehr-Faktor-Authentifizierung für lokale Konten; MFA über die Entra-ID-Anmeldung (Conditional
  Access) oder die Windows-Anmeldung (z. B. Smartcard/Windows Hello auf der PAW).
- Das Vier-Augen-Prinzip ist optional und gilt nur für *Anwenden*; Konfigurationsänderungen selbst werden nicht
  freigegeben (sie werden aber versioniert und protokolliert).
