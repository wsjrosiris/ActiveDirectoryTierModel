using System.Collections.Concurrent;

namespace TierModel.Service.Runs;

/// <summary>Wakes the worker when a run is queued and tracks cancellation of the active run.</summary>
public class RunQueue
{
    private readonly SemaphoreSlim _signal = new(0);
    private readonly ConcurrentDictionary<long, CancellationTokenSource> _active = new();
    // Cancellations requested after the worker claimed a run but before it registered it.
    private readonly HashSet<long> _pendingCancel = [];
    private readonly Lock _lock = new();

    public void Notify()
    {
        if (_signal.CurrentCount == 0) _signal.Release();
    }

    public Task WaitAsync(TimeSpan timeout, CancellationToken ct) => _signal.WaitAsync(timeout, ct);

    public CancellationTokenSource Register(long runId)
    {
        var cts = new CancellationTokenSource();
        lock (_lock)
        {
            _active[runId] = cts;
            if (_pendingCancel.Remove(runId)) cts.Cancel();
        }
        return cts;
    }

    public void Unregister(long runId)
    {
        if (_active.TryRemove(runId, out var cts)) cts.Dispose();
    }

    /// <summary>Signals a running run; if the worker has not registered it yet, the cancellation is applied on registration.</summary>
    public void Cancel(long runId)
    {
        lock (_lock)
        {
            if (_active.TryGetValue(runId, out var cts)) cts.Cancel();
            else _pendingCancel.Add(runId);
        }
    }
}
