using MigraDoc.DocumentObjectModel;
using MigraDoc.DocumentObjectModel.Tables;
using MigraDoc.Rendering;
using PdfSharp.Fonts;

namespace TierModel.Service.Reports;

/// <summary>
/// PDF version of a report, laid out with MigraDoc (PDFsharp, MIT license): cover page, tables with repeated headers,
/// page numbers "Seite x von y". Fonts come from the system (Segoe UI/Arial on Windows, Liberation/DejaVu on Linux).
/// </summary>
public static class PdfReportRenderer
{
    private const string Sans = ReportFontResolver.Sans;
    private const string Mono = ReportFontResolver.Mono;

    private static readonly Color Ink = Color.FromRgb(0x0f, 0x17, 0x2a);
    private static readonly Color Muted = Color.FromRgb(0x64, 0x74, 0x8b);
    private static readonly Color Line = Color.FromRgb(0xe2, 0xe8, 0xf0);
    private static readonly Color Soft = Color.FromRgb(0xf8, 0xfa, 0xfc);
    private static readonly Color Brand = Color.FromRgb(0x1d, 0x4e, 0xd8);

    private static readonly object InitLock = new();
    private static bool _initialized;

    private static (Color Text, Color Back) ToneColors(Tone t) => t switch
    {
        Tone.Success => (Color.FromRgb(0x04, 0x78, 0x57), Color.FromRgb(0xd1, 0xfa, 0xe5)),
        Tone.Warning => (Color.FromRgb(0xb4, 0x53, 0x09), Color.FromRgb(0xfe, 0xf3, 0xc7)),
        Tone.Danger => (Color.FromRgb(0xb9, 0x1c, 0x1c), Color.FromRgb(0xfe, 0xe2, 0xe2)),
        Tone.Info => (Color.FromRgb(0x1d, 0x4e, 0xd8), Color.FromRgb(0xdb, 0xea, 0xfe)),
        Tone.Muted => (Muted, Color.FromRgb(0xf1, 0xf5, 0xf9)),
        _ => (Ink, Soft),
    };

    private static void EnsureFonts()
    {
        lock (InitLock)
        {
            if (_initialized) return;
            GlobalFontSettings.FontResolver ??= new ReportFontResolver();
            _initialized = true;
        }
    }

    public static byte[] Render(ReportDocument d)
    {
        EnsureFonts();
        var doc = new Document();
        doc.Info.Title = $"{d.Title} – {HtmlReportRenderer.Range(d)}";
        doc.Info.Author = "TierModel Service";
        doc.Info.Subject = d.Subtitle;
        Styles(doc);

        var section = doc.AddSection();
        var ps = section.PageSetup;
        ps.PageFormat = PageFormat.A4;
        ps.TopMargin = Unit.FromMillimeter(20);
        ps.BottomMargin = Unit.FromMillimeter(20);
        ps.LeftMargin = Unit.FromMillimeter(16);
        ps.RightMargin = Unit.FromMillimeter(16);
        ps.HeaderDistance = Unit.FromMillimeter(9);
        ps.FooterDistance = Unit.FromMillimeter(9);
        ps.DifferentFirstPageHeaderFooter = true;
        var width = Unit.FromMillimeter(178);

        var header = section.Headers.Primary.AddParagraph();
        header.Style = "Small";
        header.Format.Alignment = ParagraphAlignment.Right;
        header.AddText($"{d.Title} · {HtmlReportRenderer.Range(d)}");
        Footer(section.Footers.Primary, d);
        Footer(section.Footers.FirstPage, d);

        Cover(section, d, width);

        foreach (var s in d.Sections)
        {
            section.AddParagraph(s.Title, "Heading1");
            if (s.Intro is { } intro) section.AddParagraph(intro, "Intro");
            foreach (var block in s.Blocks) Block(section, block, width);
        }

        var renderer = new PdfDocumentRenderer { Document = doc };
        renderer.RenderDocument();
        using var ms = new MemoryStream();
        renderer.PdfDocument.Save(ms, false);
        return ms.ToArray();
    }

    private static void Styles(Document doc)
    {
        var normal = doc.Styles[StyleNames.Normal]!;
        normal.Font.Name = Sans;
        normal.Font.Size = 9;
        normal.Font.Color = Ink;
        normal.ParagraphFormat.SpaceAfter = Unit.FromPoint(3);

        var h1 = doc.Styles[StyleNames.Heading1]!;
        h1.Font.Size = 14;
        h1.Font.Bold = true;
        h1.Font.Color = Ink;
        h1.ParagraphFormat.SpaceBefore = Unit.FromPoint(16);
        h1.ParagraphFormat.SpaceAfter = Unit.FromPoint(6);
        h1.ParagraphFormat.KeepWithNext = true;
        h1.ParagraphFormat.Borders.Bottom.Color = Line;
        h1.ParagraphFormat.Borders.Bottom.Width = Unit.FromPoint(0.75);
        h1.ParagraphFormat.Borders.DistanceFromBottom = Unit.FromPoint(4);

        var h2 = doc.Styles[StyleNames.Heading2]!;
        h2.Font.Size = 10.5;
        h2.Font.Bold = true;
        h2.ParagraphFormat.SpaceBefore = Unit.FromPoint(10);
        h2.ParagraphFormat.SpaceAfter = Unit.FromPoint(4);
        h2.ParagraphFormat.KeepWithNext = true;

        var intro = doc.Styles.AddStyle("Intro", StyleNames.Normal);
        intro.Font.Color = Muted;
        intro.ParagraphFormat.SpaceAfter = Unit.FromPoint(6);

        var small = doc.Styles.AddStyle("Small", StyleNames.Normal);
        small.Font.Size = 7.5;
        small.Font.Color = Muted;
        small.ParagraphFormat.SpaceAfter = 0;

        var cell = doc.Styles.AddStyle("Cell", StyleNames.Normal);
        cell.Font.Size = 8.5;
        cell.ParagraphFormat.SpaceAfter = 0;

        var th = doc.Styles.AddStyle("Th", StyleNames.Normal);
        th.Font.Size = 7.5;
        th.Font.Bold = true;
        th.Font.Color = Muted;
        th.ParagraphFormat.SpaceAfter = 0;
    }

    private static void Footer(HeaderFooter footer, ReportDocument d)
    {
        var table = footer.AddTable();
        table.Borders.Visible = false;
        table.AddColumn(Unit.FromMillimeter(120));
        table.AddColumn(Unit.FromMillimeter(58));
        var row = table.AddRow();
        var left = row.Cells[0].AddParagraph($"TierModel Service · {d.Instance}");
        left.Style = "Small";
        var right = row.Cells[1].AddParagraph();
        right.Style = "Small";
        right.Format.Alignment = ParagraphAlignment.Right;
        right.AddText("Seite ");
        right.AddPageField();
        right.AddText(" von ");
        right.AddNumPagesField();
    }

    private static void Cover(Section section, ReportDocument d, Unit width)
    {
        var bar = section.AddParagraph();
        bar.Format.Borders.Top.Color = Brand;
        bar.Format.Borders.Top.Width = Unit.FromPoint(4);
        bar.Format.SpaceAfter = Unit.FromMillimeter(8);
        var brand = bar.AddFormattedText("TIERMODEL SERVICE · BERICHT");
        brand.Font.Color = Brand;
        brand.Font.Bold = true;
        brand.Font.Size = 8.5;

        var title = section.AddParagraph(d.Title);
        title.Format.Font.Size = 26;
        title.Format.Font.Bold = true;
        title.Format.SpaceBefore = Unit.FromMillimeter(20);
        title.Format.SpaceAfter = Unit.FromPoint(4);
        var subtitle = section.AddParagraph(d.Subtitle);
        subtitle.Format.Font.Size = 11;
        subtitle.Format.Font.Color = Muted;
        subtitle.Format.SpaceAfter = Unit.FromMillimeter(10);

        var meta = section.AddTable();
        meta.Borders.Visible = false;
        meta.AddColumn(Unit.FromMillimeter(38));
        meta.AddColumn(width - Unit.FromMillimeter(38));
        void Meta(string label, string value)
        {
            var row = meta.AddRow();
            row.TopPadding = Unit.FromPoint(3);
            row.BottomPadding = Unit.FromPoint(3);
            row.Borders.Bottom.Color = Line;
            row.Borders.Bottom.Width = Unit.FromPoint(0.5);
            var l = row.Cells[0].AddParagraph(label);
            l.Format.Font.Color = Muted;
            row.Cells[1].AddParagraph(Breakable(value)).Format.Font.Bold = true;
        }
        Meta(d.From is null ? "Stand" : "Zeitraum", d.From is null && d.To is { } st ? ReportBuilder.Date(st) : HtmlReportRenderer.Range(d));
        Meta("Grundlage", d.Basis);
        Meta("Instanz", d.Instance);
        Meta("Erstellt von", d.GeneratedBy);
        Meta("Erstellt am", ReportBuilder.DateTime(d.GeneratedAt));

        var h = section.AddParagraph("Compliance-Wert", "Heading2");
        h.Format.SpaceBefore = Unit.FromMillimeter(10);
        section.AddParagraph("Aktueller Stand je Ebene (0–100)", "Intro");
        Tiles(section, d.Scores.Select(s => (s.Label, s.Score?.ToString() ?? "–", (string?)s.Note, ReportBuilder.ScoreTone(s.Score))).ToList(), width, 20);

        if (d.Highlights.Count > 0)
        {
            var h2 = section.AddParagraph("Auf einen Blick", "Heading2");
            h2.Format.SpaceBefore = Unit.FromMillimeter(8);
            Tiles(section, d.Highlights.Select(s => (s.Label, s.Value, (string?)null, s.Tone)).ToList(), width, 16);
        }
        section.AddPageBreak();
    }

    private static void Tiles(Section section, List<(string Label, string Value, string? Note, Tone Tone)> tiles, Unit width, double valueSize)
    {
        if (tiles.Count == 0) return;
        var table = section.AddTable();
        table.Borders.Visible = false;
        var gap = Unit.FromMillimeter(3);
        var colWidth = (width - gap * (tiles.Count - 1)) / tiles.Count;
        for (var i = 0; i < tiles.Count; i++)
        {
            table.AddColumn(colWidth);
            if (i < tiles.Count - 1) table.AddColumn(gap);
        }
        var row = table.AddRow();
        row.TopPadding = Unit.FromPoint(6);
        row.BottomPadding = Unit.FromPoint(6);
        for (var i = 0; i < tiles.Count; i++)
        {
            var (label, value, note, tone) = tiles[i];
            var cell = row.Cells[i * 2];
            cell.Shading.Color = Soft;
            cell.Borders.Color = Line;
            cell.Borders.Width = Unit.FromPoint(0.5);
            var l = cell.AddParagraph(label);
            l.Style = "Small";
            l.Format.LeftIndent = Unit.FromPoint(4);
            var v = cell.AddParagraph(value);
            v.Format.Font.Size = valueSize;
            v.Format.Font.Bold = true;
            v.Format.LeftIndent = Unit.FromPoint(4);
            v.Format.Font.Color = tone == Tone.Default ? Ink : ToneColors(tone).Text;
            if (note is not null)
            {
                var n = cell.AddParagraph(note);
                n.Style = "Small";
                n.Format.LeftIndent = Unit.FromPoint(4);
            }
        }
    }

    private static void Block(Section section, ReportBlock block, Unit width)
    {
        switch (block)
        {
            case ReportParagraph p:
            {
                var para = section.AddParagraph(p.Text);
                var (text, back) = ToneColors(p.Tone);
                para.Format.Shading.Color = back;
                para.Format.Font.Color = p.Tone == Tone.Default ? Ink : text;
                para.Format.Borders.Distance = Unit.FromPoint(5);
                para.Format.LeftIndent = Unit.FromPoint(5);
                para.Format.RightIndent = Unit.FromPoint(5);
                para.Format.Borders.Color = back;
                para.Format.Borders.Width = Unit.FromPoint(0.5);
                para.Format.SpaceBefore = Unit.FromPoint(6);
                para.Format.SpaceAfter = Unit.FromPoint(8);
                break;
            }
            case ReportSubheading h:
            {
                var para = section.AddParagraph(h.Text, "Heading2");
                if (h.Note is { } note)
                {
                    var n = para.AddFormattedText("   " + note);
                    n.Font.Bold = false;
                    n.Font.Size = 8;
                    n.Font.Color = Muted;
                }
                break;
            }
            case ReportStats s:
                Tiles(section, s.Items.Select(i => (i.Label, i.Value, (string?)null, i.Tone)).ToList(), width, 13);
                section.AddParagraph().Format.SpaceAfter = Unit.FromPoint(4);
                break;
            case ReportKeyValues kv:
            {
                var table = section.AddTable();
                table.Borders.Visible = false;
                table.AddColumn(Unit.FromMillimeter(42));
                table.AddColumn(width - Unit.FromMillimeter(42));
                foreach (var i in kv.Items)
                {
                    var row = table.AddRow();
                    row.TopPadding = Unit.FromPoint(1.5);
                    row.BottomPadding = Unit.FromPoint(1.5);
                    row.Cells[0].AddParagraph(i.Key).Format.Font.Color = Muted;
                    row.Cells[1].AddParagraph(Breakable(i.Value));
                }
                section.AddParagraph().Format.SpaceAfter = Unit.FromPoint(4);
                break;
            }
            case ReportTable t:
                Table(section, t, width);
                break;
        }
    }

    private static void Table(Section section, ReportTable t, Unit width)
    {
        if (t.Rows.Count == 0)
        {
            var empty = section.AddParagraph(t.Empty);
            empty.Format.Font.Italic = true;
            empty.Format.Font.Color = Muted;
            empty.Format.SpaceAfter = Unit.FromPoint(8);
            return;
        }
        var table = section.AddTable();
        table.Borders.Visible = false;
        table.LeftPadding = Unit.FromPoint(4);
        table.RightPadding = Unit.FromPoint(4);
        var total = t.Columns.Sum(c => c.Width);
        foreach (var c in t.Columns) table.AddColumn(Unit.FromPoint(width.Point * c.Width / total));

        var head = table.AddRow();
        head.HeadingFormat = true;
        head.Shading.Color = Soft;
        head.TopPadding = Unit.FromPoint(4);
        head.BottomPadding = Unit.FromPoint(4);
        head.Borders.Bottom.Color = Line;
        head.Borders.Bottom.Width = Unit.FromPoint(0.75);
        for (var i = 0; i < t.Columns.Count; i++) head.Cells[i].AddParagraph(t.Columns[i].Header.ToUpperInvariant()).Style = "Th";

        foreach (var r in t.Rows)
        {
            var row = table.AddRow();
            row.TopPadding = Unit.FromPoint(3.5);
            row.BottomPadding = Unit.FromPoint(3.5);
            row.Borders.Bottom.Color = Line;
            row.Borders.Bottom.Width = Unit.FromPoint(0.5);
            for (var i = 0; i < t.Columns.Count; i++)
            {
                var cell = i < r.Count ? r[i] : new ReportCell("");
                var p = row.Cells[i].AddParagraph();
                p.Style = "Cell";
                var text = p.AddFormattedText(t.Columns[i].Mono ? Breakable(cell.Text) : BreakLong(cell.Text));
                if (t.Columns[i].Mono) { text.Font.Name = Mono; text.Font.Size = 7.5; }
                if (cell.Badge)
                {
                    text.Font.Bold = true;
                    text.Font.Size = 7.5;
                    text.Font.Color = ToneColors(cell.Tone).Text;
                }
                else if (cell.Tone != Tone.Default) text.Font.Color = ToneColors(cell.Tone).Text;
                if (cell.Sub is { Length: > 0 } sub)
                {
                    var s = row.Cells[i].AddParagraph(Breakable(sub));
                    s.Style = "Small";
                }
            }
        }
        var after = section.AddParagraph();
        after.Format.SpaceAfter = Unit.FromPoint(6);
        if (t.Note is { } note)
        {
            after.AddText(note);
            after.Style = "Small";
        }
    }

    /// <summary>Allows line breaks after separators in distinguished names, paths and lists (zero-width space).</summary>
    public static string Breakable(string text) =>
        text.Replace(",", ",\u200B").Replace("\\", "\\\u200B").Replace("/", "/\u200B").Replace("›", "›\u200B");

    /// <summary>Very long words (e.g. SIDs) get break opportunities every 24 characters.</summary>
    private static string BreakLong(string text)
    {
        if (text.Length < 28) return text;
        var sb = new System.Text.StringBuilder(text.Length + 8);
        var run = 0;
        foreach (var ch in text)
        {
            sb.Append(ch);
            run = char.IsWhiteSpace(ch) ? 0 : run + 1;
            if (run >= 24) { sb.Append('\u200B'); run = 0; }
        }
        return Breakable(sb.ToString());
    }
}

/// <summary>Maps the report's two font families to TrueType files installed on the machine.</summary>
public class ReportFontResolver : IFontResolver
{
    public const string Sans = "TierModelSans";
    public const string Mono = "TierModelMono";

    private static readonly string WinFonts = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows) is { Length: > 0 } w ? w : @"C:\Windows", "Fonts");

    private static readonly Dictionary<string, string[]> Candidates = new()
    {
        ["sans"] = [Path.Combine(WinFonts, "segoeui.ttf"), Path.Combine(WinFonts, "arial.ttf"),
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf", "/Library/Fonts/Arial.ttf"],
        ["sans-bold"] = [Path.Combine(WinFonts, "segoeuib.ttf"), Path.Combine(WinFonts, "arialbd.ttf"),
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/liberation-sans/LiberationSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf", "/Library/Fonts/Arial Bold.ttf"],
        ["sans-italic"] = [Path.Combine(WinFonts, "segoeuii.ttf"), Path.Combine(WinFonts, "ariali.ttf"),
            "/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf",
            "/usr/share/fonts/liberation-sans/LiberationSans-Italic.ttf"],
        ["mono"] = [Path.Combine(WinFonts, "consola.ttf"), Path.Combine(WinFonts, "cour.ttf"),
            "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
            "/usr/share/fonts/liberation-mono/LiberationMono-Regular.ttf"],
    };

    private static readonly Dictionary<string, byte[]?> Cache = new();

    public static string? PathFor(string face) =>
        Candidates.TryGetValue(face, out var list) ? list.FirstOrDefault(File.Exists) : null;

    public FontResolverInfo? ResolveTypeface(string familyName, bool bold, bool italic)
    {
        if (familyName.Equals(Mono, StringComparison.OrdinalIgnoreCase)) return new FontResolverInfo("mono", bold, italic);
        var face = bold ? "sans-bold" : italic ? "sans-italic" : "sans";
        // Missing variants are simulated from the regular face.
        if (PathFor(face) is null) return new FontResolverInfo("sans", bold, italic);
        return new FontResolverInfo(face);
    }

    public byte[]? GetFont(string faceName)
    {
        lock (Cache)
        {
            if (Cache.TryGetValue(faceName, out var cached)) return cached;
            var path = PathFor(faceName) ?? (faceName == "mono" ? PathFor("sans") : null)
                ?? throw new InvalidOperationException("Für den PDF-Bericht wurde keine Schriftart gefunden (Segoe UI, Arial, Liberation Sans oder DejaVu Sans).");
            return Cache[faceName] = File.ReadAllBytes(path);
        }
    }
}
