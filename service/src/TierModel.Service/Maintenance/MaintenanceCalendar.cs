using System.Globalization;
using TierModel.Service.Localization;
using TierModel.Service.Data;

namespace TierModel.Service.Maintenance;

/// <summary>One concrete opening of a maintenance window (UTC).</summary>
public record WindowInstance(long WindowId, string Name, DateTimeOffset Start, DateTimeOffset End);

/// <summary>
/// Pure calculation of maintenance windows and freeze periods (roadmap 4).
/// Rules: when at least one window is enabled, an apply may only start inside an enabled window; it may never start inside
/// an enabled freeze period. Window times are wall-clock times of the window's time zone (DST aware): a time skipped by
/// the spring switch moves forward by the gap, a repeated time in autumn opens at its first and closes at its last occurrence.
/// </summary>
public class MaintenanceCalendar
{
    /// <summary>How far ahead the next allowed start is searched.</summary>
    public static readonly TimeSpan Horizon = TimeSpan.FromDays(400);

    private static readonly CultureInfo De = CultureInfo.GetCultureInfo("de-DE");

    private readonly List<(MaintenanceWindow Window, TimeZoneInfo Zone)> _windows;
    private readonly List<FreezePeriod> _freezes;

    public MaintenanceCalendar(IEnumerable<MaintenanceWindow> windows, IEnumerable<FreezePeriod> freezes)
    {
        _windows = [];
        foreach (var w in windows.Where(w => w.Enabled && w.Days.Length > 0))
            if (TryZone(w.TimeZone) is { } tz) _windows.Add((w, tz));
        _freezes = freezes.Where(f => f.Enabled && f.To > f.From).OrderBy(f => f.From).ToList();
    }

    /// <summary>True when windows restrict applies (at least one enabled window).</summary>
    public bool Restricted => _windows.Count > 0;

    public static TimeZoneInfo? TryZone(string id)
    {
        try
        {
            return TimeZoneConverter.TZConvert.GetTimeZoneInfo(id);
        }
        catch (Exception)
        {
            return null;
        }
    }

    public FreezePeriod? FreezeAt(DateTimeOffset at) => _freezes.FirstOrDefault(f => f.From <= at && at < f.To);

    /// <summary>The enabled window open at <paramref name="at"/> (the one closing last if several overlap).</summary>
    public WindowInstance? WindowAt(DateTimeOffset at) =>
        InstancesAround(at, TimeSpan.FromDays(2)).Where(i => i.Start <= at && at < i.End).OrderByDescending(i => i.End).FirstOrDefault();

    /// <summary>Whether an apply may start at <paramref name="at"/>.</summary>
    public bool Allows(DateTimeOffset at) => FreezeAt(at) is null && (!Restricted || WindowAt(at) is not null);

    /// <summary>
    /// Earliest time at or after <paramref name="from"/> at which an apply may start, or null when there is none within
    /// <see cref="Horizon"/>. If a freeze ends while a window is open, the end of the freeze is a valid start.
    /// </summary>
    public DateTimeOffset? NextAllowedStart(DateTimeOffset from)
    {
        var t = from;
        var limit = from + Horizon;
        for (var i = 0; i < 10_000 && t <= limit; i++)
        {
            if (FreezeAt(t) is { } freeze)
            {
                t = freeze.To;
                continue;
            }
            if (!Restricted) return t;
            if (WindowAt(t) is not null) return t;
            var next = NextWindowStart(t, limit);
            if (next is null) return null;
            t = next.Value;
        }
        return null;
    }

    /// <summary>The window instance a start at <paramref name="at"/> falls into (null without windows).</summary>
    public WindowInstance? NextWindow(DateTimeOffset from)
    {
        if (!Restricted) return null;
        if (WindowAt(from) is { } open) return open;
        var start = NextWindowStart(from, from + Horizon);
        return start is null ? null : WindowAt(start.Value);
    }

    private DateTimeOffset? NextWindowStart(DateTimeOffset after, DateTimeOffset limit)
    {
        // Scan day by day in the windows' own time zones.
        for (var day = -1; day <= (limit - after).TotalDays + 2; day++)
        {
            DateTimeOffset? best = null;
            foreach (var (w, tz) in _windows)
            {
                var localDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(after, tz).DateTime).AddDays(day);
                if (Instance(w, tz, localDate) is { } inst && inst.Start > after && (best is null || inst.Start < best)) best = inst.Start;
            }
            if (best is not null) return best;
        }
        return null;
    }

    /// <summary>All window instances starting within ±<paramref name="span"/> (by local date) of <paramref name="at"/>.</summary>
    public IEnumerable<WindowInstance> InstancesAround(DateTimeOffset at, TimeSpan span)
    {
        var days = (int)Math.Ceiling(span.TotalDays);
        foreach (var (w, tz) in _windows)
        {
            var local = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(at, tz).DateTime);
            for (var d = -days; d <= days; d++)
                if (Instance(w, tz, local.AddDays(d)) is { } inst) yield return inst;
        }
    }

    /// <summary>Upcoming window instances (for the UI), in start order.</summary>
    public List<WindowInstance> Upcoming(DateTimeOffset from, int count)
    {
        var list = new List<WindowInstance>();
        foreach (var (w, tz) in _windows)
        {
            var local = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(from, tz).DateTime);
            for (var d = -1; d <= 15; d++)
                if (Instance(w, tz, local.AddDays(d)) is { } inst && inst.End > from) list.Add(inst);
        }
        return list.OrderBy(i => i.Start).Take(count).ToList();
    }

    public static WindowInstance? Instance(MaintenanceWindow w, TimeZoneInfo tz, DateOnly localDate)
    {
        if (!w.Days.Contains((int)localDate.DayOfWeek)) return null;
        var startLocal = localDate.ToDateTime(w.From);
        var endLocal = (w.To > w.From ? localDate : localDate.AddDays(1)).ToDateTime(w.To);
        var start = ToUtc(startLocal, tz, earliest: true);
        var end = ToUtc(endLocal, tz, earliest: false);
        return end > start ? new WindowInstance(w.Id, w.Name, start, end) : null;
    }

    /// <summary>Wall-clock time of a zone to UTC. Skipped times move forward by the gap; repeated times pick the first or last occurrence.</summary>
    public static DateTimeOffset ToUtc(DateTime local, TimeZoneInfo tz, bool earliest)
    {
        local = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
        if (tz.IsInvalidTime(local))
        {
            // The offset before the gap maps the skipped time to the same distance after the switch.
            var before = tz.GetUtcOffset(local.AddHours(-6));
            return new DateTimeOffset(local - before, TimeSpan.Zero);
        }
        if (tz.IsAmbiguousTime(local))
        {
            var offsets = tz.GetAmbiguousTimeOffsets(local);
            var offset = earliest ? offsets.Max() : offsets.Min();
            return new DateTimeOffset(local - offset, TimeSpan.Zero);
        }
        return new DateTimeOffset(local - tz.GetUtcOffset(local), TimeSpan.Zero);
    }

    /// <summary>
    /// "Mo 24.09.2026, 22:00 Uhr" / "Thu 24/09/2026, 22:00" in the service's local time zone (or the given one) – in the
    /// request language, or with <paramref name="persisted"/> in the instance default language (see <see cref="L"/>).
    /// </summary>
    public static string Format(DateTimeOffset at, TimeZoneInfo? tz = null, bool persisted = false)
    {
        var local = TimeZoneInfo.ConvertTime(at, tz ?? TimeZoneInfo.Local);
        return (persisted ? L.InstanceDefault : L.Language) == L.EnglishCode
            ? local.ToString("ddd dd/MM/yyyy, HH:mm", L.EnglishCulture)
            : local.ToString("ddd dd.MM.yyyy, HH:mm", De) + " Uhr";
    }

    public static readonly string[] DayNames = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
    public static readonly string[] EnglishDayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    /// <summary>Short weekday name; <paramref name="persisted"/> selects the instance default language.</summary>
    public static string DayName(int day, bool persisted = false) =>
        ((persisted ? L.InstanceDefault : L.Language) == L.EnglishCode ? EnglishDayNames : DayNames)[day];
}
