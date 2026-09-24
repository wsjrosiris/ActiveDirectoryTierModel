using System.Text.RegularExpressions;
using TierModel.Service.Data;

namespace TierModel.Service.Runs;

/// <summary>Buffers log lines of one run and writes them to the database in batches.</summary>
public sealed partial class RunLogWriter : IAsyncDisposable
{
    private readonly IServiceScopeFactory _scopes;
    private readonly long _runId;
    private readonly List<RunLogLine> _buffer = [];
    private readonly Lock _lock = new();
    private readonly CancellationTokenSource _stop = new();
    private readonly Task _flushLoop;
    private int _seq;

    public int ErrorLines { get; private set; }

    public RunLogWriter(IServiceScopeFactory scopes, long runId, int startSeq = 0)
    {
        _scopes = scopes;
        _runId = runId;
        _seq = startSeq;
        _flushLoop = FlushLoopAsync();
    }

    [GeneratedRegex(@"\x1B\[[0-?]*[ -/]*[@-~]")]
    private static partial Regex Ansi();

    [GeneratedRegex(@"\b(error|errors:\s*[1-9]|fehler|failed|failure|exception|fatal)\b|✗", RegexOptions.IgnoreCase)]
    private static partial Regex ErrorPattern();

    [GeneratedRegex(@"\b(warn|warning|warnung|drift|skipp?ed)\b|⚠", RegexOptions.IgnoreCase)]
    private static partial Regex WarnPattern();

    [GeneratedRegex(@"\b(success|successfully|succeeded|completed|erfolgreich|no drift)\b|✓|✔", RegexOptions.IgnoreCase)]
    private static partial Regex SuccessPattern();

    /// <summary>Summary lines such as "Total Errors: 0" are not errors themselves.</summary>
    [GeneratedRegex(@"\b(errors?|drift|failed)\s*[:=]\s*0\b", RegexOptions.IgnoreCase)]
    private static partial Regex ZeroCountPattern();

    public static string Classify(string stream, string text)
    {
        if (stream == "stderr") return "error";
        if (ZeroCountPattern().IsMatch(text)) return "success";
        if (ErrorPattern().IsMatch(text)) return "error";
        if (WarnPattern().IsMatch(text)) return "warn";
        if (SuccessPattern().IsMatch(text)) return "success";
        return "info";
    }

    public void Add(string stream, string text, string? level = null)
    {
        text = Ansi().Replace(text, "").TrimEnd();
        if (text.Length > 8000) text = text[..8000] + " …";
        level ??= Classify(stream, text);
        lock (_lock)
        {
            if (level == "error" && stream != "system") ErrorLines++;
            _buffer.Add(new RunLogLine
            {
                RunId = _runId, Seq = ++_seq, At = DateTimeOffset.UtcNow,
                Stream = stream, Level = level, Text = text,
            });
        }
    }

    public void System(string text, string level = "info") => Add("system", text, level);

    private async Task FlushLoopAsync()
    {
        try
        {
            while (!_stop.IsCancellationRequested)
            {
                await Task.Delay(500, _stop.Token);
                await FlushAsync();
            }
        }
        catch (OperationCanceledException) { }
    }

    public async Task FlushAsync()
    {
        List<RunLogLine> batch;
        lock (_lock)
        {
            if (_buffer.Count == 0) return;
            batch = [.. _buffer];
            _buffer.Clear();
        }
        await using var scope = _scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.RunLogLines.AddRange(batch);
        await db.SaveChangesAsync();
    }

    public async ValueTask DisposeAsync()
    {
        await _stop.CancelAsync();
        await _flushLoop;
        await FlushAsync();
        _stop.Dispose();
    }
}
