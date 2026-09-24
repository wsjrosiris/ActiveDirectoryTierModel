using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TierModel.Service.Data;

namespace TierModel.Service;

/// <summary>Result of walking the change-log hash chain.</summary>
public record ChainVerificationDto(bool Ok, long Count, long? LastId, string? LastHash, long? BrokenAtId, string? Problem, DateTimeOffset CheckedAt);

/// <summary>
/// Tamper-evident change log (roadmap 23). Every entry stores
/// <c>Hash = hex(SHA-256(PrevHash + canonical entry))</c>, where the previous entry is the one with the next lower Id.
/// Writers serialise on a PostgreSQL advisory transaction lock and take their Ids from the sequence while holding it,
/// so the chain order always equals the Id order, also for concurrent writers.
/// Editing or deleting a row breaks the chain at that point; replacing the whole table is only visible
/// against an externally noted chain end (shown on the health page).
/// </summary>
public static class ChangeLogChain
{
    /// <summary>Key of the advisory lock ("TMCL").</summary>
    public const long LockKey = 0x544D434C;

    private static volatile bool _backfilled;

    /// <summary>Test hook: forces the next writer to re-check for entries without hash.</summary>
    public static void ResetBackfillFlag() => _backfilled = false;

    // ---------- hashing ----------

    /// <summary>Timestamps as PostgreSQL stores them: UTC, microseconds.</summary>
    public static DateTimeOffset Normalize(DateTimeOffset at)
    {
        var utc = at.ToUniversalTime();
        return new DateTimeOffset(utc.Ticks - utc.Ticks % 10, TimeSpan.Zero);
    }

    public static string Compute(string prevHash, ChangeEntry e)
    {
        var sb = new StringBuilder();
        void Field(string? value)
        {
            // Length-prefixed fields: no separator can be forged by the content.
            value ??= "";
            sb.Append(value.Length.ToString(CultureInfo.InvariantCulture)).Append(':').Append(value).Append('|');
        }
        Field("v1");
        Field(prevHash);
        Field(Normalize(e.At).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.ffffff'Z'", CultureInfo.InvariantCulture));
        Field(e.Username);
        Field(e.Action);
        Field(e.EntityType);
        Field(e.EntityId);
        Field(e.Summary);
        Field(CanonicalJson(e.Details));
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(sb.ToString())));
    }

    /// <summary>
    /// JSON in a form that survives the round trip through <c>jsonb</c>: keys sorted (ordinal), no whitespace,
    /// numbers as decimals, strings with minimal escaping. Invalid JSON is used as is.
    /// </summary>
    public static string? CanonicalJson(string? json)
    {
        if (json is null) return null;
        try
        {
            using var doc = JsonDocument.Parse(json);
            var sb = new StringBuilder();
            Write(doc.RootElement, sb);
            return sb.ToString();
        }
        catch (JsonException)
        {
            return json;
        }
    }

    private static void Write(JsonElement el, StringBuilder sb)
    {
        switch (el.ValueKind)
        {
            case JsonValueKind.Object:
                sb.Append('{');
                var first = true;
                // jsonb keeps the last of duplicate keys.
                var props = el.EnumerateObject().GroupBy(p => p.Name).Select(g => g.Last()).OrderBy(p => p.Name, StringComparer.Ordinal);
                foreach (var p in props)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    WriteString(p.Name, sb);
                    sb.Append(':');
                    Write(p.Value, sb);
                }
                sb.Append('}');
                break;
            case JsonValueKind.Array:
                sb.Append('[');
                var i = 0;
                foreach (var item in el.EnumerateArray())
                {
                    if (i++ > 0) sb.Append(',');
                    Write(item, sb);
                }
                sb.Append(']');
                break;
            case JsonValueKind.String:
                WriteString(el.GetString()!, sb);
                break;
            case JsonValueKind.Number:
                var raw = el.GetRawText();
                sb.Append(decimal.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d.ToString(CultureInfo.InvariantCulture) : raw);
                break;
            case JsonValueKind.True: sb.Append("true"); break;
            case JsonValueKind.False: sb.Append("false"); break;
            default: sb.Append("null"); break;
        }
    }

    private static void WriteString(string s, StringBuilder sb)
    {
        sb.Append('"');
        foreach (var c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                default:
                    if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    else sb.Append(c);
                    break;
            }
        }
        sb.Append('"');
    }

    // ---------- writing ----------

    /// <summary>Saves the context with all new change-log entries chained (called by <see cref="AppDbContext"/>).</summary>
    public static async Task<int> SaveChainedAsync(AppDbContext db, Func<CancellationToken, Task<int>> save, CancellationToken ct)
    {
        var owned = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
        try
        {
            await db.Database.ExecuteSqlRawAsync($"SELECT pg_advisory_xact_lock({LockKey})", ct);
            if (!_backfilled)
            {
                await BackfillLockedAsync(db, ct);
                _backfilled = true;
            }
            var added = db.ChangeTracker.Entries<ChangeEntry>().Where(e => e.State == EntityState.Added).Select(e => e.Entity).ToList();
            var prev = await db.ChangeLog.AsNoTracking().OrderByDescending(e => e.Id).Select(e => e.Hash).FirstOrDefaultAsync(ct) ?? "";
            var ids = await db.Database.SqlQueryRaw<long>(
                "SELECT nextval(pg_get_serial_sequence('change_log', 'Id')) AS \"Value\" FROM generate_series(1, {0})", added.Count).ToListAsync(ct);
            ids.Sort();
            for (var i = 0; i < added.Count; i++)
            {
                var e = added[i];
                e.Id = ids[i];
                e.At = Normalize(e.At == default ? DateTimeOffset.UtcNow : e.At);
                e.Details = CanonicalJson(e.Details);
                e.PrevHash = prev;
                e.Hash = Compute(prev, e);
                prev = e.Hash;
            }
            var n = await save(ct);
            if (owned is not null) await owned.CommitAsync(ct);
            return n;
        }
        catch
        {
            if (owned is not null) await owned.RollbackAsync(CancellationToken.None);
            throw;
        }
        finally
        {
            if (owned is not null) await owned.DisposeAsync();
        }
    }

    /// <summary>Gives entries written before the chain existed their hashes (Id order). Idempotent; runs once per process.</summary>
    public static async Task<int> BackfillAsync(AppDbContext db, CancellationToken ct = default)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlRawAsync($"SELECT pg_advisory_xact_lock({LockKey})", ct);
        var n = await BackfillLockedAsync(db, ct);
        await tx.CommitAsync(ct);
        _backfilled = true;
        return n;
    }

    private static async Task<int> BackfillLockedAsync(AppDbContext db, CancellationToken ct)
    {
        var firstMissing = await db.ChangeLog.AsNoTracking().Where(e => e.Hash == null).OrderBy(e => e.Id).Select(e => (long?)e.Id).FirstOrDefaultAsync(ct);
        if (firstMissing is null) return 0;
        var prev = await db.ChangeLog.AsNoTracking().Where(e => e.Id < firstMissing).OrderByDescending(e => e.Id).Select(e => e.Hash).FirstOrDefaultAsync(ct) ?? "";
        var after = firstMissing.Value - 1;
        var updated = 0;
        while (true)
        {
            var page = await db.ChangeLog.AsNoTracking().Where(e => e.Id > after).OrderBy(e => e.Id).Take(1000).ToListAsync(ct);
            if (page.Count == 0) break;
            var ids = new List<long>();
            var hashes = new List<string>();
            var prevs = new List<string>();
            foreach (var e in page)
            {
                if (e.Hash is null)
                {
                    ids.Add(e.Id);
                    prevs.Add(prev);
                    e.Hash = Compute(prev, e);
                    hashes.Add(e.Hash);
                }
                // Entries that already have a hash are taken as they are (never re-blessed).
                prev = e.Hash;
            }
            if (ids.Count > 0)
            {
                updated += await db.Database.ExecuteSqlRawAsync(
                    "UPDATE change_log c SET \"Hash\" = v.h, \"PrevHash\" = v.p FROM unnest({0}::bigint[], {1}::text[], {2}::text[]) AS v(id, h, p) WHERE c.\"Id\" = v.id",
                    [ids.ToArray(), hashes.ToArray(), prevs.ToArray()], ct);
            }
            after = page[^1].Id;
        }
        return updated;
    }

    // ---------- verifying ----------

    public static async Task<ChainVerificationDto> VerifyAsync(AppDbContext db, CancellationToken ct = default)
    {
        var prev = "";
        long count = 0;
        long? lastId = null;
        long after = long.MinValue;
        while (true)
        {
            var page = await db.ChangeLog.AsNoTracking().Where(e => e.Id > after).OrderBy(e => e.Id).Take(2000).ToListAsync(ct);
            if (page.Count == 0) break;
            foreach (var e in page)
            {
                count++;
                string? problem = null;
                if (e.Hash is null) problem = "Eintrag ohne Prüfsumme";
                else if ((e.PrevHash ?? "") != prev) problem = "Verweis auf den vorherigen Eintrag passt nicht (Eintrag gelöscht oder eingefügt)";
                else if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Compute(prev, e)), Encoding.ASCII.GetBytes(e.Hash)))
                    problem = "Inhalt passt nicht zur Prüfsumme (Eintrag verändert)";
                if (problem is not null)
                    return new ChainVerificationDto(false, count, lastId, prev == "" ? null : prev, e.Id, problem, DateTimeOffset.UtcNow);
                prev = e.Hash!;
                lastId = e.Id;
            }
            after = page[^1].Id;
        }
        return new ChainVerificationDto(true, count, lastId, prev == "" ? null : prev, null, null, DateTimeOffset.UtcNow);
    }

    private static readonly SemaphoreSlim CacheLock = new(1, 1);
    private static ChainVerificationDto? _cached;

    /// <summary>Verification result, recomputed at most every <paramref name="maxAge"/> (default 10 minutes).</summary>
    public static async Task<ChainVerificationDto> VerifyCachedAsync(AppDbContext db, bool refresh = false, TimeSpan? maxAge = null, CancellationToken ct = default)
    {
        await CacheLock.WaitAsync(ct);
        try
        {
            if (!refresh && _cached is { } c && DateTimeOffset.UtcNow - c.CheckedAt < (maxAge ?? TimeSpan.FromMinutes(10))) return c;
            return _cached = await VerifyAsync(db, ct);
        }
        finally
        {
            CacheLock.Release();
        }
    }
}

public static class ChangeLogChainEndpoints
{
    public static void MapChangeLogChainEndpoints(this IEndpointRouteBuilder app)
    {
        // Walks the whole chain (fresh, not cached). Admins only: it reads every entry.
        app.MapGet("/api/changelog/verify", async (AppDbContext db, CancellationToken ct) =>
                Results.Json(await ChangeLogChain.VerifyCachedAsync(db, refresh: true, ct: ct), Endpoints.JsonDefaults.Options))
            .RequireAuthorization(nameof(Role.Admin));

        // Short status for the change-log page badge (cached for 10 minutes; hashes only for admins).
        app.MapGet("/api/changelog/chain", async (HttpContext ctx, AppDbContext db, CancellationToken ct) =>
            {
                var r = await ChangeLogChain.VerifyCachedAsync(db, ct: ct);
                if (!Auth.AuthClaims.HasRole(ctx.User, Role.Admin)) r = r with { LastHash = null };
                return Results.Json(r, Endpoints.JsonDefaults.Options);
            })
            .RequireAuthorization(nameof(Role.Viewer));
    }
}
