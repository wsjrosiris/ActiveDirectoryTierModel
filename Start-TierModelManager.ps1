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
            --bg: #ffffff; --surface: #ffffff; --surface2: #f5f5f5; --surface3: #ededed;
            --border: #ededed; --border-hover: #cdcdcd; --border-focus: #188ded;
            --text: #1a1818; --text2: #323232; --text3: #666666; --text4: #999999;
            --sidebar-bg: #1a1818; --sidebar-text: #ededed; --sidebar-text2: #818181;
            --sidebar-hover: #323232; --sidebar-active: #f7b748; --sidebar-active-bg: rgba(247,183,72,0.12);
            --accent: #188ded; --accent-hover: #0d7bd6; --accent-surface: rgba(24,141,237,0.08);
            --green: #02cd98; --green-light: #cdf5eb; --green-surface: rgba(2,205,152,0.08);
            --red: #e5484d; --red-surface: rgba(229,72,77,0.08);
            --orange: #f7b748; --orange-surface: rgba(247,183,72,0.10);
            --tier0: #e5484d; --tier1: #f7b748; --tier2: #02cd98; --tierAdmin: #188ded;
            --radius: 10px; --radius-sm: 6px; --radius-lg: 14px;
            --shadow: 0 1px 3px rgba(0,0,0,0.06); --shadow-md: 0 4px 12px rgba(0,0,0,0.08); --shadow-lg: 0 8px 24px rgba(0,0,0,0.12);
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; line-height: 1.5; }
        .skip-link { position: absolute; left: -999px; width: 1px; height: 1px; overflow: hidden; z-index: 9999; padding: 12px 24px; background: var(--accent); color: #fff; font-weight: 600; border-radius: var(--radius); text-decoration: none; }
        .skip-link:focus { left: 16px; top: 16px; width: auto; height: auto; }
        :focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
        .sidebar { position: fixed; left: 0; top: 0; bottom: 0; width: 260px; background: var(--sidebar-bg); display: flex; flex-direction: column; z-index: 100; }
        .sidebar-header { padding: 28px 24px 20px; }
        .sidebar-header h1 { font-size: 18px; color: #fff; font-weight: 700; }
        .sidebar-header p { font-size: 11px; color: var(--sidebar-text2); margin-top: 4px; }
        .sidebar nav { flex: 1; padding: 8px 12px; overflow-y: auto; }
        .nav-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: var(--radius); cursor: pointer; color: var(--sidebar-text2); font-size: 13px; font-weight: 500; margin-bottom: 2px; transition: all 0.15s; min-height: 40px; }
        .nav-item:hover { background: var(--sidebar-hover); color: var(--sidebar-text); }
        .nav-item.active { background: var(--sidebar-active-bg); color: var(--sidebar-active); }
        .nav-item .icon { font-size: 15px; width: 20px; text-align: center; flex-shrink: 0; }
        .nav-sep { height: 1px; background: rgba(255,255,255,0.08); margin: 8px 14px; }
        .sidebar-footer { padding: 16px 24px; font-size: 11px; color: var(--sidebar-text2); }
        .main { margin-left: 260px; padding: 32px 40px; min-height: 100vh; background: var(--bg); }
        .page { display: none; } .page.active { display: block; }
        .page-title { font-size: 24px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 28px; color: var(--text); }
        .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 24px; margin-bottom: 20px; box-shadow: var(--shadow); }
        .card h2 { font-size: 15px; margin-bottom: 16px; color: var(--text); font-weight: 600; }
        .card h3 { font-size: 12px; margin-bottom: 12px; color: var(--text3); font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 28px; }
        .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px; transition: all 0.2s; box-shadow: var(--shadow); }
        .stat-card:hover { border-color: var(--border-hover); box-shadow: var(--shadow-md); transform: translateY(-1px); }
        .stat-card .label { font-size: 11px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; }
        .stat-card .value { font-size: 28px; font-weight: 700; margin-top: 6px; letter-spacing: -0.5px; }
        .stat-card .value.t0 { color: var(--tier0); } .stat-card .value.t1 { color: var(--tier1); }
        .stat-card .value.t2 { color: var(--tier2); } .stat-card .value.admin { color: var(--tierAdmin); }
        .table-wrap { overflow-x: auto; border-radius: var(--radius); border: 1px solid var(--border); }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; padding: 12px 16px; color: var(--text3); font-weight: 600; border-bottom: 1px solid var(--border); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; background: var(--surface2); }
        td { padding: 12px 16px; border-bottom: 1px solid var(--border); color: var(--text); }
        tr:last-child td { border-bottom: none; } tr:hover td { background: var(--surface2); }
        .badge { display: inline-block; padding: 3px 10px; border-radius: 100px; font-size: 11px; font-weight: 600; }
        .badge-t0 { background: var(--red-surface); color: var(--tier0); } .badge-t1 { background: var(--orange-surface); color: var(--tier1); }
        .badge-t2 { background: var(--green-surface); color: var(--tier2); } .badge-admin { background: var(--accent-surface); color: var(--tierAdmin); }
        .badge-green { background: var(--green-surface); color: var(--green); } .badge-red { background: var(--red-surface); color: var(--red); }
        .badge-enabled { background: var(--green-surface); color: var(--green); } .badge-disabled { background: var(--surface2); color: var(--text3); }
        .btn { padding: 9px 18px; border-radius: var(--radius); border: none; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; display: inline-flex; align-items: center; gap: 6px; min-height: 38px; }
        .btn-primary { background: var(--accent); color: #fff; } .btn-primary:hover { background: var(--accent-hover); box-shadow: var(--shadow-md); }
        .btn-success { background: var(--green); color: #fff; } .btn-success:hover { filter: brightness(0.95); box-shadow: var(--shadow-md); }
        .btn-danger { background: var(--red-surface); color: var(--red); border: 1px solid rgba(229,72,77,0.15); } .btn-danger:hover { background: rgba(229,72,77,0.15); }
        .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text2); } .btn-outline:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-surface); }
        .btn-sm { padding: 5px 10px; font-size: 11px; min-height: 28px; }
        .form-group { margin-bottom: 16px; } .form-group label { display: block; font-size: 12px; color: var(--text3); margin-bottom: 6px; font-weight: 600; }
        .form-group input, .form-group select { width: 100%; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); font-size: 13px; font-family: inherit; transition: all 0.15s; }
        .form-group input:focus, .form-group select:focus { outline: none; border-color: var(--border-focus); box-shadow: 0 0 0 3px rgba(24,141,237,0.12); }
        .form-group input::placeholder { color: var(--text4); }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; } .form-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
        .form-check { display: flex; align-items: center; gap: 8px; min-height: 38px; } .form-check input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--accent); cursor: pointer; } .form-check label { font-size: 13px; color: var(--text); cursor: pointer; }
        .ou-tree { font-size: 13px; } .ou-tree ul { list-style: none; padding-left: 20px; } .ou-tree > ul { padding-left: 0; }
        .ou-tree li { position: relative; padding: 4px 0; } .ou-tree li::before { content: ''; position: absolute; left: -16px; top: 0; bottom: 0; width: 1px; background: var(--border); } .ou-tree li::after { content: ''; position: absolute; left: -16px; top: 14px; width: 12px; height: 1px; background: var(--border); }
        .ou-node { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: var(--radius-sm); } .ou-node .ou-icon { font-size: 14px; } .ou-node .ou-name { font-weight: 500; color: var(--text); } .ou-node .ou-tag { font-size: 10px; padding: 2px 7px; border-radius: 100px; font-weight: 600; }
        .terminal { background: var(--sidebar-bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; font-family: 'Cascadia Code', 'Consolas', monospace; font-size: 12px; line-height: 1.7; max-height: 400px; overflow-y: auto; color: var(--green); }
        .terminal .line-error { color: var(--red); } .terminal .line-warn { color: var(--orange); } .terminal .line-info { color: var(--accent); }
        .toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 10px; } .toolbar-right { display: flex; gap: 8px; align-items: center; }
        .search-box { padding: 9px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); font-size: 13px; width: 260px; transition: all 0.15s; } .search-box:focus { outline: none; border-color: var(--border-focus); box-shadow: 0 0 0 3px rgba(24,141,237,0.12); } .search-box::placeholder { color: var(--text4); }
        .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(26,24,24,0.5); z-index: 1000; align-items: center; justify-content: center; backdrop-filter: blur(4px); } .modal-overlay.show { display: flex; }
        .modal { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 28px; width: 90%; max-width: 600px; max-height: 85vh; overflow-y: auto; box-shadow: var(--shadow-lg); } .modal h2 { margin-bottom: 20px; font-size: 18px; font-weight: 700; color: var(--text); }
        .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border); }
        .config-tabs { display: flex; gap: 2px; margin-bottom: 20px; background: var(--surface2); border-radius: var(--radius); padding: 4px; }
        .config-tab { padding: 8px 18px; border-radius: var(--radius-sm); cursor: pointer; font-size: 12px; font-weight: 600; color: var(--text3); transition: all 0.15s; border: none; background: transparent; min-height: 36px; } .config-tab:hover { color: var(--text); background: var(--surface3); } .config-tab.active { color: var(--text); background: var(--surface); box-shadow: var(--shadow); }
        .config-panel { display: none; } .config-panel.active { display: block; }
        .config-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
        .config-item { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px; transition: all 0.2s; box-shadow: var(--shadow); } .config-item:hover { border-color: var(--accent); box-shadow: var(--shadow-md); }
        .config-item .item-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--border); } .config-item .item-title { font-weight: 600; font-size: 14px; color: var(--text); }
        .config-item .item-fields { display: flex; flex-direction: column; gap: 10px; } .config-item .field-row { display: flex; gap: 8px; align-items: center; }
        .config-item .field-label { font-size: 10px; color: var(--text4); min-width: 80px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
        .config-item .field-value { flex: 1; padding: 7px 10px; background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 12px; color: var(--text); font-family: inherit; transition: all 0.15s; } .config-item .field-value:focus { outline: none; border-color: var(--border-focus); box-shadow: 0 0 0 2px rgba(24,141,237,0.12); }
        .config-item select.field-value { cursor: pointer; } .config-item .field-check { display: flex; align-items: center; gap: 6px; } .config-item .field-check input { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; } .config-item .field-check label { font-size: 11px; color: var(--text3); cursor: pointer; }
        .rights-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; } .rights-grid label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text); cursor: pointer; min-height: 32px; } .rights-grid input { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; }
        .toast-container { position: fixed; top: 20px; right: 20px; z-index: 2000; display: flex; flex-direction: column; gap: 8px; }
        .toast { padding: 12px 20px; border-radius: var(--radius); font-size: 13px; font-weight: 600; animation: slideIn 0.25s ease; box-shadow: var(--shadow-lg); }
        .toast-success { background: var(--green); color: #fff; } .toast-error { background: var(--red); color: #fff; }
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .toast { animation: none; } }

        /* === Phase 1 & 2: New Components === */

        /* Search Modal (Ctrl+K) */
        .search-overlay { display: none; position: fixed; inset: 0; background: rgba(26,24,24,0.5); z-index: 2000; align-items: flex-start; justify-content: center; padding-top: 15vh; backdrop-filter: blur(4px); }
        .search-overlay.show { display: flex; }
        .search-modal { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); width: 90%; max-width: 560px; max-height: 60vh; overflow: hidden; box-shadow: var(--shadow-lg); }
        .search-input-wrap { display: flex; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--border); }
        .search-input-wrap .search-icon { font-size: 18px; color: var(--text3); flex-shrink: 0; }
        .search-input-wrap input { flex: 1; border: none; outline: none; font-size: 15px; background: transparent; color: var(--text); }
        .search-input-wrap input::placeholder { color: var(--text4); }
        .search-input-wrap kbd { font-size: 11px; padding: 2px 6px; background: var(--surface2); border: 1px solid var(--border); border-radius: 4px; color: var(--text3); font-family: inherit; }
        .search-results { max-height: calc(60vh - 60px); overflow-y: auto; padding: 8px; }
        .search-group-label { font-size: 10px; color: var(--text4); text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; padding: 8px 12px 4px; }
        .search-result { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: var(--radius-sm); cursor: pointer; transition: background 0.1s; }
        .search-result:hover, .search-result.active { background: var(--accent-surface); }
        .search-result .result-icon { font-size: 16px; width: 24px; text-align: center; flex-shrink: 0; }
        .search-result .result-info { flex: 1; min-width: 0; }
        .search-result .result-name { font-size: 13px; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .search-result .result-path { font-size: 11px; color: var(--text3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .search-result .result-badge { font-size: 9px; padding: 2px 6px; border-radius: 100px; font-weight: 600; flex-shrink: 0; }
        .search-empty { padding: 24px; text-align: center; color: var(--text3); font-size: 13px; }

        /* Command Palette */
        .cmd-palette { display: none; position: fixed; inset: 0; background: rgba(26,24,24,0.5); z-index: 2000; align-items: flex-start; justify-content: center; padding-top: 20vh; backdrop-filter: blur(4px); }
        .cmd-palette.show { display: flex; }
        .cmd-modal { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); width: 90%; max-width: 480px; overflow: hidden; box-shadow: var(--shadow-lg); }
        .cmd-result { display: flex; align-items: center; gap: 12px; padding: 10px 16px; cursor: pointer; transition: background 0.1s; }
        .cmd-result:hover, .cmd-result.active { background: var(--accent-surface); }
        .cmd-result .cmd-icon { font-size: 16px; width: 24px; text-align: center; }
        .cmd-result .cmd-label { flex: 1; font-size: 13px; color: var(--text); }
        .cmd-result .cmd-shortcut { font-size: 11px; color: var(--text3); }
        .cmd-sep { padding: 4px 16px; font-size: 10px; color: var(--text4); text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; }

        /* Diff View */
        .diff-overlay { display: none; position: fixed; inset: 0; background: rgba(26,24,24,0.5); z-index: 2000; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
        .diff-overlay.show { display: flex; }
        .diff-modal { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); width: 90%; max-width: 700px; max-height: 80vh; overflow: hidden; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; }
        .diff-header { padding: 20px 24px; border-bottom: 1px solid var(--border); }
        .diff-header h2 { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
        .diff-header p { font-size: 12px; color: var(--text3); }
        .diff-body { flex: 1; overflow-y: auto; padding: 16px 24px; }
        .diff-section { margin-bottom: 20px; }
        .diff-section-title { font-size: 12px; font-weight: 600; color: var(--text2); margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
        .diff-item { padding: 10px 14px; border-radius: var(--radius-sm); margin-bottom: 6px; font-size: 12px; line-height: 1.5; }
        .diff-add { background: rgba(2,205,152,0.08); border-left: 3px solid var(--green); }
        .diff-remove { background: rgba(229,72,77,0.08); border-left: 3px solid var(--red); }
        .diff-change { background: rgba(247,183,72,0.10); border-left: 3px solid var(--orange); }
        .diff-footer { padding: 16px 24px; border-top: 1px solid var(--border); display: flex; gap: 8px; justify-content: flex-end; }

        /* Audit Log */
        .audit-log { max-height: 300px; overflow-y: auto; }
        .audit-entry { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }
        .audit-entry:last-child { border-bottom: none; }
        .audit-time { font-size: 11px; color: var(--text3); min-width: 50px; flex-shrink: 0; }
        .audit-icon { font-size: 14px; width: 20px; text-align: center; flex-shrink: 0; }
        .audit-content { flex: 1; }
        .audit-action { font-size: 12px; font-weight: 500; color: var(--text); }
        .audit-detail { font-size: 11px; color: var(--text3); margin-top: 2px; }

        /* Interactive OU Tree */
        .ou-tree-node { margin-left: 20px; }
        .ou-tree-node.root { margin-left: 0; }
        .ou-tree-row { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: var(--radius-sm); cursor: pointer; transition: background 0.1s; user-select: none; }
        .ou-tree-row:hover { background: var(--surface2); }
        .ou-tree-row .tree-toggle { width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: var(--text3); transition: transform 0.15s; flex-shrink: 0; }
        .ou-tree-row .tree-toggle.expanded { transform: rotate(90deg); }
        .ou-tree-row .tree-toggle.leaf { visibility: hidden; }
        .ou-tree-row .tree-icon { font-size: 14px; flex-shrink: 0; }
        .ou-tree-row .tree-name { font-size: 13px; font-weight: 500; color: var(--text); }
        .ou-tree-row .tree-tag { font-size: 9px; padding: 2px 6px; border-radius: 100px; font-weight: 600; }
        .ou-tree-children { display: none; }
        .ou-tree-children.expanded { display: block; }

        /* Context Menu */
        .context-menu { display: none; position: fixed; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-lg); min-width: 180px; z-index: 3000; padding: 4px; }
        .context-menu.show { display: block; }
        .context-item { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: var(--radius-sm); cursor: pointer; font-size: 12px; color: var(--text); transition: background 0.1s; }
        .context-item:hover { background: var(--accent-surface); }
        .context-item .ctx-icon { font-size: 14px; width: 18px; text-align: center; }
        .context-item.danger { color: var(--red); }
        .context-item.danger:hover { background: var(--red-surface); }
        .context-sep { height: 1px; background: var(--border); margin: 4px 0; }

        /* Validation Panel */
        .validation-panel { margin-bottom: 20px; }
        .validation-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px; border-radius: var(--radius-sm); margin-bottom: 6px; font-size: 12px; }
        .validation-error { background: var(--red-surface); border-left: 3px solid var(--red); }
        .validation-warn { background: var(--orange-surface); border-left: 3px solid var(--orange); }
        .validation-ok { background: var(--green-surface); border-left: 3px solid var(--green); }
        .validation-icon { font-size: 14px; flex-shrink: 0; }
        .validation-text { flex: 1; color: var(--text); }

        @media (max-width: 768px) { .sidebar { width: 60px; } .sidebar-header h1, .sidebar-header p, .nav-item span:not(.icon), .sidebar-footer { display: none; } .main { margin-left: 60px; padding: 16px; } .form-row, .form-row-3 { grid-template-columns: 1fr; } .config-grid { grid-template-columns: 1fr; } .stats-grid { grid-template-columns: repeat(2, 1fr); } }

    </style>
</head>
<body>
    <a href="#main-content" class="skip-link">Zum Inhalt springen</a>
    <div class="sidebar" role="navigation" aria-label="Hauptnavigation">
        <div class="sidebar-header">
            <h1>Tier Model</h1>
            <p>AD Management Console</p>
        </div>
        <nav>
            <div class="nav-item active" data-page="dashboard" role="link" tabindex="0" aria-current="page"><span class="icon" aria-hidden="true">&#9632;</span><span>Dashboard</span></div>
            <div class="nav-sep" role="separator"></div>
            <div class="nav-item" data-page="ous" role="link" tabindex="0"><span class="icon" aria-hidden="true">&#128193;</span><span>Organizational Units</span></div>
            <div class="nav-item" data-page="groups" role="link" tabindex="0"><span class="icon" aria-hidden="true">&#128101;</span><span>Gruppen</span></div>
            <div class="nav-item" data-page="users" role="link" tabindex="0"><span class="icon" aria-hidden="true">&#128100;</span><span>Benutzer</span></div>
            <div class="nav-item" data-page="acls" role="link" tabindex="0"><span class="icon" aria-hidden="true">&#128274;</span><span>ACL Delegationen</span></div>
            <div class="nav-sep" role="separator"></div>
            <div class="nav-item" data-page="config" role="link" tabindex="0"><span class="icon" aria-hidden="true">&#9881;</span><span>Konfiguration</span></div>
            <div class="nav-item" data-page="deploy" role="link" tabindex="0"><span class="icon" aria-hidden="true">&#9654;</span><span>Deploy</span></div>
            <div class="nav-item" data-page="audit" role="link" tabindex="0"><span class="icon" aria-hidden="true">&#128202;</span><span>Audit</span></div>
        </nav>
        <div class="sidebar-footer">v1.4.0 | Ctrl+K Suche | Ctrl+Shift+P Befehle</div>
    </div>

    <main id="main-content" class="main" role="main">
        <!-- Dashboard -->
        <div class="page active" id="page-dashboard" role="region" aria-label="Dashboard">
            <h2 class="page-title">Dashboard</h2>
            <div class="stats-grid" id="stats-grid" aria-label="Statistiken"></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
                <div class="card">
                    <h2>OU Struktur</h2>
                    <div id="ou-tree-interactive" role="tree" aria-label="OU-Baumstruktur"></div>
                </div>
                <div class="card">
                    <h2>Aenderungsprotokoll</h2>
                    <div class="audit-log" id="audit-log">
                        <div class="search-empty" style="padding:20px;">Noch keine Aenderungen protokolliert.</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- OUs -->
        <div class="page" id="page-ous" role="region" aria-label="Organizational Units verwalten">
            <div class="toolbar">
                <h2 class="page-title" style="margin-bottom:0;font-size:18px;">Organizational Units</h2>
                <div class="toolbar-right">
                    <label for="ou-search" class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;">OUs suchen</label>
                    <input class="search-box" placeholder="OUs suchen..." id="ou-search" aria-label="OUs suchen">
                    <button class="btn btn-primary" onclick="showModal('ou-modal')" aria-label="Neue OU hinzufuegen">+ OU hinzufuegen</button>
                    <button class="btn btn-outline" onclick="saveConfig('ous')" aria-label="OUs speichern">Speichern</button>
                </div>
            </div>
            <div class="card"><div class="table-wrap" id="ou-table" role="table" aria-label="OU Uebersicht"></div></div>
        </div>

        <!-- Groups -->
        <div class="page" id="page-groups" role="region" aria-label="Gruppen verwalten">
            <div class="toolbar">
                <h2 class="page-title" style="margin-bottom:0;font-size:18px;">Sicherheitsgruppen</h2>
                <div class="toolbar-right">
                    <input class="search-box" placeholder="Gruppen suchen..." id="group-search" aria-label="Gruppen suchen">
                    <button class="btn btn-primary" onclick="showModal('group-modal')" aria-label="Neue Gruppe hinzufuegen">+ Gruppe hinzufuegen</button>
                    <button class="btn btn-outline" onclick="saveConfig('groups')" aria-label="Gruppen speichern">Speichern</button>
                </div>
            </div>
            <div class="card"><div class="table-wrap" id="group-table" role="table" aria-label="Gruppen Uebersicht"></div></div>
        </div>

        <!-- Users -->
        <div class="page" id="page-users" role="region" aria-label="Benutzer verwalten">
            <div class="toolbar">
                <h2 class="page-title" style="margin-bottom:0;font-size:18px;">Benutzer</h2>
                <div class="toolbar-right">
                    <input class="search-box" placeholder="Benutzer suchen..." id="user-search" aria-label="Benutzer suchen">
                    <button class="btn btn-primary" onclick="showModal('user-modal')" aria-label="Neuen Benutzer hinzufuegen">+ Benutzer hinzufuegen</button>
                    <button class="btn btn-outline" onclick="saveConfig('users')" aria-label="Benutzer speichern">Speichern</button>
                </div>
            </div>
            <div class="card"><div class="table-wrap" id="user-table" role="table" aria-label="Benutzer Uebersicht"></div></div>
        </div>

        <!-- ACLs -->
        <div class="page" id="page-acls" role="region" aria-label="ACL Delegationen verwalten">
            <div class="toolbar">
                <h2 class="page-title" style="margin-bottom:0;font-size:18px;">ACL Delegationen</h2>
                <div class="toolbar-right">
                    <input class="search-box" placeholder="ACLs suchen..." id="acl-search" aria-label="ACLs suchen">
                    <button class="btn btn-primary" onclick="showModal('acl-modal')" aria-label="Neue ACL hinzufuegen">+ ACL hinzufuegen</button>
                    <button class="btn btn-outline" onclick="saveConfig('acls')" aria-label="ACLs speichern">Speichern</button>
                </div>
            </div>
            <div class="card"><div class="table-wrap" id="acl-table" role="table" aria-label="ACL Uebersicht"></div></div>
        </div>

        <!-- Config -->
        <div class="page" id="page-config" role="region" aria-label="Konfiguration verwalten">
            <div class="toolbar">
                <h2 class="page-title" style="margin-bottom:0;font-size:18px;">Konfiguration</h2>
                <div class="toolbar-right">
                    <button class="btn btn-outline" onclick="loadAll()" aria-label="Konfiguration neu laden">Neu laden</button>
                    <button class="btn btn-primary" onclick="saveAllConfigs()" aria-label="Alle Konfigurationen speichern">Alle speichern</button>
                </div>
            </div>
            <div class="config-tabs" role="tablist" aria-label="Konfigurationsbereiche">
                <div class="config-tab active" data-config="cfg-ous" role="tab" tabindex="0" aria-selected="true">OUs</div>
                <div class="config-tab" data-config="cfg-groups" role="tab" tabindex="0" aria-selected="false">Gruppen</div>
                <div class="config-tab" data-config="cfg-users" role="tab" tabindex="0" aria-selected="false">Benutzer</div>
                <div class="config-tab" data-config="cfg-acls" role="tab" tabindex="0" aria-selected="false">ACLs</div>
                <div class="config-tab" data-config="cfg-gpos" role="tab" tabindex="0" aria-selected="false">GPOs</div>
            </div>

            <div class="config-panel active" id="cfg-ous" role="tabpanel" aria-label="OUs konfigurieren">
                <div class="toolbar"><div class="toolbar-right"><button class="btn btn-primary" onclick="showModal('ou-modal')">+ OU hinzufuegen</button></div></div>
                <div class="config-grid" id="cfg-ous-grid"></div>
            </div>
            <div class="config-panel" id="cfg-groups" role="tabpanel" aria-label="Gruppen konfigurieren">
                <div class="toolbar"><div class="toolbar-right"><button class="btn btn-primary" onclick="showModal('group-modal')">+ Gruppe hinzufuegen</button></div></div>
                <div class="config-grid" id="cfg-groups-grid"></div>
            </div>
            <div class="config-panel" id="cfg-users" role="tabpanel" aria-label="Benutzer konfigurieren">
                <div class="toolbar"><div class="toolbar-right"><button class="btn btn-primary" onclick="showModal('user-modal')">+ Benutzer hinzufuegen</button></div></div>
                <div class="config-grid" id="cfg-users-grid"></div>
            </div>
            <div class="config-panel" id="cfg-acls" role="tabpanel" aria-label="ACLs konfigurieren">
                <div class="toolbar"><div class="toolbar-right"><button class="btn btn-primary" onclick="showModal('acl-modal')">+ ACL hinzufuegen</button></div></div>
                <div class="config-grid" id="cfg-acls-grid"></div>
            </div>
            <div class="config-panel" id="cfg-gpos" role="tabpanel" aria-label="GPOs konfigurieren">
                <div class="toolbar"><div class="toolbar-right"><button class="btn btn-primary" onclick="showModal('gpo-modal')">+ GPO hinzufuegen</button></div></div>
                <div class="config-grid" id="cfg-gpos-grid"></div>
            </div>
        </div>

        <!-- Deploy -->
        <div class="page" id="page-deploy" role="region" aria-label="Tier Model deployen">
            <h2 class="page-title" style="font-size:18px;">Tier Model Deployen</h2>
            <div class="card">
                <h3>Optionen</h3>
                <div class="form-row" style="margin-bottom:12px;">
                    <div class="form-check"><input type="checkbox" id="opt-whatif"><label for="opt-whatif">WhatIf (nur Plan anzeigen)</label></div>
                    <div class="form-check"><input type="checkbox" id="opt-confirm"><label for="opt-confirm">ConfirmApply (Bestaetigung)</label></div>
                </div>
                <div class="form-row" style="margin-bottom:12px;">
                    <div class="form-check"><input type="checkbox" id="opt-msa"><label for="opt-msa">IncludeMsa</label></div>
                    <div class="form-check"><input type="checkbox" id="opt-gmsa"><label for="opt-gmsa">IncludeGmsa</label></div>
                </div>
                <div class="form-row" style="margin-bottom:12px;">
                    <div class="form-check"><input type="checkbox" id="opt-dmsa"><label for="opt-dmsa">IncludeDmsa</label></div>
                    <div class="form-check"><input type="checkbox" id="opt-winlaps"><label for="opt-winlaps">IncludeWinLaps</label></div>
                </div>
                <button class="btn btn-success" onclick="showDeployPreview()" id="btn-deploy" style="margin-top:8px;">Deploy starten</button>
            </div>
            <div class="card">
                <h3>Ausgabe</h3>
                <div class="terminal" id="deploy-output" role="log" aria-label="Deploy Ausgabe" aria-live="polite">Bereit...</div>
            </div>
        </div>

        <!-- Audit -->
        <div class="page" id="page-audit" role="region" aria-label="Tier Model auditieren">
            <h2 class="page-title" style="font-size:18px;">Tier Model Auditieren</h2>
            <div class="card">
                <button class="btn btn-primary" onclick="runAudit()" id="btn-audit">Audit starten</button>
            </div>
            <div class="card">
                <h3>Ergebnis</h3>
                <div class="terminal" id="audit-output" role="log" aria-label="Audit Ergebnis" aria-live="polite">Bereit...</div>
            </div>
        </div>
    </main>

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

    <!-- Rename OU Modal -->
    <div class="modal-overlay" id="rename-ou-modal">
        <div class="modal">
            <h2>OU umbenennen</h2>
            <input type="hidden" id="rename-ou-index">
            <div class="form-group"><label>Aktueller Name</label><input id="rename-ou-old" readonly style="opacity:0.6"></div>
            <div class="form-group"><label>Neuer Name</label><input id="rename-ou-new" placeholder="Neuer OU-Name"></div>
            <div class="form-check" style="margin-top:8px;">
                <input type="checkbox" id="rename-ou-paths" checked>
                <label for="rename-ou-paths">Alle Referenzen in Pfaden aktualisieren</label>
            </div>
            <div class="modal-actions">
                <button class="btn btn-outline" onclick="hideModal('rename-ou-modal')">Abbrechen</button>
                <button class="btn btn-primary" onclick="executeRenameOU()">Umbenennen</button>
            </div>
        </div>
    </div>

    <!-- ACL Modal -->
    <div class="modal-overlay" id="acl-modal">
        <div class="modal">
            <h2>Neue ACL Delegation</h2>
            <div class="form-group"><label>Target OU-Pfad</label><input id="acl-ou" placeholder="OU=Tier 0 Accounts,{{DOMAIN_DN}}"></div>
            <div class="form-row">
                <div class="form-group"><label>Principal (Gruppe)</label>
                    <select id="acl-principal" class="field-value"></select>
                </div>
                <div class="form-group"><label>Access Control Type</label>
                    <select id="acl-type"><option>Allow</option><option>Deny</option></select>
                </div>
            </div>
            <div class="form-group"><label>Objekttyp</label>
                <select id="acl-objtype">
                    <option value="">Alle Objekte</option>
                    <option value="Computer">Computer</option>
                    <option value="User">User</option>
                    <option value="Group">Group</option>
                    <option value="OrganizationalUnit">OrganizationalUnit</option>
                    <option value="Contact">Contact</option>
                    <option value="AllObjectClasses">AllObjectClasses</option>
                </select>
            </div>
            <div class="form-group"><label>Active Directory Rechte</label>
                <div class="rights-grid" id="acl-rights-grid">
                    <label><input type="checkbox" value="GenericAll"> GenericAll</label>
                    <label><input type="checkbox" value="CreateChild"> CreateChild</label>
                    <label><input type="checkbox" value="DeleteChild"> DeleteChild</label>
                    <label><input type="checkbox" value="ReadProperty"> ReadProperty</label>
                    <label><input type="checkbox" value="WriteProperty"> WriteProperty</label>
                    <label><input type="checkbox" value="ExtendedRight"> ExtendedRight</label>
                    <label><input type="checkbox" value="Delete"> Delete</label>
                    <label><input type="checkbox" value="DeleteTree"> DeleteTree</label>
                    <label><input type="checkbox" value="GenericExecute"> GenericExecute</label>
                </div>
            </div>
            <div class="form-group"><label>Vererbungstyp</label>
                <select id="acl-inheritance">
                    <option value="All">All</option>
                    <option value="Descendents">Descendents</option>
                    <option value="SelfAndChildren">SelfAndChildren</option>
                    <option value="Children">Children</option>
                    <option value="None">None</option>
                </select>
            </div>
            <div class="modal-actions">
                <button class="btn btn-outline" onclick="hideModal('acl-modal')">Abbrechen</button>
                <button class="btn btn-primary" onclick="addACL()">Hinzufuegen</button>
            </div>
        </div>
    </div>

    <!-- GPO Modal -->
    <div class="modal-overlay" id="gpo-modal">
        <div class="modal">
            <h2>Neue GPO</h2>
            <div class="form-group"><label>Name</label><input id="gpo-name" placeholder="z.B. Tier 0 Account Restrictions"></div>
            <div class="form-group"><label>Modus</label>
                <select id="gpo-mode">
                    <option value="createAndImport">createAndImport</option>
                    <option value="createOnly">createOnly</option>
                    <option value="importOnly">importOnly</option>
                    <option value="linkOnly">linkOnly</option>
                </select>
            </div>
            <div class="form-group"><label>Link Targets (kommagetrennt)</label><input id="gpo-links" placeholder="OU=Tier 0,OU=Tier Model Administration,{{DOMAIN_DN}}"></div>
            <div class="modal-actions">
                <button class="btn btn-outline" onclick="hideModal('gpo-modal')">Abbrechen</button>
                <button class="btn btn-primary" onclick="addGPO()">Hinzufuegen</button>
            </div>
        </div>
    </div>

    <div class="toast-container" id="toast-container"></div>

    <!-- Search Modal (Ctrl+K) -->
    <div class="search-overlay" id="search-overlay">
        <div class="search-modal">
            <div class="search-input-wrap">
                <span class="search-icon">&#128269;</span>
                <input type="text" id="search-input" placeholder="Suchen... (OUs, Gruppen, Benutzer, ACLs, GPOs)" autocomplete="off">
                <kbd>Esc</kbd>
            </div>
            <div class="search-results" id="search-results">
                <div class="search-empty">Tippen um zu suchen...</div>
            </div>
        </div>
    </div>

    <!-- Command Palette -->
    <div class="cmd-palette" id="cmd-palette">
        <div class="cmd-modal">
            <div class="search-input-wrap">
                <span class="search-icon">&#9889;</span>
                <input type="text" id="cmd-input" placeholder="Befehl eingeben..." autocomplete="off">
                <kbd>Esc</kbd>
            </div>
            <div id="cmd-results"></div>
        </div>
    </div>

    <!-- Diff View Modal -->
    <div class="diff-overlay" id="diff-overlay">
        <div class="diff-modal">
            <div class="diff-header">
                <h2>&#128202; Aenderungen vor Deploy</h2>
                <p id="diff-summary">Vergleich: aktuelle Konfiguration vs. laufendes AD</p>
            </div>
            <div class="diff-body" id="diff-body"></div>
            <div class="diff-footer">
                <button class="btn btn-outline" onclick="hideDiff()">Abbrechen</button>
                <button class="btn btn-success" onclick="hideDiff();runDeploy();">Deploy starten</button>
            </div>
        </div>
    </div>

    <!-- Context Menu -->
    <div class="context-menu" id="context-menu"></div>

    <script>
        // === State ===
        let config = { ous: [], groups: [], users: [], acls: [], gpos: [] };

        // === Navigation ===
        document.querySelectorAll('.nav-item[data-page]').forEach(item => {
            const activate = () => {
                document.querySelectorAll('.nav-item').forEach(n => { n.classList.remove('active'); n.setAttribute('aria-current', ''); });
                item.classList.add('active');
                item.setAttribute('aria-current', 'page');
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                document.getElementById('page-' + item.dataset.page).classList.add('active');
                if (item.dataset.page === 'dashboard') loadDashboard();
                if (item.dataset.page === 'config') renderConfigPanels();
            };
            item.addEventListener('click', activate);
            item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
        });

        // === Config Tabs ===
        document.querySelectorAll('.config-tab').forEach(tab => {
            const activate = () => {
                document.querySelectorAll('.config-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
                tab.classList.add('active');
                tab.setAttribute('aria-selected', 'true');
                document.querySelectorAll('.config-panel').forEach(p => p.classList.remove('active'));
                document.getElementById(tab.dataset.config).classList.add('active');
            };
            tab.addEventListener('click', activate);
            tab.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
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
        function showModal(id) {
            document.getElementById(id).classList.add('show');
            if (id === 'acl-modal') populatePrincipalDropdown();
        }
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
                const [ous, groups, users, acls, gpos] = await Promise.all([
                    api('/api/config/tiermodel-ous.json'),
                    api('/api/config/tiermodel-groups.json'),
                    api('/api/config/tiermodel-users.json'),
                    api('/api/config/tiermodel-acls.json'),
                    api('/api/config/tiermodel-gpos.json')
                ]);
                config.ous = ous.organizationUnits || [];
                config.groups = groups.groups || [];
                config.users = users.users || [];
                config.acls = acls.aclDelegations || [];
                config.gpos = gpos.gpos || [];
                renderOUS(); renderGroups(); renderUsers(); renderACLs();
                renderConfigPanels();
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
            renderInteractiveOUTree();
        }

        // === OU Tree ===
        function renderOUTree() {
            const tree = document.getElementById('ou-tree');
            const ous = config.ous;
            const rootOUs = ous.filter(ou => ou.path === '{{DOMAIN_DN}}');
            function getDirectChildren(parentName) {
                return ous.filter(ou => {
                    if (!ou.path || ou.path === '{{DOMAIN_DN}}') return false;
                    const parentRef = 'OU=' + parentName;
                    return ou.path === parentRef || ou.path.startsWith(parentRef + ',');
                });
            }
            function buildTree(parentOUs) {
                if (!parentOUs.length) return '';
                let html = '<ul>';
                parentOUs.forEach(ou => {
                    const badge = getTierBadge(ou.name);
                    const children = getDirectChildren(ou.name);
                    html += `<li><span class="ou-node"><span class="ou-icon">&#128193;</span><span class="ou-name">${esc(ou.name)}</span>${badge}</span>${buildTree(children)}</li>`;
                });
                return html + '</ul>';
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

        // === Render Tables (sidebar pages) ===
        // BUG-003 FIX: Use original config index via findIndex, not filtered index
        function renderOUS(filter = '') {
            const f = filter.toLowerCase();
            const data = config.ous.filter(ou => !f || ou.name.toLowerCase().includes(f));
            document.getElementById('ou-table').innerHTML = `<table><thead><tr><th>Name</th><th>Pfad</th><th>Schutz</th><th>GPO-Block</th><th>Kommentar</th><th></th></tr></thead><tbody>${data.map(ou => { const idx = config.ous.indexOf(ou); return `<tr><td><strong>${esc(ou.name)}</strong></td><td style="font-size:11px;color:var(--text2)">${esc(ou.path)}</td><td>${ou.protectFromAccidentalDeletion ? '<span class="badge badge-green">Ja</span>' : '<span class="badge badge-red">Nein</span>'}</td><td>${ou.blockGpoInheritance ? '<span class="badge badge-green">Ja</span>' : '-'}</td><td style="font-size:11px">${esc(ou.comment || '')}</td><td><div style="display:flex;gap:4px"><button class="btn btn-outline btn-sm" onclick="showRenameOU(${idx})" title="Umbenennen">&#9998;</button><button class="btn btn-danger btn-sm" onclick="removeOU(${idx})" title="Loeschen">X</button></div></td></tr>`; }).join('')}</tbody></table>`;
        }

        function renderGroups(filter = '') {
            const f = filter.toLowerCase();
            const data = config.groups.filter(g => !f || g.name.toLowerCase().includes(f) || g.samaccountname.toLowerCase().includes(f));
            document.getElementById('group-table').innerHTML = `<table><thead><tr><th>Name</th><th>SamAccountName</th><th>Scope</th><th>Kategorie</th><th>Pfad</th><th></th></tr></thead><tbody>${data.map(g => { const idx = config.groups.indexOf(g); return `<tr><td><strong>${esc(g.name)}</strong></td><td><code style="color:var(--accent)">${esc(g.samaccountname)}</code></td><td><span class="badge ${g.groupscope === 'Universal' ? 'badge-admin' : 'badge-t1'}">${g.groupscope}</span></td><td>${g.groupcategory}</td><td style="font-size:11px;color:var(--text2)">${esc(g.path || '')}</td><td><button class="btn btn-danger btn-sm" onclick="removeGroup(${idx})">X</button></td></tr>`; }).join('')}</tbody></table>`;
        }

        function renderUsers(filter = '') {
            const f = filter.toLowerCase();
            const data = config.users.filter(u => !f || u.samAccountName.toLowerCase().includes(f) || (u.displayName || '').toLowerCase().includes(f));
            document.getElementById('user-table').innerHTML = `<table><thead><tr><th>DisplayName</th><th>SamAccountName</th><th>Status</th><th>Pfad</th><th>Beschreibung</th><th></th></tr></thead><tbody>${data.map(u => { const idx = config.users.indexOf(u); return `<tr><td><strong>${esc(u.displayName || u.name)}</strong></td><td><code style="color:var(--accent)">${esc(u.samAccountName)}</code></td><td><span class="badge ${u.enabled ? 'badge-enabled' : 'badge-disabled'}">${u.enabled ? 'Aktiv' : 'Inaktiv'}</span></td><td style="font-size:11px;color:var(--text2)">${esc(u.ouPath || u.path || '')}</td><td style="font-size:11px">${esc(u.description || '')}</td><td><button class="btn btn-danger btn-sm" onclick="removeUser(${idx})">X</button></td></tr>`; }).join('')}</tbody></table>`;
        }

        function renderACLs(filter = '') {
            const f = filter.toLowerCase();
            const data = config.acls.filter(a => !f || a.targetOUPath.toLowerCase().includes(f) || a.identityreference.toLowerCase().includes(f));
            document.getElementById('acl-table').innerHTML = `<table><thead><tr><th>OU-Pfad</th><th>Principal</th><th>Rechte</th><th>Typ</th><th>Objekttyp</th><th></th></tr></thead><tbody>${data.map(a => { const idx = config.acls.indexOf(a); return `<tr><td style="font-size:11px;color:var(--text2)">${esc(a.targetOUPath)}</td><td><strong>${esc(a.identityreference)}</strong></td><td style="font-size:11px">${(a.activedirectoryrights || []).join(', ')}</td><td><span class="badge ${a.accesscontroltype === 'Allow' ? 'badge-green' : 'badge-red'}">${a.accesscontroltype}</span></td><td style="font-size:11px">${esc(a.objecttype || '-')}</td><td><button class="btn btn-danger btn-sm" onclick="removeACL(${idx})">X</button></td></tr>`; }).join('')}</tbody></table>`;
        }

        // === Config Panels (form-based) ===
        function renderConfigPanels() {
            renderOUsConfig();
            renderGroupsConfig();
            renderUsersConfig();
            renderACLsConfig();
            renderGPOsConfig();
        }

        function renderOUsConfig() {
            const grid = document.getElementById('cfg-ous-grid');
            grid.innerHTML = config.ous.map((ou, i) => `
                <div class="config-item">
                    <div class="item-header">
                        <span class="item-title">${esc(ou.name)}</span>
                        <div class="item-actions">
                            <button class="btn btn-outline btn-sm" onclick="showRenameOU(${i})" title="Umbenennen">&#9998;</button>
                            <button class="btn btn-danger btn-sm" onclick="removeOU(${i});renderConfigPanels();" title="Loeschen">X</button>
                        </div>
                    </div>
                    <div class="item-fields">
                        <div class="field-row"><span class="field-label">Name</span><input class="field-value" value="${esc(ou.name)}" onchange="config.ous[${i}].name=this.value;renderOUS();loadDashboard();"></div>
                        <div class="field-row"><span class="field-label">Pfad</span><input class="field-value" value="${esc(ou.path)}" onchange="config.ous[${i}].path=this.value"></div>
                        <div class="field-row"><span class="field-label">Kommentar</span><input class="field-value" value="${esc(ou.comment || '')}" onchange="config.ous[${i}].comment=this.value"></div>
                        <div class="field-row">
                            <div class="field-check"><input type="checkbox" ${ou.protectFromAccidentalDeletion ? 'checked' : ''} onchange="config.ous[${i}].protectFromAccidentalDeletion=this.checked"><label>Schutz</label></div>
                            <div class="field-check"><input type="checkbox" ${ou.blockGpoInheritance ? 'checked' : ''} onchange="config.ous[${i}].blockGpoInheritance=this.checked"><label>GPO-Block</label></div>
                            <div class="field-check"><input type="checkbox" ${ou.disableInheritance ? 'checked' : ''} onchange="config.ous[${i}].disableInheritance=this.checked"><label>Vererbung aus</label></div>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        function renderGroupsConfig() {
            const grid = document.getElementById('cfg-groups-grid');
            grid.innerHTML = config.groups.map((g, i) => `
                <div class="config-item">
                    <div class="item-header">
                        <span class="item-title">${esc(g.name)}</span>
                        <div class="item-actions"><button class="btn btn-danger btn-sm" onclick="removeGroup(${i});renderConfigPanels();">X</button></div>
                    </div>
                    <div class="item-fields">
                        <div class="field-row"><span class="field-label">Name</span><input class="field-value" value="${esc(g.name)}" onchange="config.groups[${i}].name=this.value;renderGroups();loadDashboard();"></div>
                        <div class="field-row"><span class="field-label">SAM</span><input class="field-value" value="${esc(g.samaccountname)}" onchange="config.groups[${i}].samaccountname=this.value"></div>
                        <div class="field-row"><span class="field-label">Beschreibung</span><input class="field-value" value="${esc(g.description || '')}" onchange="config.groups[${i}].description=this.value"></div>
                        <div class="field-row">
                            <span class="field-label">Scope</span>
                            <select class="field-value" onchange="config.groups[${i}].groupscope=this.value">
                                <option ${g.groupscope === 'Global' ? 'selected' : ''}>Global</option>
                                <option ${g.groupscope === 'Universal' ? 'selected' : ''}>Universal</option>
                                <option ${g.groupscope === 'DomainLocal' ? 'selected' : ''}>DomainLocal</option>
                            </select>
                        </div>
                        <div class="field-row">
                            <span class="field-label">Kategorie</span>
                            <select class="field-value" onchange="config.groups[${i}].groupcategory=this.value">
                                <option ${g.groupcategory === 'Security' ? 'selected' : ''}>Security</option>
                                <option ${g.groupcategory === 'Distribution' ? 'selected' : ''}>Distribution</option>
                            </select>
                        </div>
                        <div class="field-row"><span class="field-label">Pfad</span><input class="field-value" value="${esc(g.path || '')}" onchange="config.groups[${i}].path=this.value"></div>
                    </div>
                </div>
            `).join('');
        }

        function renderUsersConfig() {
            const grid = document.getElementById('cfg-users-grid');
            grid.innerHTML = config.users.map((u, i) => `
                <div class="config-item">
                    <div class="item-header">
                        <span class="item-title">${esc(u.displayName || u.samAccountName)}</span>
                        <div class="item-actions"><button class="btn btn-danger btn-sm" onclick="removeUser(${i});renderConfigPanels();">X</button></div>
                    </div>
                    <div class="item-fields">
                        <div class="field-row"><span class="field-label">SAM</span><input class="field-value" value="${esc(u.samAccountName)}" onchange="config.users[${i}].samAccountName=this.value"></div>
                        <div class="field-row"><span class="field-label">Display</span><input class="field-value" value="${esc(u.displayName || '')}" onchange="config.users[${i}].displayName=this.value;renderUsers();loadDashboard();"></div>
                        <div class="field-row"><span class="field-label">Beschreibung</span><input class="field-value" value="${esc(u.description || '')}" onchange="config.users[${i}].description=this.value"></div>
                        <div class="field-row"><span class="field-label">Pfad</span><input class="field-value" value="${esc(u.ouPath || u.path || '')}" onchange="config.users[${i}].ouPath=this.value"></div>
                        <div class="field-row">
                            <div class="field-check"><input type="checkbox" ${u.enabled ? 'checked' : ''} onchange="config.users[${i}].enabled=this.checked;renderUsers();"><label>Aktiviert</label></div>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        function renderACLsConfig() {
            const grid = document.getElementById('cfg-acls-grid');
            grid.innerHTML = config.acls.map((a, i) => `
                <div class="config-item">
                    <div class="item-header">
                        <span class="item-title">${esc(a.identityreference)}</span>
                        <div class="item-actions"><button class="btn btn-danger btn-sm" onclick="removeACL(${i});renderConfigPanels();">X</button></div>
                    </div>
                    <div class="item-fields">
                        <div class="field-row"><span class="field-label">OU-Pfad</span><input class="field-value" value="${esc(a.targetOUPath)}" onchange="config.acls[${i}].targetOUPath=this.value"></div>
                        <div class="field-row">
                            <span class="field-label">Principal</span>
                            <select class="field-value" onchange="config.acls[${i}].identityreference=this.value">
                                ${config.groups.map(g => `<option ${a.identityreference === g.samaccountname ? 'selected' : ''}>${esc(g.samaccountname)}</option>`).join('')}
                            </select>
                        </div>
                        <div class="field-row">
                            <span class="field-label">Typ</span>
                            <select class="field-value" onchange="config.acls[${i}].accesscontroltype=this.value">
                                <option ${a.accesscontroltype === 'Allow' ? 'selected' : ''}>Allow</option>
                                <option ${a.accesscontroltype === 'Deny' ? 'selected' : ''}>Deny</option>
                            </select>
                        </div>
                        <div class="field-row">
                            <span class="field-label">Objekttyp</span>
                            <select class="field-value" onchange="config.acls[${i}].objecttype=this.value">
                                <option value="" ${!a.objecttype ? 'selected' : ''}>Alle</option>
                                <option ${a.objecttype === 'Computer' ? 'selected' : ''}>Computer</option>
                                <option ${a.objecttype === 'User' ? 'selected' : ''}>User</option>
                                <option ${a.objecttype === 'Group' ? 'selected' : ''}>Group</option>
                                <option ${a.objecttype === 'OrganizationalUnit' ? 'selected' : ''}>OrganizationalUnit</option>
                                <option ${a.objecttype === 'AllObjectClasses' ? 'selected' : ''}>AllObjectClasses</option>
                            </select>
                        </div>
                        <div class="field-row">
                            <span class="field-label">Vererbung</span>
                            <select class="field-value" onchange="config.acls[${i}].activeDirectorysecurityinheritance=this.value">
                                ${['All','Descendents','SelfAndChildren','Children','None'].map(v => `<option ${a.activeDirectorysecurityinheritance === v ? 'selected' : ''}>${v}</option>`).join('')}
                            </select>
                        </div>
                        <div class="field-row"><span class="field-label">Rechte</span><input class="field-value" value="${esc((a.activedirectoryrights || []).join(', '))}" onchange="config.acls[${i}].activedirectoryrights=this.value.split(',').map(s=>s.trim()).filter(Boolean)"></div>
                    </div>
                </div>
            `).join('');
        }

        function renderGPOsConfig() {
            const grid = document.getElementById('cfg-gpos-grid');
            grid.innerHTML = config.gpos.map((g, i) => `
                <div class="config-item">
                    <div class="item-header">
                        <span class="item-title">${esc(g.name)}</span>
                        <div class="item-actions"><button class="btn btn-danger btn-sm" onclick="config.gpos.splice(${i},1);renderConfigPanels();">X</button></div>
                    </div>
                    <div class="item-fields">
                        <div class="field-row"><span class="field-label">Name</span><input class="field-value" value="${esc(g.name)}" onchange="config.gpos[${i}].name=this.value"></div>
                        <div class="field-row">
                            <span class="field-label">Modus</span>
                            <select class="field-value" onchange="config.gpos[${i}].mode=this.value">
                                ${['createAndImport','createOnly','importOnly','linkOnly'].map(m => `<option ${g.mode === m ? 'selected' : ''}>${m}</option>`).join('')}
                            </select>
                        </div>
                        <div class="field-row"><span class="field-label">Links</span><input class="field-value" value="${esc((g.linkTargets || []).join(', '))}" onchange="config.gpos[${i}].linkTargets=this.value.split(',').map(s=>s.trim()).filter(Boolean)"></div>
                    </div>
                </div>
            `).join('');
        }

        // === Principal Dropdown ===
        function populatePrincipalDropdown() {
            const sel = document.getElementById('acl-principal');
            sel.innerHTML = config.groups.map(g => `<option value="${esc(g.samaccountname)}">${esc(g.name)} (${esc(g.samaccountname)})</option>`).join('');
        }

        // === Add/Remove ===
        // BUG-002 FIX: Input validation before adding
        // BUG-011 FIX: OU tree updates on add
        // Phase 1: Undo/Redo + Audit Log
        function addOU() {
            const name = document.getElementById('ou-name').value.trim();
            if (!name) { showToast('Name darf nicht leer sein', 'error'); return; }
            pushState();
            const path = document.getElementById('ou-path').value.trim() || '{{DOMAIN_DN}}';
            config.ous.push({ name, path, protectFromAccidentalDeletion: document.getElementById('ou-protect').checked, disableInheritance: false, blockGpoInheritance: document.getElementById('ou-blockgpo').checked, comment: document.getElementById('ou-comment').value.trim() });
            hideModal('ou-modal'); document.getElementById('ou-name').value = ''; document.getElementById('ou-path').value = ''; document.getElementById('ou-comment').value = '';
            addAuditEntry('OU erstellt', `"${name}" in ${path}`, '&#10010;');
            renderOUS(); renderConfigPanels(); loadDashboard(); showToast('OU hinzugefuegt');
        }
        function addGroup() {
            const name = document.getElementById('grp-name').value.trim();
            const sam = document.getElementById('grp-sam').value.trim();
            if (!name || !sam) { showToast('Name und SAM duerfen nicht leer sein', 'error'); return; }
            pushState();
            config.groups.push({ name, samaccountname: sam, description: document.getElementById('grp-desc').value.trim(), groupscope: document.getElementById('grp-scope').value, groupcategory: document.getElementById('grp-cat').value, path: document.getElementById('grp-path').value.trim() });
            hideModal('group-modal');
            addAuditEntry('Gruppe erstellt', `"${name}" (${sam})`, '&#10010;');
            renderGroups(); renderConfigPanels(); loadDashboard(); showToast('Gruppe hinzugefuegt');
        }
        function addUser() {
            const sam = document.getElementById('usr-sam').value.trim();
            if (!sam) { showToast('SamAccountName darf nicht leer sein', 'error'); return; }
            pushState();
            const displayName = document.getElementById('usr-display').value.trim() || sam;
            config.users.push({ samAccountName: sam, displayName, description: document.getElementById('usr-desc').value.trim(), ouPath: document.getElementById('usr-path').value.trim(), enabled: document.getElementById('usr-enabled').checked });
            hideModal('user-modal');
            addAuditEntry('Benutzer erstellt', `"${sam}"`, '&#10010;');
            renderUsers(); renderConfigPanels(); loadDashboard(); showToast('Benutzer hinzugefuegt');
        }
        function addACL() {
            const ou = document.getElementById('acl-ou').value.trim();
            if (!ou) { showToast('OU-Pfad darf nicht leer sein', 'error'); return; }
            const rights = [];
            document.querySelectorAll('#acl-modal .rights-grid input:checked').forEach(cb => rights.push(cb.value));
            if (rights.length === 0) { showToast('Mindestens ein Recht muss ausgewaehlt sein', 'error'); return; }
            pushState();
            const principal = document.getElementById('acl-principal').value;
            config.acls.push({ targetOUPath: ou, identityreference: principal, activedirectoryrights: rights, accesscontroltype: document.getElementById('acl-type').value, objecttype: document.getElementById('acl-objtype').value, activeDirectorysecurityinheritance: document.getElementById('acl-inheritance').value, resolveguid: false });
            hideModal('acl-modal');
            addAuditEntry('ACL erstellt', `${principal} auf ${ou}`, '&#10010;');
            renderACLs(); renderConfigPanels(); showToast('ACL hinzugefuegt');
        }
        function addGPO() {
            const name = document.getElementById('gpo-name').value.trim();
            if (!name) { showToast('Name darf nicht leer sein', 'error'); return; }
            pushState();
            config.gpos.push({ name, mode: document.getElementById('gpo-mode').value, linkTargets: document.getElementById('gpo-links').value.split(',').map(s => s.trim()).filter(Boolean) });
            hideModal('gpo-modal');
            addAuditEntry('GPO erstellt', `"${name}"`, '&#10010;');
            renderConfigPanels(); showToast('GPO hinzugefuegt');
        }

        function removeOU(i) {
            pushState();
            const name = config.ous[i].name;
            config.ous.splice(i, 1);
            addAuditEntry('OU geloescht', `"${name}"`, '&#128465;');
            renderOUS(); loadDashboard();
        }
        function removeGroup(i) {
            pushState();
            const name = config.groups[i].name;
            config.groups.splice(i, 1);
            addAuditEntry('Gruppe geloescht', `"${name}"`, '&#128465;');
            renderGroups(); loadDashboard();
        }
        function removeUser(i) {
            pushState();
            const name = config.users[i].samAccountName;
            config.users.splice(i, 1);
            addAuditEntry('Benutzer geloescht', `"${name}"`, '&#128465;');
            renderUsers(); loadDashboard();
        }
        function removeACL(i) {
            pushState();
            const name = config.acls[i].identityreference;
            config.acls.splice(i, 1);
            addAuditEntry('ACL geloescht', `"${name}"`, '&#128465;');
            renderACLs();
        }

        // === Rename OU ===
        function showRenameOU(index) {
            const ou = config.ous[index];
            document.getElementById('rename-ou-index').value = index;
            document.getElementById('rename-ou-old').value = ou.name;
            document.getElementById('rename-ou-new').value = '';
            showModal('rename-ou-modal');
            document.getElementById('rename-ou-new').focus();
        }

        function executeRenameOU() {
            const index = parseInt(document.getElementById('rename-ou-index').value);
            const oldName = config.ous[index].name;
            const newName = document.getElementById('rename-ou-new').value.trim();
            const updatePaths = document.getElementById('rename-ou-paths').checked;

            if (!newName) { showToast('Neuer Name darf nicht leer sein', 'error'); return; }
            if (newName === oldName) { hideModal('rename-ou-modal'); return; }

            // Check for duplicate
            if (config.ous.some((ou, i) => i !== index && ou.name === newName)) {
                showToast('OU mit diesem Namen existiert bereits', 'error');
                return;
            }

            pushState();

            // Rename the OU
            config.ous[index].name = newName;

            // Count updated references
            let refCount = 0;

            // Update all references in paths
            if (updatePaths) {
                const oldRef = 'OU=' + oldName;
                const newRef = 'OU=' + newName;

                config.ous.forEach(ou => {
                    if (ou.path && (ou.path === oldRef || ou.path.startsWith(oldRef + ','))) {
                        ou.path = ou.path.replace(oldRef, newRef); refCount++;
                    }
                });
                config.groups.forEach(g => {
                    if (g.path && g.path.includes(oldRef)) { g.path = g.path.replace(oldRef, newRef); refCount++; }
                });
                config.users.forEach(u => {
                    const p = u.ouPath || u.path || '';
                    if (p.includes(oldRef)) {
                        if (u.ouPath) { u.ouPath = u.ouPath.replace(oldRef, newRef); refCount++; }
                        if (u.path) { u.path = u.path.replace(oldRef, newRef); }
                    }
                });
                config.acls.forEach(a => {
                    if (a.targetOUPath && a.targetOUPath.includes(oldRef)) { a.targetOUPath = a.targetOUPath.replace(oldRef, newRef); refCount++; }
                });
                config.gpos.forEach(g => {
                    if (g.linkTargets) {
                        g.linkTargets = g.linkTargets.map(t => t.includes(oldRef) ? t.replace(oldRef, newRef) : t);
                    }
                });
            }

            hideModal('rename-ou-modal');
            addAuditEntry('OU umbenannt', `"${oldName}" → "${newName}"${refCount > 0 ? ` (${refCount} Referenzen)` : ''}`, '&#9998;');
            renderOUS(); renderGroups(); renderUsers(); renderACLs(); renderConfigPanels(); loadDashboard();
            showToast(`OU umbenannt: "${oldName}" → "${newName}"`);
        }

        // === Save All ===
        async function saveAllConfigs() {
            const files = [
                { file: 'tiermodel-ous.json', data: { version: '1.0.0', organizationUnits: config.ous } },
                { file: 'tiermodel-groups.json', data: { version: '1.0.0', groups: config.groups } },
                { file: 'tiermodel-users.json', data: { version: '1.0.0', users: config.users } },
                { file: 'tiermodel-acls.json', data: { version: '1.0.0', aclDelegations: config.acls } },
                { file: 'tiermodel-gpos.json', data: { version: '1.0.0', gpos: config.gpos } }
            ];
            let ok = 0;
            for (const f of files) {
                try {
                    const r = await api('/api/config/' + f.file, 'POST', f.data);
                    if (r.success) ok++;
                } catch(e) {}
            }
            addAuditEntry('Konfiguration gespeichert', `${ok}/${files.length} Dateien`, '&#128190;');
            showToast(`${ok}/${files.length} Dateien gespeichert`);
        }

        async function saveConfig(type) {
            let payload, file;
            switch(type) {
                case 'ous': payload = { version: '1.0.0', organizationUnits: config.ous }; file = 'tiermodel-ous.json'; break;
                case 'groups': payload = { version: '1.0.0', groups: config.groups }; file = 'tiermodel-groups.json'; break;
                case 'users': payload = { version: '1.0.0', users: config.users }; file = 'tiermodel-users.json'; break;
                case 'acls': payload = { version: '1.0.0', aclDelegations: config.acls }; file = 'tiermodel-acls.json'; break;
                case 'gpos': payload = { version: '1.0.0', gpos: config.gpos }; file = 'tiermodel-gpos.json'; break;
            }
            try {
                const r = await api('/api/config/' + file, 'POST', payload);
                if (r.success) showToast('Gespeichert: ' + file);
                else showToast('Fehler: ' + r.message, 'error');
            } catch(e) { showToast('Fehler: ' + e.message, 'error'); }
        }

        // === Deploy/Audit ===
        // Phase 2: Diff-View + Audit-Log
        async function runDeploy() {
            const btn = document.getElementById('btn-deploy');
            const out = document.getElementById('deploy-output');
            btn.disabled = true; btn.textContent = 'Deploy laeuft...';
            out.innerHTML = '<span class="line-info">Starte Deploy...</span>\n';
            const whatif = document.getElementById('opt-whatif').checked;
            try {
                const r = await api('/api/deploy', 'POST', {
                    whatif,
                    confirmApply: document.getElementById('opt-confirm').checked,
                    msa: document.getElementById('opt-msa').checked,
                    gmsa: document.getElementById('opt-gmsa').checked,
                    dmsa: document.getElementById('opt-dmsa').checked,
                    winlaps: document.getElementById('opt-winlaps').checked
                });
                out.innerHTML += (r.output || []).map(l => `<span class="${l.type === 'error' ? 'line-error' : l.type === 'warn' ? 'line-warn' : ''}">${esc(l.text)}</span>`).join('\n');
                if (r.success) {
                    addAuditEntry('Deploy ausgefuehrt', `${whatif ? '(WhatIf) ' : ''}${config.ous.length} OUs, ${config.groups.length} Gruppen`, '&#9654;');
                    showToast('Deploy abgeschlossen');
                } else {
                    addAuditEntry('Deploy fehlgeschlagen', '', '&#10060;');
                    showToast('Deploy fehlgeschlagen', 'error');
                }
            } catch(e) { out.innerHTML += `<span class="line-error">Fehler: ${esc(e.message)}</span>`; addAuditEntry('Deploy Fehler', e.message, '&#10060;'); }
            btn.disabled = false; btn.textContent = 'Deploy starten';
        }

        async function runAudit() {
            const btn = document.getElementById('btn-audit');
            const out = document.getElementById('audit-output');
            btn.disabled = true; btn.textContent = 'Audit laeuft...';
            out.innerHTML = '<span class="line-info">Starte Audit...</span>\n';
            try {
                const r = await api('/api/audit', 'POST');
                const errors = (r.output || []).filter(l => l.type === 'error' || l.type === 'warn').length;
                out.innerHTML += (r.output || []).map(l => `<span class="${l.type === 'error' ? 'line-error' : l.type === 'warn' ? 'line-warn' : ''}">${esc(l.text)}</span>`).join('\n');
                if (r.success) {
                    addAuditEntry('Audit abgeschlossen', `${errors} Abweichungen gefunden`, '&#128202;');
                    showToast(`Audit abgeschlossen: ${errors} Abweichungen`);
                } else {
                    addAuditEntry('Audit fehlgeschlagen', '', '&#10060;');
                    showToast('Audit fehlgeschlagen', 'error');
                }
            } catch(e) { out.innerHTML += `<span class="line-error">Fehler: ${esc(e.message)}</span>`; addAuditEntry('Audit Fehler', e.message, '&#10060;'); }
            btn.disabled = false; btn.textContent = 'Audit starten';
        }

        // Show diff before deploy
        function showDeployPreview() {
            const issues = validateConfig();
            if (issues.some(i => i.type === 'error')) {
                showDiff();
            } else {
                runDeploy();
            }
        }

        // === Search ===
        document.getElementById('ou-search').addEventListener('input', e => renderOUS(e.target.value));
        document.getElementById('group-search').addEventListener('input', e => renderGroups(e.target.value));
        document.getElementById('user-search').addEventListener('input', e => renderUsers(e.target.value));
        document.getElementById('acl-search').addEventListener('input', e => renderACLs(e.target.value));

        // === Helper ===
        function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
        function escAttr(s) { return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
        function getTierBadge(name) {
            const n = (name || '').toLowerCase();
            if (n.includes('tier 0')) return '<span class="ou-tag badge-t0">T0</span>';
            if (n.includes('tier 1')) return '<span class="ou-tag badge-t1">T1</span>';
            if (n.includes('tier 2')) return '<span class="ou-tag badge-t2">T2</span>';
            if (n.includes('tier model') || n.includes('paw')) return '<span class="ou-tag badge-admin">Admin</span>';
            return '';
        }
        function getTierColor(name) {
            const n = (name || '').toLowerCase();
            if (n.includes('tier 0')) return 'var(--tier0)';
            if (n.includes('tier 1')) return 'var(--tier1)';
            if (n.includes('tier 2')) return 'var(--tier2)';
            return 'var(--tierAdmin)';
        }

        // === Phase 1: Undo/Redo System ===
        const history = { past: [], future: [] };
        function pushState() {
            history.past.push(JSON.parse(JSON.stringify(config)));
            if (history.past.length > 50) history.past.shift();
            history.future = [];
        }
        function undo() {
            if (!history.past.length) return;
            history.future.push(JSON.parse(JSON.stringify(config)));
            const prev = history.past.pop();
            config.ous = prev.ous; config.groups = prev.groups; config.users = prev.users;
            config.acls = prev.acls; config.gpos = prev.gpos;
            renderOUS(); renderGroups(); renderUsers(); renderACLs(); renderConfigPanels(); loadDashboard();
            showToast('Rueckgaengig');
        }
        function redo() {
            if (!history.future.length) return;
            history.past.push(JSON.parse(JSON.stringify(config)));
            const next = history.future.pop();
            config.ous = next.ous; config.groups = next.groups; config.users = next.users;
            config.acls = next.acls; config.gpos = next.gpos;
            renderOUS(); renderGroups(); renderUsers(); renderACLs(); renderConfigPanels(); loadDashboard();
            showToast('Wiederherstellen');
        }

        // === Phase 1: Audit Log ===
        const auditLog = [];
        function addAuditEntry(action, detail, icon = '&#9998;') {
            const now = new Date();
            const time = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            auditLog.unshift({ time, action, detail, icon });
            if (auditLog.length > 100) auditLog.pop();
            renderAuditLog();
        }
        function renderAuditLog() {
            const el = document.getElementById('audit-log');
            if (!auditLog.length) { el.innerHTML = '<div class="search-empty" style="padding:20px;">Noch keine Aenderungen protokolliert.</div>'; return; }
            el.innerHTML = auditLog.map(e => `
                <div class="audit-entry">
                    <span class="audit-time">${esc(e.time)}</span>
                    <span class="audit-icon">${e.icon}</span>
                    <div class="audit-content">
                        <div class="audit-action">${esc(e.action)}</div>
                        ${e.detail ? `<div class="audit-detail">${esc(e.detail)}</div>` : ''}
                    </div>
                </div>
            `).join('');
        }

        // === Phase 1: Global Search (Ctrl+K) ===
        function showSearch() {
            document.getElementById('search-overlay').classList.add('show');
            const input = document.getElementById('search-input');
            input.value = '';
            input.focus();
            renderSearchResults('');
        }
        function hideSearch() {
            document.getElementById('search-overlay').classList.remove('show');
        }
        function renderSearchResults(query) {
            const el = document.getElementById('search-results');
            if (!query) { el.innerHTML = '<div class="search-empty">Tippen um zu suchen...</div>'; return; }
            const q = query.toLowerCase();
            const results = [];
            config.ous.forEach(ou => {
                if (ou.name.toLowerCase().includes(q) || (ou.path || '').toLowerCase().includes(q) || (ou.comment || '').toLowerCase().includes(q)) {
                    results.push({ type: 'ou', icon: '&#128193;', name: ou.name, path: ou.path, badge: getTierBadge(ou.name), page: 'ous' });
                }
            });
            config.groups.forEach(g => {
                if (g.name.toLowerCase().includes(q) || g.samaccountname.toLowerCase().includes(q)) {
                    results.push({ type: 'group', icon: '&#128101;', name: g.name, path: g.samaccountname, badge: '', page: 'groups' });
                }
            });
            config.users.forEach(u => {
                if ((u.samAccountName || '').toLowerCase().includes(q) || (u.displayName || '').toLowerCase().includes(q)) {
                    results.push({ type: 'user', icon: '&#128100;', name: u.displayName || u.samAccountName, path: u.samAccountName, badge: '', page: 'users' });
                }
            });
            config.acls.forEach(a => {
                if (a.identityreference.toLowerCase().includes(q) || (a.targetOUPath || '').toLowerCase().includes(q)) {
                    results.push({ type: 'acl', icon: '&#128274;', name: a.identityreference, path: a.targetOUPath, badge: '', page: 'acls' });
                }
            });
            config.gpos.forEach(g => {
                if (g.name.toLowerCase().includes(q)) {
                    results.push({ type: 'gpo', icon: '&#128196;', name: g.name, path: g.mode, badge: '', page: 'config' });
                }
            });
            if (!results.length) { el.innerHTML = '<div class="search-empty">Keine Ergebnisse fuer "' + esc(query) + '"</div>'; return; }
            const grouped = {};
            results.forEach(r => { if (!grouped[r.type]) grouped[r.type] = []; grouped[r.type].push(r); });
            const labels = { ou: 'OUs', group: 'Gruppen', user: 'Benutzer', acl: 'ACLs', gpo: 'GPOs' };
            let html = '';
            for (const [type, items] of Object.entries(grouped)) {
                html += `<div class="search-group-label">${labels[type] || type}</div>`;
                items.forEach(r => {
                    html += `<div class="search-result" onclick="hideSearch();navigateTo('${r.page}')"><span class="result-icon">${r.icon}</span><div class="result-info"><div class="result-name">${esc(r.name)}</div><div class="result-path">${esc(r.path || '')}</div></div>${r.badge ? `<span class="result-badge">${r.badge}</span>` : ''}</div>`;
                });
            }
            el.innerHTML = html;
        }

        // === Phase 1: Command Palette (Ctrl+Shift+P) ===
        function showCmdPalette() {
            document.getElementById('cmd-palette').classList.add('show');
            const input = document.getElementById('cmd-input');
            input.value = '';
            input.focus();
            renderCmdResults('');
        }
        function hideCmdPalette() {
            document.getElementById('cmd-palette').classList.remove('show');
        }
        function renderCmdResults(query) {
            const q = query.toLowerCase();
            const commands = [
                { icon: '&#128202;', label: 'Dashboard oeffnen', shortcut: '', action: () => navigateTo('dashboard') },
                { icon: '&#128193;', label: 'OUs anzeigen', shortcut: '', action: () => navigateTo('ous') },
                { icon: '&#128101;', label: 'Gruppen anzeigen', shortcut: '', action: () => navigateTo('groups') },
                { icon: '&#128100;', label: 'Benutzer anzeigen', shortcut: '', action: () => navigateTo('users') },
                { icon: '&#128274;', label: 'ACLs anzeigen', shortcut: '', action: () => navigateTo('acls') },
                { icon: '&#9881;', label: 'Konfiguration anzeigen', shortcut: '', action: () => navigateTo('config') },
                { icon: '&#9654;', label: 'Deploy starten', shortcut: '', action: () => navigateTo('deploy') },
                { icon: '&#128202;', label: 'Audit starten', shortcut: '', action: () => navigateTo('audit') },
                { icon: '&#128193;', label: 'Neue OU erstellen', shortcut: '', action: () => { navigateTo('ous'); showModal('ou-modal'); } },
                { icon: '&#128101;', label: 'Neue Gruppe erstellen', shortcut: '', action: () => { navigateTo('groups'); showModal('group-modal'); } },
                { icon: '&#128100;', label: 'Neuen Benutzer erstellen', shortcut: '', action: () => { navigateTo('users'); showModal('user-modal'); } },
                { icon: '&#128274;', label: 'Neue ACL erstellen', shortcut: '', action: () => { navigateTo('acls'); showModal('acl-modal'); } },
                { icon: '&#128196;', label: 'Neue GPO erstellen', shortcut: '', action: () => { navigateTo('config'); showModal('gpo-modal'); } },
                { icon: '&#128190;', label: 'Alle Konfigurationen speichern', shortcut: '', action: () => saveAllConfigs() },
                { icon: '&#8634;', label: 'Rueckgaengig', shortcut: 'Ctrl+Z', action: () => undo() },
                { icon: '&#8635;', label: 'Wiederherstellen', shortcut: 'Ctrl+Y', action: () => redo() },
            ];
            const filtered = q ? commands.filter(c => c.label.toLowerCase().includes(q)) : commands;
            const el = document.getElementById('cmd-results');
            if (!filtered.length) { el.innerHTML = '<div class="search-empty">Keine Befehle gefunden</div>'; return; }
            let html = '<div class="cmd-sep">Befehle</div>';
            filtered.forEach((c, i) => {
                html += `<div class="cmd-result${i === 0 ? ' active' : ''}" onclick="hideCmdPalette();(${c.action})()"><span class="cmd-icon">${c.icon}</span><span class="cmd-label">${esc(c.label)}</span>${c.shortcut ? `<span class="cmd-shortcut">${c.shortcut}</span>` : ''}</div>`;
            });
            el.innerHTML = html;
        }

        // === Phase 1: Config Validation ===
        function validateConfig() {
            const issues = [];
            // Check OU parent references
            config.ous.forEach(ou => {
                if (ou.path && ou.path !== '{{DOMAIN_DN}}' && ou.path.startsWith('OU=')) {
                    const parentName = ou.path.split(',')[0].replace('OU=', '');
                    if (!config.ous.some(o => o.name === parentName)) {
                        issues.push({ type: 'error', text: `OU "${ou.name}" referenziert nicht existierende Parent-OU "${parentName}"` });
                    }
                }
            });
            // Check for duplicate SAM names
            const sams = new Set();
            config.groups.forEach(g => {
                if (sams.has(g.samaccountname)) issues.push({ type: 'error', text: `Doppelter SAM-Name: "${g.samaccountname}"` });
                sams.add(g.samaccountname);
            });
            // Check ACL principal exists
            config.acls.forEach(a => {
                if (!config.groups.some(g => g.samaccountname === a.identityreference)) {
                    issues.push({ type: 'warn', text: `ACL Principal "${a.identityreference}" existiert nicht als Gruppe` });
                }
            });
            // Check empty configs
            if (!config.ous.length) issues.push({ type: 'warn', text: 'Keine OUs konfiguriert' });
            if (!config.groups.length) issues.push({ type: 'warn', text: 'Keine Gruppen konfiguriert' });
            return issues;
        }

        // === Phase 2: Diff View ===
        function showDiff() {
            const body = document.getElementById('diff-body');
            const issues = validateConfig();
            let html = '';
            if (issues.length) {
                html += '<div class="diff-section"><div class="diff-section-title"><span>&#9888;&#65039;</span> Validierung</div>';
                issues.forEach(i => {
                    html += `<div class="validation-item ${i.type === 'error' ? 'validation-error' : 'validation-warn'}"><span class="validation-icon">${i.type === 'error' ? '&#10060;' : '&#9888;&#65039;'}</span><span class="validation-text">${esc(i.text)}</span></div>`;
                });
                html += '</div>';
            }
            // Show config summary
            html += '<div class="diff-section"><div class="diff-section-title"><span>&#128203;</span> Konfiguration</div>';
            html += `<div class="diff-item diff-add">OUs: ${config.ous.length} konfiguriert</div>`;
            html += `<div class="diff-item diff-add">Gruppen: ${config.groups.length} konfiguriert</div>`;
            html += `<div class="diff-item diff-add">Benutzer: ${config.users.length} konfiguriert</div>`;
            html += `<div class="diff-item diff-add">ACLs: ${config.acls.length} konfiguriert</div>`;
            html += `<div class="diff-item diff-add">GPOs: ${config.gpos.length} konfiguriert</div>`;
            html += '</div>';
            body.innerHTML = html;
            document.getElementById('diff-overlay').classList.add('show');
        }
        function hideDiff() { document.getElementById('diff-overlay').classList.remove('show'); }

        // === Phase 2: Interactive OU Tree ===
        function renderInteractiveOUTree() {
            const container = document.getElementById('ou-tree-interactive');
            const rootOUs = config.ous.filter(ou => ou.path === '{{DOMAIN_DN}}');
            function getChildren(name) {
                return config.ous.filter(ou => ou.path && (ou.path === 'OU=' + name || ou.path.startsWith('OU=' + name + ',')));
            }
            function buildNode(ou, isRoot = false) {
                const children = getChildren(ou.name);
                const hasChildren = children.length > 0;
                const badge = getTierBadge(ou.name);
                const color = getTierColor(ou.name);
                let html = `<div class="ou-tree-node${isRoot ? ' root' : ''}" data-name="${escAttr(ou.name)}">`;
                html += `<div class="ou-tree-row" onclick="toggleTreeNode(this)" oncontextmenu="showOUContextMenu(event, '${escAttr(ou.name)}')">`;
                html += `<span class="tree-toggle ${hasChildren ? '' : 'leaf'}">&#9654;</span>`;
                html += `<span class="tree-icon">&#128193;</span>`;
                html += `<span class="tree-name" style="color:${color}">${esc(ou.name)}</span>`;
                if (badge) html += `<span class="tree-tag">${badge}</span>`;
                html += '</div>';
                if (hasChildren) {
                    html += '<div class="ou-tree-children">';
                    children.forEach(c => { html += buildNode(c); });
                    html += '</div>';
                }
                html += '</div>';
                return html;
            }
            let html = '';
            rootOUs.forEach(ou => { html += buildNode(ou, true); });
            container.innerHTML = html || '<div class="search-empty">Keine OUs konfiguriert.</div>';
        }
        function toggleTreeNode(row) {
            const node = row.parentElement;
            const toggle = row.querySelector('.tree-toggle');
            const children = node.querySelector('.ou-tree-children');
            if (!children) return;
            const expanded = children.classList.toggle('expanded');
            toggle.classList.toggle('expanded', expanded);
        }

        // === Phase 2: Context Menu ===
        let contextTarget = null;
        function showOUContextMenu(e, ouName) {
            e.preventDefault();
            contextTarget = ouName;
            const menu = document.getElementById('context-menu');
            const idx = config.ous.findIndex(ou => ou.name === ouName);
            menu.innerHTML = `
                <div class="context-item" onclick="hideContextMenu();navigateTo('ous')"><span class="ctx-icon">&#128193;</span> OUs anzeigen</div>
                <div class="context-item" onclick="hideContextMenu();showRenameOU(${idx})"><span class="ctx-icon">&#9998;</span> Umbenennen</div>
                <div class="context-item" onclick="hideContextMenu();showModal('ou-modal')"><span class="ctx-icon">&#10010;</span> Neue Unter-OU</span></div>
                <div class="context-sep"></div>
                <div class="context-item danger" onclick="hideContextMenu();removeOU(${idx})"><span class="ctx-icon">&#128465;</span> Loeschen</div>
            `;
            menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
            menu.style.top = Math.min(e.clientY, window.innerHeight - 200) + 'px';
            menu.classList.add('show');
        }
        function hideContextMenu() { document.getElementById('context-menu').classList.remove('show'); }

        // === Navigation Helper ===
        function navigateTo(page) {
            document.querySelectorAll('.nav-item').forEach(n => { n.classList.remove('active'); n.setAttribute('aria-current', ''); });
            const item = document.querySelector(`.nav-item[data-page="${page}"]`);
            if (item) { item.classList.add('active'); item.setAttribute('aria-current', 'page'); }
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.getElementById('page-' + page).classList.add('active');
            if (page === 'dashboard') loadDashboard();
            if (page === 'config') renderConfigPanels();
        }

        // === Global Keyboard Shortcuts ===
        document.addEventListener('keydown', e => {
            // Ctrl+K: Search
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); showSearch(); return; }
            // Ctrl+Shift+P: Command Palette
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') { e.preventDefault(); showCmdPalette(); return; }
            // Ctrl+Z: Undo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
            // Ctrl+Y or Ctrl+Shift+Z: Redo
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
            // Escape: Close overlays
            if (e.key === 'Escape') {
                hideSearch(); hideCmdPalette(); hideDiff(); hideContextMenu();
                document.querySelectorAll('.modal-overlay.show').forEach(m => m.classList.remove('show'));
            }
        });

        // Search input handler
        document.getElementById('search-input')?.addEventListener('input', e => renderSearchResults(e.target.value));
        document.getElementById('cmd-input')?.addEventListener('input', e => renderCmdResults(e.target.value));

        // Close context menu on click outside
        document.addEventListener('click', e => {
            if (!e.target.closest('.context-menu')) hideContextMenu();
        });

        // === Init ===
        loadAll();
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
# BUG-007 FIX: Handle port already in use
$Listener = [System.Net.HttpListener]::new()
$Listener.Prefixes.Add("http://localhost:${Port}/")
try {
    $Listener.Start()
} catch {
    Write-Error "Port $Port ist bereits belegt. Bitte anderen Port verwenden oder laufenden Prozess beenden."
    exit 1
}

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
                    if ($body.confirmApply) { $params['ConfirmApply'] = $true }
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
