# Tier Model Manager - Verbesserungen & Design

## Brainstorming

### Kategorie 1: UX & Workflow (Hoch-Priorität)

| # | Idee | Beschreibung | Aufwand |
|---|------|-------------|---------|
| 1.1 | **Global Search** | Eine Suchleiste die über alle Entitäten (OUs, Gruppen, User, ACLs, GPOs) gleichzeitig sucht mit Treffer-Vorschau | Mittel |
| 1.2 | **Drag & Drop OU-Baum** | OUs per Drag & Drop verschieben, automatische Pfad-Anpassung | Hoch |
| 1.3 | **Bulk-Operationen** | Mehrere OUs/Gruppen/User auswählen und gemeinsam loeschen/editieren | Mittel |
| 1.4 | **Undo/Redo** | Aenderungen rückgängig machen (Ctrl+Z / Ctrl+Y) | Mittel |
| 1.5 | **Config-Validierung** | Vor Deploy: JSON-Schema-Validierung mit Fehlermeldungen | Mittel |
| 1.6 | **Wizard-Modus** | Schritt-für-Schritt Assistent für Erstinstallation | Niedrig |
| 1.7 | **Quick Actions** | Command Palette (Ctrl+K) für schnelle Navigation | Mittel |

### Kategorie 2: Visualisierung (Mittel-Priorität)

| # | Idee | Beschreibung | Aufwand |
|---|------|-------------|---------|
| 2.1 | **Interaktiver OU-Baum** | Baum mit Expand/Collapse, Klick zum Navigieren, Kontextmenü | Mittel |
| 2.2 | **Tier-Diagramm** | Visuelle Darstellung der Tier-Abhängigkeiten (T0 → T1 → T2) | Hoch |
| 2.3 | **ACL-Matrix** | Tabellarische Darstellung: Gruppen × OUs mit Rechten | Mittel |
| 2.4 | **GPO-Vererbungsbaum** | Zeigt welche GPOs auf welche OUs wirken | Mittel |
| 2.5 | **Drift-Dashboard** | Visuelle Darstellung von Abweichungen nach Audit | Mittel |
| 2.6 | **Timeline** | Chronologie der letzten Änderungen | Niedrig |

### Kategorie 3: Daten & Import (Mittel-Priorität)

| # | Idee | Beschreibung | Aufwand |
|---|------|-------------|---------|
| 3.1 | **AD-Import** | Bestehende OU/Gruppen/User aus AD importieren | Hoch |
| 3.2 | **Config-Export** | Konfiguration als ZIP exportieren | Niedrig |
| 3.3 | **Config-Import** | Konfiguration aus ZIP importieren | Niedrig |
| 3.4 | **Templates** | Vordefinierte Tier-Model Templates (Standard, Minimal, Enterprise) | Mittel |
| 3.5 | **Diff-View** | Vorher/Nachher-Vergleich vor Deploy | Mittel |
| 3.6 | **Config-Versionierung** | Git-Integration für Config-Dateien | Hoch |

### Kategorie 4: Sicherheit (Hoch-Priorität)

| # | Idee | Beschreibung | Aufwand |
|---|------|-------------|---------|
| 4.1 | **Authentifizierung** | Login mit AD-Credentials | Mittel |
| 4.2 | **Rollen-Basiert** | Admin (voll), Operator (nur Deploy), Viewer (nur lesen) | Mittel |
| 4.3 | **Audit-Log** | Wer hat wann was geändert | Mittel |
| 4.4 | **2FA** | Zwei-Faktor-Authentifizierung | Hoch |
| 4.5 | **Session-Timeout** | Automatische Abmeldung nach Inaktivität | Niedrig |

### Kategorie 5: Integration (Niedrig-Priorität)

| # | Idee | Beschreibung | Aufwand |
|---|------|-------------|---------|
| 5.1 | **Azure Sentinel** | Security Alerts direkt in der UI anzeigen | Hoch |
| 5.2 | **Webhooks** | Benachrichtigungen bei Deploy/Audit | Mittel |
| 5.3 | **PowerShell Module** | Cmdlets für Remote-Steuerung | Mittel |
| 5.4 | **REST API Dokumentation** | Swagger/OpenAPI für die API | Niedrig |
| 5.5 | **Multi-Domain** | Mehrere AD-Domänen gleichzeitig verwalten | Hoch |

### Kategorie 6: Performance & Technisch

| # | Idee | Beschreibung | Aufwand |
|---|------|-------------|---------|
| 6.1 | **Caching** | Config-Dateien cachen, nur bei Änderung neu laden | Niedrig |
| 6.2 | **Lazy Loading** | Tabellen erst bei Scrollen laden | Mittel |
| 6.3 | **WebSocket** | Real-time Updates bei Deploy/Audit | Hoch |
| 6.4 | **PWA** | Progressive Web App für Offline-Nutzung | Hoch |
| 6.5 | **Docker** | Container-bereitstellung | Mittel |

---

## Design-Plan: Phase 1 (Quick Wins)

### 1. Global Search (Ctrl+K)

```
┌─────────────────────────────────────────────────┐
│  🔍 Tier 0 Admins                          Esc  │
├─────────────────────────────────────────────────┤
│  Gruppen                                         │
│  ┌─────────────────────────────────────────────┐ │
│  │ 👥 Tier 0 Admins                    T0      │ │
│  │    OU=Tier 0 Groups,OU=Tier 0,...           │ │
│  └─────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────┐ │
│  │ 👥 Tier 0 Operators                 T0      │ │
│  │    OU=Tier 0 Groups,OU=Tier 0,...           │ │
│  └─────────────────────────────────────────────┘ │
│  OUs                                             │
│  ┌─────────────────────────────────────────────┐ │
│  │ 📁 Tier 0 Accounts                  T0      │ │
│  │    OU=Tier 0,OU=Tier Model Admin,...        │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**Technik:**
- `Ctrl+K` / `Cmd+K` Shortcut
- Durchsucht: OUs, Gruppen, User, ACLs, GPOs
- Klick auf Ergebnis navigiert zur passenden Seite
- Fuzzy-Matching für Tippfehler

### 2. Interaktiver OU-Baum (Verbessert)

```
▼ 📂 Tier Model Administration              [Admin]
    ▼ 📂 Tier 0                             [T0]
        📂 Tier 0 Accounts                  [T0]  → Rechtsklick
        📂 Tier 0 Groups                    [T0]     ┌──────────┐
        📂 Tier 0 Service Accounts          [T0]     │ Öffnen   │
        📂 Tier 0 PAW Devices               [T0]     │ Umbenennen│
    ▶ 📂 Tier 1                             [T1]     │ Löschen  │
    ▶ 📂 Tier 2                             [T2]     │ Neue OU  │
    📂 PAW Staging                          [Admin]  └──────────┘
▼ 📂 Tier 0 Member Servers                 [T0]
    📂 Tier 0 Server Staging                [T0]
▼ 📂 Tier 1 Member Servers                 [T1]
    📂 Tier 1 Server Staging                [T1]
```

**Features:**
- Expand/Collapse per Klick
- Kontextmenü (Rechtsklick)
- Drag & Drop zum Verschieben
- Inline-Rename (Doppelklick)
- Badge zeigt Tier-Zugehörigkeit
- Klick navigiert zu OU-Details

### 3. Config-Validierung vor Deploy

```
┌─────────────────────────────────────────────────┐
│  ⚠️ Validierung: 3 Probleme gefunden            │
├─────────────────────────────────────────────────┤
│                                                  │
│  ❌ OU "Tier 0 Accounts" referenziert nicht      │
│     existierende Parent-OU                       │
│     → Pfad: OU=Tier 0,...                        │
│                                                  │
│  ⚠️ Gruppe "Tier0Admins" hat keine Member        │
│     → Empfehlung: Mindestens 1 Member zuweisen   │
│                                                  │
│  ⚠️ ACL auf "OU=Tier 1 Accounts" mit             │
│     "Tier2Admins" - falsches Tier?               │
│     → Erwartet: Tier1Admins                      │
│                                                  │
│  ┌──────────┐  ┌──────────┐                      │
│  │ Abbrechen │  │ Trotzdem │                      │
│  │          │  │ deployen │                      │
│  └──────────┘  └──────────┘                      │
└─────────────────────────────────────────────────┘
```

**Validierungsregeln:**
- OU-Pfade referenzieren existierende OUs
- Gruppen haben mindestens ein Member
- ACLs nutzen korrekte Tier-Gruppen
- GPOs haben gültige Link-Targets
- Keine doppelten SAM-Account-Namen

### 4. Undo/Redo System

```javascript
// State Management
const stateHistory = {
    past: [],      // Vorherige Zustände
    present: config, // Aktueller Zustand
    future: []     // Zustände für Redo
};

// Bei jeder Änderung:
function pushState() {
    stateHistory.past.push(JSON.parse(JSON.stringify(config)));
    stateHistory.future = [];
}

// Undo (Ctrl+Z):
function undo() {
    if (stateHistory.past.length === 0) return;
    stateHistory.future.push(JSON.parse(JSON.stringify(config)));
    Object.assign(config, stateHistory.past.pop());
    renderAll();
}

// Redo (Ctrl+Y):
function redo() {
    if (stateHistory.future.length === 0) return;
    stateHistory.past.push(JSON.parse(JSON.stringify(config)));
    Object.assign(config, stateHistory.future.pop());
    renderAll();
}
```

### 5. Command Palette (Ctrl+K)

```
┌─────────────────────────────────────────────────┐
│  🔍 Befehl eingeben...                     Esc  │
├─────────────────────────────────────────────────┤
│  Navigation                                      │
│  ┌─────────────────────────────────────────────┐ │
│  │ 📊 Dashboard öffnen                         │ │
│  └─────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────┐ │
│  │ ⚙️ Konfiguration anzeigen                   │ │
│  └─────────────────────────────────────────────┘ │
│  Aktionen                                        │
│  ┌─────────────────────────────────────────────┐ │
│  │ 🚀 Deploy starten (WhatIf)                  │ │
│  └─────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────┐ │
│  │ 📊 Audit starten                            │ │
│  └─────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────┐ │
│  │ 💾 Alle Konfigurationen speichern           │ │
│  └─────────────────────────────────────────────┘ │
│  Erstellen                                       │
│  ┌─────────────────────────────────────────────┐ │
│  │ ➕ Neue OU erstellen                        │ │
│  └─────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────┐ │
│  │ ➕ Neue Gruppe erstellen                    │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

### 6. Diff-View vor Deploy

```
┌─────────────────────────────────────────────────┐
│  📊 Änderungen: 5 OUs, 3 Gruppen, 2 ACLs       │
├─────────────────────────────────────────────────┤
│                                                  │
│  OUs                                             │
│  ┌─────────────────────────────────────────────┐ │
│  │ + Neue OU: "Tier 0 PAW Devices"             │ │
│  │   Pfad: OU=Tier 0,OU=Tier Model Admin,...   │ │
│  └─────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────┐ │
│  │ ~ Geändert: "Tier 0 Accounts"               │ │
│  │   protectFromAccidentalDeletion: false→true  │ │
│  └─────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────┐ │
│  │ - Gelöscht: "Old OU Name"                   │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  Gruppen                                         │
│  ┌─────────────────────────────────────────────┐ │
│  │ + Neue Gruppe: "Tier0PAWDevices"            │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  ┌──────────────┐  ┌──────────────┐              │
│  │  Abbrechen   │  │ Deployen     │              │
│  └──────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────┘
```

### 7. Audit-Log / Timeline

```
┌─────────────────────────────────────────────────┐
│  📋 Letzte Änderungen                           │
├─────────────────────────────────────────────────┤
│                                                  │
│  Heute, 14:32                                    │
│  ┌─────────────────────────────────────────────┐ │
│  │ 🚀 Deploy ausgeführt (WhatIf)               │ │
│  │    29 OUs, 24 Gruppen, 2 Users, 62 ACLs    │ │
│  │    Status: Erfolgreich                       │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  Heute, 14:15                                    │
│  ┌─────────────────────────────────────────────┐ │
│  │ ✏️ OU umbenannt: "Old Name" → "New Name"    │ │
│  │    3 Referenzen aktualisiert                 │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  Heute, 13:45                                    │
│  ┌─────────────────────────────────────────────┐ │
│  │ ➕ Neue Gruppe: "Tier0PAWDevices"           │ │
│  │    Scope: Universal, Kategorie: Security     │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  Gestern, 16:20                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │ 📊 Audit abgeschlossen                      │ │
│  │    2 Abweichungen gefunden                   │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

---

## Implementierungs-Reihenfolge

### Phase 1: Quick Wins (1-2 Tage)
1. ✅ Global Search (Ctrl+K)
2. ✅ Command Palette
3. ✅ Undo/Redo
4. ✅ Config-Validierung

### Phase 2: Visualisierung (3-5 Tage)
1. Interaktiver OU-Baum mit Kontextmenü
2. Diff-View vor Deploy
3. Audit-Log / Timeline
4. Drift-Dashboard

### Phase 3: Daten (5-7 Tage)
1. AD-Import
2. Config-Export/Import (ZIP)
3. Templates
4. Config-Versionierung

### Phase 4: Sicherheit (3-5 Tage)
1. Authentifizierung (AD)
2. Rollen-basiert
3. Audit-Log persistieren

### Phase 5: Integration (5-7 Tage)
1. REST API Dokumentation
2. Webhooks
3. Multi-Domain
4. Docker
