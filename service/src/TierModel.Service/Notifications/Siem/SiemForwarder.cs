using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TierModel.Service.Data;

namespace TierModel.Service.Notifications.Siem;

/// <summary>
/// Forwards every saved change-log entry to the SIEM channels that have "Änderungsprotokoll weiterleiten" switched on.
/// The request path only writes into a bounded in-memory queue (never blocks, never throws); when the queue is full the
/// entry is dropped and counted. <see cref="SiemWorker"/> resolves the channels and sends in batches.
/// </summary>
public class SiemForwarder
{
    public const int Capacity = 5000;

    private readonly Channel<SiemEvent> _queue = Channel.CreateBounded<SiemEvent>(new BoundedChannelOptions(Capacity)
    {
        FullMode = BoundedChannelFullMode.Wait, // TryWrite fails instead of waiting: the caller counts the drop
        SingleReader = true,
    });
    private readonly ConcurrentDictionary<long, long> _failed = new();
    private long _queueDrops;
    private int _version;

    public ChannelReader<SiemEvent> Reader => _queue.Reader;

    /// <summary>Entries dropped because the queue was full (all change-log channels are affected).</summary>
    public long QueueDrops => Interlocked.Read(ref _queueDrops);

    public int Pending => _queue.Reader.CanCount ? _queue.Reader.Count : 0;

    /// <summary>Changes whenever channels are created, changed or deleted; the worker reloads its channel list.</summary>
    public int Version => Volatile.Read(ref _version);

    public void Invalidate() => Interlocked.Increment(ref _version);

    /// <summary>Events lost for a channel: queue overflow (change-log channels) plus batches that could not be delivered.</summary>
    public long Dropped(long channelId, bool forwardsChangeLog) =>
        _failed.GetValueOrDefault(channelId) + (forwardsChangeLog ? QueueDrops : 0);

    public void CountFailed(long channelId, int count) => _failed.AddOrUpdate(channelId, count, (_, v) => v + count);

    public void Forget(long channelId) => _failed.TryRemove(channelId, out _);

    public bool Enqueue(SiemEvent e)
    {
        if (_queue.Writer.TryWrite(e)) return true;
        Interlocked.Increment(ref _queueDrops);
        return false;
    }

    public void EnqueueChanges(IEnumerable<ChangeEntry> entries)
    {
        foreach (var e in entries) Enqueue(SiemEvents.ForChange(e));
    }
}

/// <summary>
/// Picks up change-log entries after a successful SaveChanges (ids are set by then). Inside an explicit transaction (the hash
/// chain of the change log saves in one) they are forwarded only after the commit.
/// </summary>
public class ChangeLogForwardInterceptor(SiemForwarder forwarder) : SaveChangesInterceptor, IDbTransactionInterceptor
{
    private static readonly ConditionalWeakTable<DbContext, List<ChangeEntry>> Pending = new();

    private static void Capture(DbContext? context)
    {
        if (context is null) return;
        var added = context.ChangeTracker.Entries<ChangeEntry>().Where(e => e.State == EntityState.Added).Select(e => e.Entity).ToList();
        if (added.Count == 0) return;
        if (Pending.TryGetValue(context, out var existing)) existing.AddRange(added.Where(a => !existing.Contains(a)));
        else Pending.AddOrUpdate(context, added);
    }

    private void Release(DbContext? context, bool afterCommit = false)
    {
        if (context is null || !Pending.TryGetValue(context, out var list)) return;
        if (!afterCommit && context.Database.CurrentTransaction is not null) return; // wait for TransactionCommitted
        Pending.Remove(context);
        try { forwarder.EnqueueChanges(list); }
        catch (Exception) { /* forwarding must never fail the request */ }
    }

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        SafeCapture(eventData.Context);
        return result;
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        SafeCapture(eventData.Context);
        return ValueTask.FromResult(result);
    }

    public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
    {
        Release(eventData.Context);
        return result;
    }

    public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
    {
        Release(eventData.Context);
        return ValueTask.FromResult(result);
    }

    public override void SaveChangesFailed(DbContextErrorEventData eventData)
    {
        if (eventData.Context is { } c) Pending.Remove(c);
    }

    public override Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken cancellationToken = default)
    {
        if (eventData.Context is { } c) Pending.Remove(c);
        return Task.CompletedTask;
    }

    void IDbTransactionInterceptor.TransactionCommitted(System.Data.Common.DbTransaction transaction, TransactionEndEventData eventData) =>
        Release(eventData.Context, afterCommit: true);

    Task IDbTransactionInterceptor.TransactionCommittedAsync(System.Data.Common.DbTransaction transaction, TransactionEndEventData eventData, CancellationToken cancellationToken)
    {
        Release(eventData.Context, afterCommit: true);
        return Task.CompletedTask;
    }

    void IDbTransactionInterceptor.TransactionRolledBack(System.Data.Common.DbTransaction transaction, TransactionEndEventData eventData)
    {
        if (eventData.Context is { } c) Pending.Remove(c);
    }

    Task IDbTransactionInterceptor.TransactionRolledBackAsync(System.Data.Common.DbTransaction transaction, TransactionEndEventData eventData, CancellationToken cancellationToken)
    {
        if (eventData.Context is { } c) Pending.Remove(c);
        return Task.CompletedTask;
    }

    private static void SafeCapture(DbContext? context)
    {
        try { Capture(context); }
        catch (Exception) { /* never fail the request */ }
    }
}

/// <summary>Sends queued change-log events to the SIEM channels in batches.</summary>
public class SiemWorker(SiemForwarder forwarder, IServiceScopeFactory scopes, ILogger<SiemWorker> logger) : BackgroundService
{
    public const int BatchSize = 200;
    public static readonly TimeSpan[] RetryDelays = [TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(10)];
    private static readonly TimeSpan ChannelCacheTime = TimeSpan.FromSeconds(30);

    private List<(long Id, string Name)> _channels = [];
    private DateTimeOffset _loadedAt = DateTimeOffset.MinValue;
    private int _loadedVersion = -1;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var batch = new List<SiemEvent>(BatchSize);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!await forwarder.Reader.WaitToReadAsync(stoppingToken)) return;
                batch.Clear();
                while (batch.Count < BatchSize && forwarder.Reader.TryRead(out var e)) batch.Add(e);
                await SendAsync(batch, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "SIEM forwarding of {Count} change-log entries failed", batch.Count);
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }
    }

    private async Task SendAsync(List<SiemEvent> batch, CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var settings = scope.ServiceProvider.GetRequiredService<SettingsService>();
        if (_loadedVersion != forwarder.Version || DateTimeOffset.UtcNow - _loadedAt > ChannelCacheTime)
        {
            _loadedVersion = forwarder.Version;
            var channels = await db.NotificationChannels.AsNoTracking()
                .Where(c => c.Enabled && (c.Type == ChannelType.Syslog || c.Type == ChannelType.LogAnalytics)).ToListAsync(ct);
            _channels = channels.Where(c => SiemChannelConfig.Read(c, settings.Secrets)?.ForwardChangeLog == true).Select(c => (c.Id, c.Name)).ToList();
            _loadedAt = DateTimeOffset.UtcNow;
        }
        if (_channels.Count == 0) return;

        var sender = scope.ServiceProvider.GetRequiredService<SiemSender>();
        foreach (var (id, name) in _channels)
        {
            var channel = await db.NotificationChannels.FirstOrDefaultAsync(c => c.Id == id, ct);
            if (channel is null || !channel.Enabled) continue;
            string? error = null;
            for (var attempt = 0; ; attempt++)
            {
                try
                {
                    await sender.SendAsync(channel, batch, ct);
                    error = null;
                    break;
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    error = ex.Message;
                    if (attempt >= RetryDelays.Length) break;
                    await Task.Delay(RetryDelays[attempt], ct);
                }
            }
            if (error is null) channel.LastSentAt = DateTimeOffset.UtcNow;
            else
            {
                forwarder.CountFailed(id, batch.Count);
                logger.LogWarning("SIEM channel {Channel}: {Count} change-log entries not delivered: {Error}", name, batch.Count, error);
            }
            // No change-log entry for failures here: it would be forwarded to the failing channel again.
            channel.LastError = error;
            await db.SaveChangesAsync(ct);
        }
    }
}

public static class SiemSetup
{
    /// <summary>Syslog/Log Analytics senders, the change-log forwarding queue and its worker.</summary>
    public static IServiceCollection AddSiem(this IServiceCollection services)
    {
        services.TryAddSingleton(TimeProvider.System);
        services.AddSingleton<SyslogSender>();
        services.AddSingleton<LogAnalyticsSender>();
        services.AddSingleton<SiemSender>();
        services.AddSingleton<SiemForwarder>();
        services.AddSingleton<ChangeLogForwardInterceptor>();
        services.AddHttpClient(LogAnalyticsSender.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(30));
        services.AddHostedService<SiemWorker>();
        return services;
    }
}
