namespace TierModel.Service.Reports;

/// <summary>Report types of GET /api/reports/{type}.</summary>
public static class ReportTypes
{
    public const string SollIst = "soll-ist";
    public const string Changes = "aenderungen";
    public const string Privileged = "privilegiert";

    public static readonly IReadOnlyList<string> All = [SollIst, Changes, Privileged];

    public static string Title(string type) => type switch
    {
        SollIst => "Soll/Ist-Bericht",
        Changes => "Änderungen im Zeitraum",
        Privileged => "Privilegierte Zugriffe",
        _ => type,
    };

    public static string FileName(string type, DateTimeOffset at, string extension) =>
        $"TierModel-{type switch { SollIst => "Soll-Ist", Changes => "Aenderungen", Privileged => "Privilegierte-Zugriffe", _ => type }}-{at.ToLocalTime():yyyy-MM-dd}.{extension}";
}

/// <summary>Colour hint of a cell, a figure or a paragraph.</summary>
public enum Tone { Default, Muted, Success, Warning, Danger, Info }

public record ReportScore(string Label, int? Score, string Note);

public record ReportDocument(
    string Type,
    string Title,
    string Subtitle,
    DateTimeOffset GeneratedAt,
    string GeneratedBy,
    DateTimeOffset? From,
    DateTimeOffset? To,
    string Instance,
    /// <summary>What the report is based on, e.g. "Audit #12 vom 03.09.2026 14:05".</summary>
    string Basis,
    List<ReportScore> Scores,
    List<ReportStat> Highlights,
    List<ReportSection> Sections);

public record ReportSection(string Title, string? Intro, List<ReportBlock> Blocks);

public abstract record ReportBlock;

public record ReportParagraph(string Text, Tone Tone = Tone.Default) : ReportBlock;

public record ReportSubheading(string Text, string? Note = null) : ReportBlock;

public record ReportStat(string Label, string Value, Tone Tone = Tone.Default);

public record ReportStats(List<ReportStat> Items) : ReportBlock;

public record ReportKeyValues(List<KeyValuePair<string, string>> Items) : ReportBlock;

/// <param name="Width">Relative width of the column.</param>
public record ReportColumn(string Header, double Width, bool Mono = false);

public record ReportCell(string Text, Tone Tone = Tone.Default, string? Sub = null, bool Badge = false)
{
    public static implicit operator ReportCell(string text) => new(text);
}

public record ReportTable(List<ReportColumn> Columns, List<List<ReportCell>> Rows, string Empty = "Keine Einträge.", string? Note = null) : ReportBlock;
