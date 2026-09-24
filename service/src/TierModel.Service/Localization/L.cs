using System.Globalization;

namespace TierModel.Service.Localization;

/// <summary>
/// Localized server texts (roadmap 25). The German text is the key, so German output stays exactly as it was; English
/// comes from <see cref="English"/>. Interpolated texts use composite formats: <c>L.F("Lauf #{0} abgebrochen", id)</c>.
/// <list type="bullet">
/// <item><c>T</c>/<c>F</c>: language of the current request (Accept-Language or <c>?lang=</c>, see <see cref="LocalizationSetup"/>);
/// outside a request the instance default.</item>
/// <item><c>P</c>/<c>PF</c>: persisted or sent texts (change log, run messages, notifications, e-mailed reports) – always
/// the instance default language (<c>defaultLanguage</c> setting). Stored texts are not translated again later.</item>
/// </list>
/// A text without an English entry falls back to German; LocalizationTests checks that every key has one.
/// </summary>
public static class L
{
    public const string German = "de";
    public const string EnglishCode = "en";
    public static readonly IReadOnlyList<string> Languages = [German, EnglishCode];

    private static readonly AsyncLocal<string?> current = new();
    private static volatile string instanceDefault = German;

    /// <summary>Instance default language (setting <c>defaultLanguage</c>), for background and persisted texts.</summary>
    public static string InstanceDefault
    {
        get => instanceDefault;
        set => instanceDefault = Normalize(value) ?? German;
    }

    /// <summary>Language of the current request, or the instance default.</summary>
    public static string Language => current.Value ?? instanceDefault;

    /// <summary>"en-US", "EN", "de-AT" … → "en"/"de"; null if unsupported.</summary>
    public static string? Normalize(string? language)
    {
        var l = (language ?? "").Trim().ToLowerInvariant();
        if (l.Length > 2) l = l[..2];
        return l is German or EnglishCode ? l : null;
    }

    /// <summary>Runs the rest of the current async flow in <paramref name="language"/> (requests, tests, jobs).</summary>
    public static IDisposable Use(string? language)
    {
        var previous = current.Value;
        current.Value = Normalize(language) ?? German;
        return new Restore(previous);
    }

    /// <summary>Formatting culture for English texts (24-hour clock, day before month). German keeps the process culture.</summary>
    public static readonly CultureInfo EnglishCulture = CultureInfo.GetCultureInfo("en-GB");

    public static CultureInfo CultureFor(string language) => language == EnglishCode ? EnglishCulture : CultureInfo.CurrentCulture;

    /// <summary>Date/time pattern of the request language (dd.MM.yyyy HH:mm or dd/MM/yyyy HH:mm).</summary>
    public static string DateTimeFormat => Language == EnglishCode ? "dd/MM/yyyy HH:mm" : "dd.MM.yyyy HH:mm";
    public static string DateFormat => Language == EnglishCode ? "dd/MM/yyyy" : "dd.MM.yyyy";
    /// <summary>Same for persisted texts (instance default language).</summary>
    public static string PersistedDateTimeFormat => instanceDefault == EnglishCode ? "dd/MM/yyyy HH:mm" : "dd.MM.yyyy HH:mm";

    public static string T(string german) => In(Language, german);
    public static string F(string germanFormat, params object?[] args) => FormatIn(Language, germanFormat, args);
    public static string P(string german) => In(instanceDefault, german);
    public static string PF(string germanFormat, params object?[] args) => FormatIn(instanceDefault, germanFormat, args);

    /// <summary>Like <see cref="T"/>, for German texts that need a different translation in another context (key "context|German").</summary>
    public static string TC(string context, string german) => Language == EnglishCode && English.Texts.TryGetValue(context + "|" + german, out var en) ? en : german;
    public static string PC(string context, string german) => instanceDefault == EnglishCode && English.Texts.TryGetValue(context + "|" + german, out var en) ? en : german;

    public static string In(string language, string german) =>
        language == EnglishCode && English.Texts.TryGetValue(german, out var en) ? en : german;

    public static string FormatIn(string language, string germanFormat, params object?[] args) =>
        string.Format(CultureFor(language), In(language, germanFormat), args);

    private sealed class Restore(string? previous) : IDisposable
    {
        public void Dispose() => current.Value = previous;
    }
}
