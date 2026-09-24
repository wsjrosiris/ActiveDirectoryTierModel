using System.Text;

namespace TierModel.Service.Reports;

/// <summary>Self-contained, print-optimised HTML version of a report (no scripts, no external resources).</summary>
public static class HtmlReportRenderer
{
    /// <summary>Escapes markup characters only (umlauts stay readable in the source; the page is UTF-8).</summary>
    private static string E(string? s) =>
        (s ?? "").Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;").Replace("'", "&#39;");

    private static string ToneClass(Tone t) => t switch
    {
        Tone.Success => "ok",
        Tone.Warning => "warn",
        Tone.Danger => "bad",
        Tone.Info => "info",
        Tone.Muted => "muted",
        _ => "",
    };

    public static string Range(ReportDocument d) =>
        d.From is { } f && d.To is { } t ? $"{ReportBuilder.Date(f)} – {ReportBuilder.Date(t)}" : d.To is { } to ? $"Stand {ReportBuilder.Date(to)}" : "";

    private const string Css = """
        :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --soft:#f8fafc; --brand:#1d4ed8; --ok:#047857; --warn:#b45309; --bad:#b91c1c; --info:#1d4ed8; }
        * { box-sizing: border-box; }
        html { background: #e5e7eb; }
        body { margin: 0; font: 13px/1.5 "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif; color: var(--ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .page { background: #fff; max-width: 210mm; margin: 24px auto; padding: 18mm 16mm; box-shadow: 0 1px 3px rgb(0 0 0 / .12), 0 8px 24px rgb(0 0 0 / .08); }
        .cover { border-bottom: 3px solid var(--brand); padding-bottom: 18px; margin-bottom: 22px; }
        .brand { display: flex; align-items: center; gap: 10px; color: var(--brand); font-weight: 600; letter-spacing: .02em; font-size: 12px; text-transform: uppercase; }
        .brand i { display: inline-block; width: 22px; height: 22px; border-radius: 6px; background: linear-gradient(135deg, #1d4ed8, #7c3aed); }
        h1 { font-size: 28px; line-height: 1.2; margin: 18px 0 4px; letter-spacing: -.01em; }
        .subtitle { color: var(--muted); font-size: 14px; margin: 0 0 18px; }
        .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 24px; margin: 0; }
        .meta div { display: flex; gap: 8px; min-width: 0; }
        .meta dt { color: var(--muted); min-width: 110px; }
        .meta dd { margin: 0; font-weight: 500; overflow-wrap: anywhere; }
        .scores, .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin: 18px 0 0; }
        .tile { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--soft); break-inside: avoid; }
        .tile .l { color: var(--muted); font-size: 11.5px; }
        .tile .v { font-size: 22px; font-weight: 650; font-variant-numeric: tabular-nums; }
        .tile .n { color: var(--muted); font-size: 11px; }
        .tile.ok .v { color: var(--ok); } .tile.warn .v { color: var(--warn); } .tile.bad .v { color: var(--bad); } .tile.info .v { color: var(--info); } .tile.muted .v { color: var(--muted); }
        h2 { font-size: 17px; margin: 28px 0 6px; padding-bottom: 6px; border-bottom: 1px solid var(--line); break-after: avoid; }
        h3 { font-size: 13.5px; margin: 18px 0 6px; break-after: avoid; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
        h3 small { color: var(--muted); font-weight: 400; font-size: 12px; }
        .intro { color: var(--muted); margin: 0 0 10px; }
        p.note { margin: 10px 0; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--soft); }
        p.note.ok { border-color: #a7f3d0; background: #ecfdf5; color: #065f46; }
        p.note.warn { border-color: #fde68a; background: #fffbeb; color: #92400e; }
        p.note.bad { border-color: #fecaca; background: #fef2f2; color: #991b1b; }
        table { width: 100%; border-collapse: collapse; margin: 8px 0 4px; table-layout: fixed; }
        thead { display: table-header-group; }
        th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 600; background: var(--soft); border-bottom: 1px solid var(--line); padding: 6px 8px; }
        td { padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; overflow-wrap: anywhere; }
        tr { break-inside: avoid; }
        td.mono { font-family: "Cascadia Mono", Consolas, "SFMono-Regular", monospace; font-size: 11.5px; }
        td .sub { display: block; color: var(--muted); font-size: 11px; margin-top: 2px; }
        td.ok { color: var(--ok); } td.warn { color: var(--warn); } td.bad { color: var(--bad); } td.info { color: var(--info); } td.muted { color: var(--muted); }
        .badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; background: #f1f5f9; color: #334155; white-space: nowrap; }
        .badge.ok { background: #d1fae5; color: #065f46; } .badge.warn { background: #fef3c7; color: #92400e; } .badge.bad { background: #fee2e2; color: #991b1b; } .badge.info { background: #dbeafe; color: #1e40af; } .badge.muted { background: #f1f5f9; color: #64748b; }
        .empty { color: var(--muted); font-style: italic; }
        .tablenote { color: var(--muted); font-size: 11.5px; margin: 2px 0 0; }
        .kv { display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 4px 16px; margin: 10px 0; }
        .kv dt { color: var(--muted); } .kv dd { margin: 0; overflow-wrap: anywhere; }
        footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        @media (max-width: 640px) { .page { margin: 0; padding: 20px 16px; box-shadow: none; } .meta { grid-template-columns: 1fr; } .kv { grid-template-columns: 1fr; } table { table-layout: auto; } h1 { font-size: 22px; } }
        @page { size: A4; margin: 16mm 14mm 18mm; @bottom-right { content: "Seite " counter(page) " von " counter(pages); font: 10px "Segoe UI", Arial, sans-serif; color: #64748b; } @bottom-left { content: "TierModel Service"; font: 10px "Segoe UI", Arial, sans-serif; color: #64748b; } }
        @media print { html { background: #fff; } .page { margin: 0; padding: 0; box-shadow: none; max-width: none; } .cover { break-after: page; border-bottom: 0; } footer { display: none; } }
        """;

    public static string Render(ReportDocument d)
    {
        var sb = new StringBuilder();
        sb.Append("<!doctype html><html lang=\"de\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">");
        sb.Append("<title>").Append(E($"{d.Title} – {Range(d)}")).Append("</title><style>").Append(Css).Append("</style></head><body><main class=\"page\">");

        sb.Append("<section class=\"cover\"><div class=\"brand\"><i></i>TierModel Service · Bericht</div>");
        sb.Append("<h1>").Append(E(d.Title)).Append("</h1><p class=\"subtitle\">").Append(E(d.Subtitle)).Append("</p><dl class=\"meta\">");
        void Meta(string label, string value) => sb.Append("<div><dt>").Append(E(label)).Append("</dt><dd>").Append(E(value)).Append("</dd></div>");
        Meta(d.From is null ? "Stand" : "Zeitraum", d.From is null && d.To is { } st ? ReportBuilder.Date(st) : Range(d));
        Meta("Grundlage", d.Basis);
        Meta("Instanz", d.Instance);
        Meta("Erstellt von", d.GeneratedBy);
        Meta("Erstellt am", ReportBuilder.DateTime(d.GeneratedAt));
        sb.Append("</dl>");

        sb.Append("<h3>Compliance-Wert <small>aktueller Stand je Ebene (0–100)</small></h3><div class=\"scores\">");
        foreach (var s in d.Scores)
            sb.Append("<div class=\"tile ").Append(ToneClass(ReportBuilder.ScoreTone(s.Score))).Append("\"><div class=\"l\">").Append(E(s.Label))
              .Append("</div><div class=\"v\">").Append(s.Score?.ToString() ?? "–").Append("</div><div class=\"n\">").Append(E(s.Note)).Append("</div></div>");
        sb.Append("</div>");
        if (d.Highlights.Count > 0)
        {
            sb.Append("<h3>Auf einen Blick</h3><div class=\"stats\">");
            foreach (var h in d.Highlights) Tile(sb, h);
            sb.Append("</div>");
        }
        sb.Append("</section>");

        foreach (var section in d.Sections)
        {
            sb.Append("<section><h2>").Append(E(section.Title)).Append("</h2>");
            if (section.Intro is { } intro) sb.Append("<p class=\"intro\">").Append(E(intro)).Append("</p>");
            foreach (var block in section.Blocks) Block(sb, block);
            sb.Append("</section>");
        }
        sb.Append("<footer><span>").Append(E($"{d.Title} · {d.Instance}")).Append("</span><span>")
          .Append(E($"Erstellt am {ReportBuilder.DateTime(d.GeneratedAt)} von {d.GeneratedBy}")).Append("</span></footer>");
        sb.Append("</main></body></html>");
        return sb.ToString();
    }

    private static void Tile(StringBuilder sb, ReportStat s) =>
        sb.Append("<div class=\"tile ").Append(ToneClass(s.Tone)).Append("\"><div class=\"l\">").Append(E(s.Label)).Append("</div><div class=\"v\">")
          .Append(E(s.Value)).Append("</div></div>");

    private static void Block(StringBuilder sb, ReportBlock block)
    {
        switch (block)
        {
            case ReportParagraph p:
                sb.Append("<p class=\"note ").Append(ToneClass(p.Tone)).Append("\">").Append(E(p.Text)).Append("</p>");
                break;
            case ReportSubheading h:
                sb.Append("<h3>").Append(E(h.Text));
                if (h.Note is { } n) sb.Append(" <small>").Append(E(n)).Append("</small>");
                sb.Append("</h3>");
                break;
            case ReportStats s:
                sb.Append("<div class=\"stats\">");
                foreach (var i in s.Items) Tile(sb, i);
                sb.Append("</div>");
                break;
            case ReportKeyValues kv:
                sb.Append("<dl class=\"kv\">");
                foreach (var i in kv.Items) sb.Append("<dt>").Append(E(i.Key)).Append("</dt><dd>").Append(E(i.Value)).Append("</dd>");
                sb.Append("</dl>");
                break;
            case ReportTable t:
                if (t.Rows.Count == 0)
                {
                    sb.Append("<p class=\"empty\">").Append(E(t.Empty)).Append("</p>");
                    break;
                }
                var total = t.Columns.Sum(c => c.Width);
                sb.Append("<table><colgroup>");
                foreach (var c in t.Columns) sb.Append("<col style=\"width:").Append((c.Width / total * 100).ToString("0.##", System.Globalization.CultureInfo.InvariantCulture)).Append("%\">");
                sb.Append("</colgroup><thead><tr>");
                foreach (var c in t.Columns) sb.Append("<th>").Append(E(c.Header)).Append("</th>");
                sb.Append("</tr></thead><tbody>");
                foreach (var row in t.Rows)
                {
                    sb.Append("<tr>");
                    for (var i = 0; i < t.Columns.Count; i++)
                    {
                        var cell = i < row.Count ? row[i] : new ReportCell("");
                        var cls = (t.Columns[i].Mono ? "mono " : "") + (cell.Badge ? "" : ToneClass(cell.Tone));
                        sb.Append("<td class=\"").Append(cls.Trim()).Append("\">");
                        if (cell.Badge) sb.Append("<span class=\"badge ").Append(ToneClass(cell.Tone)).Append("\">").Append(E(cell.Text)).Append("</span>");
                        else sb.Append(E(cell.Text));
                        if (cell.Sub is { Length: > 0 } sub) sb.Append("<span class=\"sub\">").Append(E(sub)).Append("</span>");
                        sb.Append("</td>");
                    }
                    sb.Append("</tr>");
                }
                sb.Append("</tbody></table>");
                if (t.Note is { } note) sb.Append("<p class=\"tablenote\">").Append(E(note)).Append("</p>");
                break;
        }
    }
}
