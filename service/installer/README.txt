TierModel Service – Installation
================================

1. ZIP-Datei auf dem Windows Server entpacken (z. B. nach C:\Install\TierModelService).
2. Setup.cmd doppelklicken (Administratorrechte werden angefordert).
3. Den Fragen des Assistenten folgen – Enter übernimmt jeweils den Vorschlag in [Klammern].

Der Assistent erledigt:
  - Prüfung der Voraussetzungen, bei Bedarf Installation von PowerShell 7 und der RSAT-Tools
  - PostgreSQL: lokale Installation ODER Nutzung eines vorhandenen Servers
    (Datenbank und Datenbankbenutzer mit zufälligem Passwort werden automatisch angelegt)
  - Dienstkonto (gMSA empfohlen), inkl. Recht "Als Dienst anmelden"
  - HTTPS-Zertifikat (vorhandenes auswählen oder selbstsigniertes erzeugen), Firewall-Regel
  - Windows-Dienst "TierModel Service" (Autostart, Neustart bei Fehlern)
  - Erstes Administratorkonto der Web-Oberfläche

Aktualisieren:   Neues Paket entpacken, Setup.cmd starten, "Aktualisieren" wählen.
Deinstallieren:  Setup.cmd starten, "Deinstallieren" wählen (Datenbank bleibt erhalten).

PowerShell-Client: Das Modul client\TierModel.Service.Client (Connect-TierModelService, Start-TierModelAudit,
Wait-TierModelRun, ...) auf Admin-Rechnern in einen Ordner aus $env:PSModulePath kopieren. Anmeldung mit einem
API-Token aus der Oberfläche (Benutzermenü › API-Tokens).

Wichtig: Der Server führt Änderungen am Active Directory mit den Rechten des Dienstkontos aus
und ist deshalb wie ein Tier-0-System zu behandeln (Zugriff, Patches, Überwachung).

Protokolle:   C:\ProgramData\TierModelService\logs\setup-*.log
              Ereignisanzeige › Windows-Protokolle › Anwendung (Quelle "TierModel.Service")
