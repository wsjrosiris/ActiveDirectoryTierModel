using System.Collections.Concurrent;

namespace TierModel.Service.Runs;

/// <summary>Wakes the worker when a run is queued and tracks cancellation of the active run.</summary>
public class RunQueue
{
    private readonly SemaphoreSlim _signal = new(0);
    private readonly ConcurrentDictionary<long, CancellationTokenSource> _active = new();

    public void Notify()
    {
        if (_signal.CurrentCount == 0) _signal.Release();
    }

    public Task WaitAsync(TimeSpan timeout, CancellationToken ct) => _signal.WaitAsync(timeout, ct);

    public CancellationTokenSource Register(long runId)
    {
        var cts = new CancellationTokenSource();
        _active[runId] = cts;
        return cts;
    }

    public void Unregister(long runId)
    {
        if (_active.TryRemove(runId, out var cts)) cts.Dispose();
    }

    /// <summary>Returns true when the run is executing in this process and was signalled.</summary>
    public bool TryCancel(long runId)
    {
        if (!_active.TryGetValue(runId, out var cts)) return false;
        cts.Cancel();
        return true;
    }
}
