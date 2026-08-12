#Requires -Version 7.0

<#
.SYNOPSIS
    Webanwendung zur Verwaltung des Active Directory Tier Models.
.DESCRIPTION
    Startet einen lokalen Webserver auf Port 8080 mit einer Oberflaeche
    zum Verwalten, Deployen und Auditen des Tier Models.
#>

$Port = 8080
$TierModelRoot = $PSScriptRoot

# === HTML Oberflaeche ===
$HtmlPage = @'
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tier Model Manager</title>
    <style>
        :root {
            --bg: #0f1117;
            --surface: #1a1d27;
            --surface2: #232736;
            --border: #2d3148;
            --text: #e4e6f0;
            --text2: #8b8fa8;
            --accent: #4f8cff;
            --accent2: #3a6fd8;
            --green: #34d399;
            --red: #f87171;
            --orange: #fbbf24;
            --tier0: #f87171;
            --tier1: #fbbf24;
            --tier2: #34d399;
            --tierAdmin: #818cf8;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }

        /* Sidebar */
        .sidebar {
            position: fixed; left: 0; top: 0; bottom: 0; width: 260px;
            background: var(--surface); border-right: 1px solid var(--border);
            display: flex; flex-direction: column; z-index: 100;
        }
        .sidebar-header {
            padding: 24px 20px; border-bottom: 1px solid var(--border);
        }
        .sidebar-header h1 { font-size: 18px; color: var(--accent); font-weight: 700; }
        .sidebar-header p { font-size: 11px; color: var(--text2); margin-top: 4px; }
        .sidebar nav { flex: 1; padding: 12px 8px; overflow-y: auto; }
        .nav-item {
            display: flex; align-items: center; gap: 10px;
            padding: 10px 12px; border-radius: 8px; cursor: pointer;
            color: var(--text2); font-size: 13px; transition: all 0.15s;
            margin-bottom: 2px;
        }
        .nav-item:hover { background: var(--surface2); color: var(--text); }
        .nav-item.active { background: var(--accent); color: white; }
        .nav-item .icon { font-size: 16px; width: 20px; text-align: center; }
        .nav-sep { height: 1px; background: var(--border); margin: 8px 12px; }
        .sidebar-footer { padding: 16px 20px; border-top: 1px solid var(--border); font-size: 11px; color: var(--text2); }

        /* Main */
        .main { margin-left: 260px; padding: 32px; min-height: 100vh; }
        .page { display: none; }
        .page.active { display: block; }

        /* Cards */
        .card {
            background: var(--surface); border: 1px solid var(--border);
            border-radius: 12px; padding: 24px; margin-bottom: 20px;
        }
        .card h2 { font-size: 16px; margin-bottom: 16px; color: var(--text); }
        .card h3 { font-size: 14px; margin-bottom: 12px; color: var(--text2); }

        /* Stats */
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
        .stat-card {
            background: var(--surface); border: 1px solid var(--border);
            border-radius: 10px; padding: 20px;
        }
        .stat-card .label { font-size: 11px; color: var(--text2); text-transform: uppercase; letter-spacing: 1px; }
        .stat-card .value { font-size: 28px; font-weight: 700; margin-top: 4px; }
        .stat-card .value.t0 { color: var(--tier0); }
        .stat-card .value.t1 { color: var(--tier1); }
        .stat-card .value.t2 { color: var(--tier2); }
        .stat-card .value.admin { color: var(--tierAdmin); }

        /* Tables */
        .table-wrap { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; padding: 10px 12px; color: var(--text2); font-weight: 600; border-bottom: 1px solid var(--border); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
        td { padding: 10px 12px; border-bottom: 1px solid var(--border); color: var(--text); }
        tr:hover td { background: var(--surface2); }

        /* Badges */
        .badge {
            display: inline-block; padding: 3px 10px; border-radius: 20px;
            font-size: 11px; font-weight: 600;
        }
        .badge-t0 { background: rgba(248,113,113,0.15); color: var(--tier0); }
        .badge-t1 { background: rgba(251,191,36,0.15); color: var(--tier1); }
        .badge-t2 { background: rgba(52,211,153,0.15); color: var(--tier2); }
        .badge-admin { background: rgba(129,140,248,0.15); color: var(--tierAdmin); }
        .badge-green { background: rgba(52,211,153,0.15); color: var(--green); }
        .badge-red { background: rgba(248,113,113,0.15); color: var(--red); }
        .badge-enabled { background: rgba(52,211,153,0.15); color: var(--green); }
        .badge-disabled { background: rgba(248,113,113,0.15); color: var(--red); }

        /* Buttons */
        .btn {
            padding: 8px 16px; border-radius: 8px; border: none;
            font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s;
        }
        .btn-primary { background: var(--accent); color: white; }
        .btn-primary:hover { background: var(--accent2); }
        .btn-success { background: var(--green); color: #0f1117; }
        .btn-success:hover { opacity: 0.85; }
        .btn-danger { background: var(--red); color: white; }
        .btn-danger:hover { opacity: 0.85; }
        .btn-outline {
            background: transparent; border: 1px solid var(--border); color: var(--text);
        }
        .btn-outline:hover { border-color: var(--accent); color: var(--accent); }
        .btn-sm { padding: 5px 10px; font-size: 11px; }

        /* Forms */
        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; font-size: 12px; color: var(--text2); margin-bottom: 6px; font-weight: 600; }
        .form-group input, .form-group select, .form-group textarea {
            width: 100%; padding: 10px 12px; background: var(--surface2);
            border: 1px solid var(--border); border-radius: 8px;
            color: var(--text); font-size: 13px; font-family: inherit;
        }
        .form-group input:focus, .form-group select:focus, .form-group textarea:focus {
            outline: none; border-color: var(--accent);
        }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .form-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
        .form-check { display: flex; align-items: center; gap: 8px; }
        .form-check input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--accent); }

        /* OU Tree */
        .ou-tree { font-size: 13px; }
        .ou-tree ul { list-style: none; padding-left: 20px; }
        .ou-tree > ul { padding-left: 0; }
        .ou-tree li { position: relative; padding: 4px 0; }
        .ou-tree li::before {
            content: ''; position: absolute; left: -16px; top: 0; bottom: 0;
            width: 1px; background: var(--border);
        }
        .ou-tree li::after {
            content: ''; position: absolute; left: -16px; top: 14px;
            width: 12px; height: 1px; background: var(--border);
        }
        .ou-node {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 4px 8px; border-radius: 6px; cursor: pointer;
            transition: background 0.15s;
        }
        .ou-node:hover { background: var(--surface2); }
        .ou-node .ou-icon { font-size: 14px; }
        .ou-node .ou-name { font-weight: 500; }
        .ou-node .ou-tag { font-size: 10px; padding: 1px 6px; border-radius: 4px; }

        /* Terminal */
        .terminal {
            background: #0a0c10; border: 1px solid var(--border);
            border-radius: 8px; padding: 16px; font-family: 'Cascadia Code', 'Consolas', monospace;
            font-size: 12px; line-height: 1.6; max-height: 400px; overflow-y: auto;
            color: var(--green);
        }
        .terminal .line-error { color: var(--red); }
        .terminal .line-warn { color: var(--orange); }
        .terminal .line-info { color: var(--accent); }

        /* Toolbar */
        .toolbar {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 16px; flex-wrap: wrap; gap: 8px;
        }
        .toolbar-left { display: flex; gap: 8px; align-items: center; }
        .toolbar-right { display: flex; gap: 8px; align-items: center; }
        .search-box {
            padding: 8px 12px; background: var(--surface2); border: 1px solid var(--border);
            border-radius: 8px; color: var(--text); font-size: 13px; width: 240px;
        }
        .search-box:focus { outline: none; border-color: var(--accent); }

        /* Modal */
        .modal-overlay {
            display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6);
            z-index: 1000; align-items: center; justify-content: center;
        }
        .modal-overlay.show { display: flex; }
        .modal {
            background: var(--surface); border: 1px solid var(--border);
            border-radius: 16px; padding: 32px; width: 90%; max-width: 640px;
            max-height: 80vh; overflow-y: auto;
        }
        .modal h2 { margin-bottom: 20px; font-size: 18px; }
        .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }

        /* JSON Editor */
        .json-editor {
            width: 100%; min-height: 300px; background: #0a0c10;
            border: 1px solid var(--border); border-radius: 8px;
            color: var(--green); font-family: 'Cascadia Code', 'Consolas', monospace;
            font-size: 12px; padding: 16px; resize: vertical;
        }

        /* Toast */
        .toast-container { position: fixed; top: 20px; right: 20px; z-index: 2000; }
        .toast {
            padding: 12px 20px; border-radius: 8px; margin-bottom: 8px;
            font-size: 13px; animation: slideIn 0.3s ease;
        }
        .toast-success { background: rgba(52,211,153,0.9); color: #0f1117; }
        .toast-error { background: rgba(248,113,113,0.9); color: white; }
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

        /* Responsive */
        @media (max-width: 768px) {
            .sidebar { width: 60px; }
            .sidebar-header h1, .sidebar-header p, .nav-item span, .sidebar-footer { display: none; }
            .main { margin-left: 60px; padding: 16px; }
            .form-row, .form-row-3 { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="sidebar">
        <div class="sidebar-header">
            <h1>Tier Model</h1>
            <p>AD Management Console</p>
        </div>
        <nav>
            <div class="nav-item active" data-page="dashboard"><span class="icon">&#9632;</span><span>Dashboard</span></div>
            <div class="nav-sep"></div>
            <div class="nav-item" data-page="ous"><span class="icon">&#128193;</span><span>Organizational Units</span></div>
            <div class="nav-item" data-page="groups"><span class="icon">&#128101;</span><span>Gruppen</span></div>
            <div class="nav-item" data-page="users"><span class="icon">&#128100;</span><span>Benutzer</span></div>
            <div class="nav-item" data-page="acls"><span class="icon">&#128274;</span><span>ACL Delegationen</span></div>
            <div class="nav-sep"></div>
            <div class="nav-item" data-page="config"><span class="icon">&#9881;</span><span>Konfiguration</span></div>
            <div class="nav-item" data-page="deploy"><span class="icon">&#9654;</span><span>Deploy</span></div>
            <div class="nav-item" data-page="audit"><span class="icon">&#128202;</span><span>Audit</span></div>
        </nav>
        <div class="sidebar-footer">v1.0.0 | Port 8080</div>
    </div>

    <div class="main">
        <!-- Dashboard -->
        <div class="page active" id="page-dashboard">
            <h2 style="font-size:22px; margin-bottom:24px;">Dashboard</h2>
            <div class="stats-grid" id="stats-grid"></div>
            <div class="card">
                <h2>OU Struktur</h2>
                <div class="ou-tree" id="ou-tree"></div>
            </div>
        </div>

        <!-- OUs -->
        <div class="page" id="page-ous">
            <div class="toolbar">
                <h2 style="font-size:18px;">Organizational Units</h2>
                <div class="toolbar-right">
                    <input class="search-box" placeholder="Suchen..." id="ou-search">
                    <button class="btn btn-primary" onclick="showModal('ou-modal')">+ OU hinzufuegen</button>
                    <button class="btn btn-outline" onclick="saveConfig('ous')">Speichern</button>
                </div>
            </div>
            <div class="card"><div class="table-wrap" id="ou-table"></div></div>
        </div>

        <!-- Groups -->
        <div class="page" id="page-groups">
            <div class="toolbar">
                <h2 style="font-size:18px;">Sicherheitsgruppen</h2>
                <div class="toolbar-right">
                    <input class="search-box" placeholder="Suchen..." id="group-search">
                    <button class="btn btn-primary" onclick="showModal('group-modal')">+ Gruppe hinzufuegen</button>
                    <button class="btn btn-outline" onclick="saveConfig('groups')">Speichern</button>
                </div>
            </div>
            <div class="card"><div class="table-wrap" id="group-table"></div></div>
        </div>

        <!-- Users -->
        <div class="page" id="page-users">
            <div class="toolbar">
                <h2 style="font-size:18px;">Benutzer</h2>
                <div class="toolbar-right">
                    <input class="search-box" placeholder="Suchen..." id="user-search">
                    <button class="btn btn-primary" onclick="showModal('user-modal')">+ Benutzer hinzufuegen</button>
                    <button class="btn btn-outline" onclick="saveConfig('users')">Speichern</button>
                </div>
            </div>
            <div class="card"><div class="table-wrap" id="user-table"></div></div>
        </div>

        <!-- ACLs -->
        <div class="page" id="page-acls">
            <div class="toolbar">
                <h2 style="font-size:18px;">ACL Delegationen</h2>
                <div class="toolbar-right">
                    <input class="search-box" placeholder="Suchen..." id="acl-search">
                    <button class="btn btn-outline" onclick="saveConfig('acls')">Speichern</button>
                </div>
            </div>
            <div class="card"><div class="table-wrap" id="acl-table"></div></div>
        </div>

        <!-- Config -->
        <div class="page" id="page-config">
            <h2 style="font-size:18px; margin-bottom:16px;">Konfiguration (JSON)</h2>
            <div class="card">
                <div class="toolbar">
                    <select id="config-file-select" style="padding:8px 12px; background:var(--surface2); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:13px;">
                        <option value="tiermodel.json">tiermodel.json (Hauptkonfiguration)</option>
                        <option value="tiermodel-ous.json">tiermodel-ous.json (OUs)</option>
                        <option value="tiermodel-groups.json">tiermodel-groups.json (Gruppen)</option>
                        <option value="tiermodel-users.json">tiermodel-users.json (Benutzer)</option>
                        <option value="tiermodel-acls.json">tiermodel-acls.json (ACLs)</option>
                        <option value="tiermodel-gpos.json">tiermodel-gpos.json (GPOs)</option>
                    </select>
                    <div class="toolbar-right">
                        <button class="btn btn-outline" onclick="loadConfigEditor()">Neu laden</button>
                        <button class="btn btn-primary" onclick="saveConfigEditor()">Speichern</button>
                    </div>
                </div>
                <textarea class="json-editor" id="json-editor"></textarea>
            </div>
        </div>

        <!-- Deploy -->
        <div class="page" id="page-deploy">
            <h2 style="font-size:18px; margin-bottom:16px;">Tier Model Deployen</h2>
            <div class="card">
                <h3>Optionen</h3>
                <div class="form-row" style="margin-bottom:16px;">
                    <div class="form-check"><input type="checkbox" id="opt-whatif"><label for="opt-whatif">WhatIf (nur Plan anzeigen)</label></div>
                    <div class="form-check"><input type="checkbox" id="opt-confirm"><label for="opt-confirm">ConfirmApply (Bestaetigung)</label></div>
                </div>
                <div class="form-row" style="margin-bottom:16px;">
                    <div class="form-check"><input type="checkbox" id="opt-msa"><label for="opt-msa">IncludeMsa</label></div>
                    <div class="form-check"><input type="checkbox" id="opt-gmsa"><label for="opt-gmsa">IncludeGmsa</label></div>
                </div>
                <div class="form-row" style="margin-bottom:16px;">
                    <div class="form-check"><input type="checkbox" id="opt-dmsa"><label for="opt-dmsa">IncludeDmsa</label></div>
                    <div class="form-check"><input type="checkbox" id="opt-winlaps"><label for="opt-winlaps">IncludeWinLaps</label></div>
                </div>
                <button class="btn btn-success" onclick="runDeploy()" id="btn-deploy">Deploy starten</button>
            </div>
            <div class="card">
                <h3>Ausgabe</h3>
                <div class="terminal" id="deploy-output">Bereit...</div>
            </div>
        </div>

        <!-- Audit -->
        <div class="page" id="page-audit">
            <h2 style="font-size:18px; margin-bottom:16px;">Tier Model Auditieren</h2>
            <div class="card">
                <button class="btn btn-primary" onclick="runAudit()" id="btn-audit">Audit starten</button>
            </div>
            <div class="card">
                <h3>Ergebnis</h3>
                <div class="terminal" id="audit-output">Bereit...</div>
            </div>
        </div>
    </div>

    <!-- OU Modal -->
    <div class="modal-overlay" id="ou-modal">
        <div class="modal">
            <h2>Neue OU</h2>
            <div class="form-group"><label>Name</label><input id="ou-name" placeholder="z.B. Tier 0 Accounts"></div>
            <div class="form-group"><label>Pfad (parent)</label><input id="ou-path" placeholder="z.B. OU=Tier 0,OU=Tier Model Administration,{{DOMAIN_DN}}"></div>
            <div class="form-group"><label>Kommentar</label><input id="ou-comment"></div>
            <div class="form-row">
                <div class="form-check"><input type="checkbox" id="ou-protect" checked><label for="ou-protect">Vor Loeschung schuetzen</label></div>
                <div class="form-check"><input type="checkbox" id="ou-blockgpo"><label for="ou-blockgpo">GPO-Vererbung blockieren</label></div>
            </div>
            <div class="modal-actions">
                <button class="btn btn-outline" onclick="hideModal('ou-modal')">Abbrechen</button>
                <button class="btn btn-primary" onclick="addOU()">Hinzufuegen</button>
            </div>
        </div>
    </div>

    <!-- Group Modal -->
    <div class="modal-overlay" id="group-modal">
        <div class="modal">
            <h2>Neue Gruppe</h2>
            <div class="form-row">
                <div class="form-group"><label>Name</label><input id="grp-name" placeholder="z.B. Tier 0 Admins"></div>
                <div class="form-group"><label>SamAccountName</label><input id="grp-sam" placeholder="z.B. Tier0Admins"></div>
            </div>
            <div class="form-group"><label>Beschreibung</label><input id="grp-desc"></div>
            <div class="form-row-3">
                <div class="form-group"><label>Scope</label><select id="grp-scope"><option>Global</option><option>Universal</option><option>DomainLocal</option></select></div>
                <div class="form-group"><label>Kategorie</label><select id="grp-cat"><option>Security</option><option>Distribution</option></select></div>
                <div class="form-group"><label>Pfad</label><input id="grp-path" placeholder="OU=...,{{DOMAIN_DN}}"></div>
            </div>
            <div class="modal-actions">
                <button class="btn btn-outline" onclick="hideModal('group-modal')">Abbrechen</button>
                <button class="btn btn-primary" onclick="addGroup()">Hinzufuegen</button>
            </div>
        </div>
    </div>

    <!-- User Modal -->
    <div class="modal-overlay" id="user-modal">
        <div class="modal">
            <h2>Neuer Benutzer</h2>
            <div class="form-row">
                <div class="form-group"><label>SamAccountName</label><input id="usr-sam" placeholder="z.B. svc-myapp"></div>
                <div class="form-group"><label>DisplayName</label><input id="usr-display"></div>
            </div>
            <div class="form-group"><label>Beschreibung</label><input id="usr-desc"></div>
            <div class="form-group"><label>Pfad</label><input id="usr-path" placeholder="OU=...,{{DOMAIN_DN}}"></div>
            <div class="form-row">
                <div class="form-check"><input type="checkbox" id="usr-enabled"><label for="usr-enabled">Aktiviert</label></div>
            </div>
            <div class="modal-actions">
                <button class="btn btn-outline" onclick="hideModal('user-modal')">Abbrechen</button>
                <button class="btn btn-primary" onclick="addUser()">Hinzufuegen</button>
            </div>
        </div>
    </div>

    <div class="toast-container" id="toast-container"></div>

    <script>
        // === State ===
        let config = { ous: [], groups: [], users: [], acls: [] };

        // === Navigation ===
        document.querySelectorAll('.nav-item[data-page]').forEach(item => {
            item.addEventListener('click', () => {
                document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
                item.classList.add('active');
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                document.getElementById('page-' + item.dataset.page).classList.add('active');
                if (item.dataset.page === 'dashboard') loadDashboard();
            });
        });

        // === Toast ===
        function showToast(msg, type = 'success') {
            const c = document.getElementById('toast-container');
            const t = document.createElement('div');
            t.className = 'toast toast-' + type;
            t.textContent = msg;
            c.appendChild(t);
            setTimeout(() => t.remove(), 4000);
        }

        // === Modal ===
        function showModal(id) { document.getElementById(id).classList.add('show'); }
        function hideModal(id) { document.getElementById(id).classList.remove('show'); }

        // === API Calls ===
        async function api(url, method = 'GET', body = null) {
            const opts = { method, headers: { 'Content-Type': 'application/json' } };
            if (body) opts.body = JSON.stringify(body);
            const r = await fetch(url, opts);
            return r.json();
        }

        // === Load Data ===
        async function loadAll() {
            try {
                const [ous, groups, users, acls] = await Promise.all([
                    api('/api/config/tiermodel-ous.json'),
                    api('/api/config/tiermodel-groups.json'),
                    api('/api/config/tiermodel-users.json'),
                    api('/api/config/tiermodel-acls.json')
                ]);
                config.ous = ous.organizationUnits || [];
                config.groups = groups.groups || [];
                config.users = users.users || [];
                config.acls = acls.aclDelegations || [];
                renderOUS();
                renderGroups();
                renderUsers();
                renderACLs();
                loadDashboard();
            } catch (e) {
                showToast('Fehler beim Laden: ' + e.message, 'error');
            }
        }

        // === Dashboard ===
        function loadDashboard() {
            const grid = document.getElementById('stats-grid');
            const tiers = { t0: 0, t1: 0, t2: 0, admin: 0 };
            config.ous.forEach(ou => {
                const n = ou.name.toLowerCase();
                if (n.includes('tier 0')) tiers.t0++;
                else if (n.includes('tier 1')) tiers.t1++;
                else if (n.includes('tier 2')) tiers.t2++;
                else tiers.admin++;
            });
            grid.innerHTML = `
                <div class="stat-card"><div class="label">OUs gesamt</div><div class="value">${config.ous.length}</div></div>
                <div class="stat-card"><div class="label">Gruppen</div><div class="value">${config.groups.length}</div></div>
                <div class="stat-card"><div class="label">Benutzer</div><div class="value">${config.users.length}</div></div>
                <div class="stat-card"><div class="label">ACLs</div><div class="value">${config.acls.length}</div></div>
                <div class="stat-card"><div class="label">Tier 0 OUs</div><div class="value t0">${tiers.t0}</div></div>
                <div class="stat-card"><div class="label">Tier 1 OUs</div><div class="value t1">${tiers.t1}</div></div>
                <div class="stat-card"><div class="label">Tier 2 OUs</div><div class="value t2">${tiers.t2}</div></div>
                <div class="stat-card"><div class="label">Admin OUs</div><div class="value admin">${tiers.admin}</div></div>
            `;
            renderOUTree();
        }

        // === OU Tree ===
        function renderOUTree() {
            const tree = document.getElementById('ou-tree');
            const ous = config.ous;
            const rootOUs = ous.filter(ou => ou.path === '{{DOMAIN_DN}}');

            function buildChildren(parentPath) {
                const children = ous.filter(ou => ou.path && ou.path.startsWith('OU=') && ou.path.includes(parentPath) && ou.path !== parentPath);
                return children;
            }

            function getDirectChildren(parentName) {
                return ous.filter(ou => {
                    if (!ou.path) return false;
                    if (ou.path === '{{DOMAIN_DN}}') return false;
                    const parentRef = 'OU=' + parentName;
                    return ou.path === parentRef || ou.path.startsWith(parentRef + ',');
                });
            }

            function buildTree(parentOUs, depth = 0) {
                if (parentOUs.length === 0) return '';
                let html = '<ul>';
                parentOUs.forEach(ou => {
                    const tierBadge = getTierBadge(ou.name);
                    const children = getDirectChildren(ou.name);
                    html += `<li>
                        <span class="ou-node">
                            <span class="ou-icon">&#128193;</span>
                            <span class="ou-name">${esc(ou.name)}</span>
                            ${tierBadge}
                        </span>
                        ${buildTree(children, depth + 1)}
                    </li>`;
                });
                html += '</ul>';
                return html;
            }

            tree.innerHTML = buildTree(rootOUs);
        }

        function getTierBadge(name) {
            const n = name.toLowerCase();
            if (n.includes('tier 0')) return '<span class="ou-tag badge-t0">T0</span>';
            if (n.includes('tier 1')) return '<span class="ou-tag badge-t1">T1</span>';
            if (n.includes('tier 2')) return '<span class="ou-tag badge-t2">T2</span>';
            if (n.includes('tier model') || n.includes('paw')) return '<span class="ou-tag badge-admin">Admin</span>';
            return '';
        }

        // === Render Tables ===
        function renderOUS(filter = '') {
            const f = filter.toLowerCase();
            const data = config.ous.filter(ou => !f || ou.name.toLowerCase().includes(f));
            document.getElementById('ou-table').innerHTML = `
                <table>
                    <thead><tr><th>Name</th><th>Pfad</th><th>Schutz</th><th>GPO-Block</th><th>Kommentar</th><th></th></tr></thead>
                    <tbody>${data.map((ou, i) => `
                        <tr>
                            <td><strong>${esc(ou.name)}</strong></td>
                            <td style="font-size:11px;color:var(--text2)">${esc(ou.path)}</td>
                            <td>${ou.protectFromAccidentalDeletion ? '<span class="badge badge-green">Ja</span>' : '<span class="badge badge-red">Nein</span>'}</td>
                            <td>${ou.blockGpoInheritance ? '<span class="badge badge-green">Ja</span>' : '-'}</td>
                            <td style="font-size:11px">${esc(ou.comment || '')}</td>
                            <td><button class="btn btn-danger btn-sm" onclick="removeOU(${i})">X</button></td>
                        </tr>
                    `).join('')}</tbody>
                </table>`;
        }

        function renderGroups(filter = '') {
            const f = filter.toLowerCase();
            const data = config.groups.filter(g => !f || g.name.toLowerCase().includes(f) || g.samaccountname.toLowerCase().includes(f));
            document.getElementById('group-table').innerHTML = `
                <table>
                    <thead><tr><th>Name</th><th>SamAccountName</th><th>Scope</th><th>Kategorie</th><th>Pfad</th><th></th></tr></thead>
                    <tbody>${data.map((g, i) => `
                        <tr>
                            <td><strong>${esc(g.name)}</strong></td>
                            <td><code style="color:var(--accent)">${esc(g.samaccountname)}</code></td>
                            <td><span class="badge ${g.groupscope === 'Universal' ? 'badge-admin' : 'badge-t1'}">${g.groupscope}</span></td>
                            <td>${g.groupcategory}</td>
                            <td style="font-size:11px;color:var(--text2)">${esc(g.path || '')}</td>
                            <td><button class="btn btn-danger btn-sm" onclick="removeGroup(${i})">X</button></td>
                        </tr>
                    `).join('')}</tbody>
                </table>`;
        }

        function renderUsers(filter = '') {
            const f = filter.toLowerCase();
            const data = config.users.filter(u => !f || u.samAccountName.toLowerCase().includes(f) || u.displayName.toLowerCase().includes(f));
            document.getElementById('user-table').innerHTML = `
                <table>
                    <thead><tr><th>DisplayName</th><th>SamAccountName</th><th>Status</th><th>Pfad</th><th>Beschreibung</th><th></th></tr></thead>
                    <tbody>${data.map((u, i) => `
                        <tr>
                            <td><strong>${esc(u.displayName || u.name)}</strong></td>
                            <td><code style="color:var(--accent)">${esc(u.samAccountName)}</code></td>
                            <td><span class="badge ${u.enabled ? 'badge-enabled' : 'badge-disabled'}">${u.enabled ? 'Aktiv' : 'Inaktiv'}</span></td>
                            <td style="font-size:11px;color:var(--text2)">${esc(u.ouPath || u.path || '')}</td>
                            <td style="font-size:11px">${esc(u.description || '')}</td>
                            <td><button class="btn btn-danger btn-sm" onclick="removeUser(${i})">X</button></td>
                        </tr>
                    `).join('')}</tbody>
                </table>`;
        }

        function renderACLs(filter = '') {
            const f = filter.toLowerCase();
            const data = config.acls.filter(a => !f || a.targetOUPath.toLowerCase().includes(f) || a.identityreference.toLowerCase().includes(f));
            document.getElementById('acl-table').innerHTML = `
                <table>
                    <thead><tr><th>OU-Pfad</th><th>Principal</th><th>Rechte</th><th>Typ</th><th>Objekttyp</th><th></th></tr></thead>
                    <tbody>${data.map((a, i) => `
                        <tr>
                            <td style="font-size:11px;color:var(--text2)">${esc(a.targetOUPath)}</td>
                            <td><strong>${esc(a.identityreference)}</strong></td>
                            <td style="font-size:11px">${(a.activedirectoryrights || []).join(', ')}</td>
                            <td><span class="badge ${a.accesscontroltype === 'Allow' ? 'badge-green' : 'badge-red'}">${a.accesscontroltype}</span></td>
                            <td style="font-size:11px">${esc(a.objecttype || '-')}</td>
                            <td><button class="btn btn-danger btn-sm" onclick="removeACL(${i})">X</button></td>
                        </tr>
                    `).join('')}</tbody>
                </table>`;
        }

        // === Add/Remove ===
        function addOU() {
            config.ous.push({
                name: document.getElementById('ou-name').value,
                path: document.getElementById('ou-path').value || '{{DOMAIN_DN}}',
                protectFromAccidentalDeletion: document.getElementById('ou-protect').checked,
                disableInheritance: false,
                blockGpoInheritance: document.getElementById('ou-blockgpo').checked,
                comment: document.getElementById('ou-comment').value
            });
            hideModal('ou-modal');
            renderOUS(); loadDashboard();
            showToast('OU hinzugefuegt');
        }

        function addGroup() {
            config.groups.push({
                name: document.getElementById('grp-name').value,
                samaccountname: document.getElementById('grp-sam').value,
                description: document.getElementById('grp-desc').value,
                groupscope: document.getElementById('grp-scope').value,
                groupcategory: document.getElementById('grp-cat').value,
                path: document.getElementById('grp-path').value
            });
            hideModal('group-modal');
            renderGroups(); loadDashboard();
            showToast('Gruppe hinzugefuegt');
        }

        function addUser() {
            config.users.push({
                samAccountName: document.getElementById('usr-sam').value,
                displayName: document.getElementById('usr-display').value,
                description: document.getElementById('usr-desc').value,
                ouPath: document.getElementById('usr-path').value,
                enabled: document.getElementById('usr-enabled').checked
            });
            hideModal('user-modal');
            renderUsers(); loadDashboard();
            showToast('Benutzer hinzugefuegt');
        }

        function removeOU(i) { config.ous.splice(i, 1); renderOUS(); loadDashboard(); }
        function removeGroup(i) { config.groups.splice(i, 1); renderGroups(); loadDashboard(); }
        function removeUser(i) { config.users.splice(i, 1); renderUsers(); loadDashboard(); }
        function removeACL(i) { config.acls.splice(i, 1); renderACLs(); }

        // === Save ===
        async function saveConfig(type) {
            let payload;
            switch(type) {
                case 'ous': payload = { version: '1.0.0', organizationUnits: config.ous }; break;
                case 'groups': payload = { version: '1.0.0', groups: config.groups }; break;
                case 'users': payload = { version: '1.0.0', users: config.users }; break;
                case 'acls': payload = { version: '1.0.0', aclDelegations: config.acls }; break;
            }
            const file = 'tiermodel-' + (type === 'acls' ? 'acls' : type) + '.json';
            try {
                const r = await api('/api/config/' + file, 'POST', payload);
                if (r.success) showToast('Gespeichert: ' + file);
                else showToast('Fehler: ' + r.message, 'error');
            } catch(e) { showToast('Fehler: ' + e.message, 'error'); }
        }

        // === JSON Editor ===
        async function loadConfigEditor() {
            const file = document.getElementById('config-file-select').value;
            try {
                const r = await api('/api/config/' + file);
                document.getElementById('json-editor').value = JSON.stringify(r, null, 2);
            } catch(e) { showToast('Fehler: ' + e.message, 'error'); }
        }

        async function saveConfigEditor() {
            const file = document.getElementById('config-file-select').value;
            try {
                const data = JSON.parse(document.getElementById('json-editor').value);
                const r = await api('/api/config/' + file, 'POST', data);
                if (r.success) { showToast('Gespeichert: ' + file); loadAll(); }
                else showToast('Fehler: ' + r.message, 'error');
            } catch(e) { showToast('Fehler: ' + e.message, 'error'); }
        }

        // === Deploy/Audit ===
        async function runDeploy() {
            const btn = document.getElementById('btn-deploy');
            const out = document.getElementById('deploy-output');
            btn.disabled = true; btn.textContent = 'Deploy laeuft...';
            out.innerHTML = '<span class="line-info">Starte Deploy...</span>\n';
            try {
                const r = await api('/api/deploy', 'POST', {
                    whatif: document.getElementById('opt-whatif').checked,
                    confirm: document.getElementById('opt-confirm').checked,
                    msa: document.getElementById('opt-msa').checked,
                    gmsa: document.getElementById('opt-gmsa').checked,
                    dmsa: document.getElementById('opt-dmsa').checked,
                    winlaps: document.getElementById('opt-winlaps').checked
                });
                out.innerHTML += (r.output || []).map(l => {
                    const cls = l.type === 'error' ? 'line-error' : l.type === 'warn' ? 'line-warn' : '';
                    return `<span class="${cls}">${esc(l.text)}</span>`;
                }).join('\n');
                if (r.success) showToast('Deploy abgeschlossen');
                else showToast('Deploy fehlgeschlagen', 'error');
            } catch(e) { out.innerHTML += `<span class="line-error">Fehler: ${esc(e.message)}</span>`; }
            btn.disabled = false; btn.textContent = 'Deploy starten';
        }

        async function runAudit() {
            const btn = document.getElementById('btn-audit');
            const out = document.getElementById('audit-output');
            btn.disabled = true; btn.textContent = 'Audit laeuft...';
            out.innerHTML = '<span class="line-info">Starte Audit...</span>\n';
            try {
                const r = await api('/api/audit', 'POST');
                out.innerHTML += (r.output || []).map(l => {
                    const cls = l.type === 'error' ? 'line-error' : l.type === 'warn' ? 'line-warn' : '';
                    return `<span class="${cls}">${esc(l.text)}</span>`;
                }).join('\n');
                if (r.success) showToast('Audit abgeschlossen');
                else showToast('Audit fehlgeschlagen', 'error');
            } catch(e) { out.innerHTML += `<span class="line-error">Fehler: ${esc(e.message)}</span>`; }
            btn.disabled = false; btn.textContent = 'Audit starten';
        }

        // === Search ===
        document.getElementById('ou-search').addEventListener('input', e => renderOUS(e.target.value));
        document.getElementById('group-search').addEventListener('input', e => renderGroups(e.target.value));
        document.getElementById('user-search').addEventListener('input', e => renderUsers(e.target.value));
        document.getElementById('acl-search').addEventListener('input', e => renderACLs(e.target.value));

        // === Helper ===
        function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

        // === Init ===
        loadAll();
        loadConfigEditor();
    </script>
</body>
</html>
'@

# === Passwort-Generierung (aus AD-User Script) ===
function New-ADCompliantPassword {
    $upper   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    $lower   = 'abcdefghijklmnopqrstuvwxyz'
    $digits  = '0123456789'
    $special = '!@#$%^&*()-_=+[]{}|;:,.<>?'
    $all     = "$upper$lower$digits$special"
    $password  = @()
    $password += $upper.ToCharArray()   | Get-Random -Count 2
    $password += $lower.ToCharArray()   | Get-Random -Count 2
    $password += $digits.ToCharArray()  | Get-Random -Count 2
    $password += $special.ToCharArray() | Get-Random -Count 2
    $password += $all.ToCharArray()     | Get-Random -Count 8
    return -join ($password | Sort-Object { Get-Random })
}

# === JSON Hilfsfunktionen ===
function Read-ConfigFile {
    param([string]$FileName)
    $path = Join-Path $TierModelRoot "config\$FileName"
    if (Test-Path $path) {
        return Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    return $null
}

function Write-ConfigFile {
    param([string]$FileName, [object]$Data)
    $path = Join-Path $TierModelRoot "config\$FileName"
    $Data | ConvertTo-Json -Depth 20 | Set-Content $path -Encoding UTF8
    return $true
}

# === HTTP Listener ===
$Listener = [System.Net.HttpListener]::new()
$Listener.Prefixes.Add("http://localhost:${Port}/")
$Listener.Start()

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Tier Model Manager"                     -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Server: http://localhost:$Port"          -ForegroundColor Green
Write-Host " Config: $TierModelRoot\config"           -ForegroundColor Green
Write-Host " Beenden: Ctrl+C"                         -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Start-Process "http://localhost:$Port"

try {
    while ($Listener.IsListening) {
        $Context = $Listener.GetContext()
        $Request = $Context.Request
        $Response = $Context.Response

        $Response.ContentType = "application/json; charset=utf-8"
        $Response.Headers.Add("Access-Control-Allow-Origin", "*")

        # CORS Preflight
        if ($Request.HttpMethod -eq "OPTIONS") {
            $Response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            $Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
            $Response.StatusCode = 200
            $Response.Close()
            continue
        }

        $url = $Request.Url.LocalPath
        $json = $null

        try {
            if ($url -eq "/" -and $Request.HttpMethod -eq "GET") {
                $Response.ContentType = "text/html; charset=utf-8"
                $buffer = [System.Text.Encoding]::UTF8.GetBytes($HtmlPage)
                $Response.ContentLength64 = $buffer.Length
                $Response.OutputStream.Write($buffer, 0, $buffer.Length)
                $Response.Close()
                continue
            }
            elseif ($url -match '^/api/config/(.+)$' -and $Request.HttpMethod -eq "GET") {
                $fileName = $Matches[1]
                $data = Read-ConfigFile $fileName
                if ($data) { $json = $data | ConvertTo-Json -Depth 20 }
                else { $json = '{"error":"File not found"}'; $Response.StatusCode = 404 }
            }
            elseif ($url -match '^/api/config/(.+)$' -and $Request.HttpMethod -eq "POST") {
                $fileName = $Matches[1]
                $reader = [System.IO.StreamReader]::new($Request.InputStream, $Request.ContentEncoding)
                $body = $reader.ReadToEnd()
                $reader.Close()
                $data = $body | ConvertFrom-Json
                $path = Join-Path $TierModelRoot "config\$fileName"
                $body | Set-Content $path -Encoding UTF8
                $json = '{"success":true,"message":"Saved"}'
            }
            elseif ($url -eq "/api/deploy" -and $Request.HttpMethod -eq "POST") {
                $reader = [System.IO.StreamReader]::new($Request.InputStream, $Request.ContentEncoding)
                $body = $reader.ReadToEnd() | ConvertFrom-Json
                $reader.Close()

                $deployScript = Join-Path $TierModelRoot "Deploy-TierModel.ps1"
                $output = @()

                if (Test-Path $deployScript) {
                    $params = @{}
                    if ($body.whatif) { $params['WhatIf'] = $true }
                    if ($body.confirm) { $params['ConfirmApply'] = $true }
                    if ($body.msa) { $params['IncludeMsa'] = $true }
                    if ($body.gmsa) { $params['IncludeGmsa'] = $true }
                    if ($body.dmsa) { $params['IncludeDmsa'] = $true }
                    if ($body.winlaps) { $params['IncludeWinLaps'] = $true }

                    try {
                        $result = & $deployScript @params 2>&1
                        $result | ForEach-Object {
                            $type = 'info'
                            if ($_ -match 'error|fail') { $type = 'error' }
                            elseif ($_ -match 'warn') { $type = 'warn' }
                            $output += @{ text = $_.ToString(); type = $type }
                        }
                        $json = @{ success = $true; output = $output } | ConvertTo-Json -Depth 5
                    }
                    catch {
                        $output += @{ text = $_.Exception.Message; type = 'error' }
                        $json = @{ success = $false; output = $output } | ConvertTo-Json -Depth 5
                    }
                }
                else {
                    $output += @{ text = "Deploy-TierModel.ps1 nicht gefunden in $TierModelRoot"; type = 'error' }
                    $json = @{ success = $false; output = $output } | ConvertTo-Json -Depth 5
                }
            }
            elseif ($url -eq "/api/audit" -and $Request.HttpMethod -eq "POST") {
                $auditScript = Join-Path $TierModelRoot "Audit-TierModel.ps1"
                $output = @()

                if (Test-Path $auditScript) {
                    try {
                        $result = & $auditScript 2>&1
                        $result | ForEach-Object {
                            $type = 'info'
                            if ($_ -match 'error|fail|drift') { $type = 'error' }
                            elseif ($_ -match 'warn') { $type = 'warn' }
                            $output += @{ text = $_.ToString(); type = $type }
                        }
                        $json = @{ success = $true; output = $output } | ConvertTo-Json -Depth 5
                    }
                    catch {
                        $output += @{ text = $_.Exception.Message; type = 'error' }
                        $json = @{ success = $false; output = $output } | ConvertTo-Json -Depth 5
                    }
                }
                else {
                    $output += @{ text = "Audit-TierModel.ps1 nicht gefunden in $TierModelRoot"; type = 'error' }
                    $json = @{ success = $false; output = $output } | ConvertTo-Json -Depth 5
                }
            }
            else {
                $json = '{"error":"Not Found"}'
                $Response.StatusCode = 404
            }
        }
        catch {
            $json = @{ success = $false; message = $_.Exception.Message } | ConvertTo-Json
            $Response.StatusCode = 500
        }

        if ($json) {
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
            $Response.ContentLength64 = $buffer.Length
            $Response.OutputStream.Write($buffer, 0, $buffer.Length)
        }
        $Response.Close()
    }
}
finally {
    $Listener.Stop()
    $Listener.Dispose()
    Write-Host "Server beendet." -ForegroundColor Red
}
