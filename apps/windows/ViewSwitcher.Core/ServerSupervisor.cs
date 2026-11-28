namespace ViewSwitcher.Core;

/// <summary>
/// Keeps the app's server running (Kit's ServerSupervisor): attaches or starts it, brings it back when it
/// exits by itself (RestartPolicy), notices when an attached one goes away, and stops it on Quit. Every
/// change of <see cref="State"/> is reported through <see cref="Changed"/>, on the context it was made on
/// (the UI thread in the app). Its methods are called from that one context.
/// </summary>
public sealed class ServerSupervisor(Uri baseUri, Func<Launch> launch, IServerConnector? connector = null, RestartPolicy? policy = null, Func<DateTime>? clock = null)
{
    readonly IServerConnector connector = connector ?? new ServerConnector();
    readonly RestartPolicy policy = policy ?? RestartPolicy.Standard;
    readonly Func<DateTime> now = clock ?? (() => DateTime.UtcNow);
    readonly SynchronizationContext? context = SynchronizationContext.Current;
    List<DateTime> crashes = [];
    bool begun;
    CancellationTokenSource? restart;

    public ServerState State { get; private set; } = ServerState.Starting;
    /// <summary>The server in use while <see cref="State"/> is running.</summary>
    public IServer? Server { get; private set; }
    /// <summary>After every change of <see cref="State"/>: (before, after).</summary>
    public event Action<ServerState, ServerState>? Changed;

    /// <summary>At launch, and Restart Server. Returns once a server runs or it's clear none will. Does nothing while one runs or is on its way.</summary>
    public async Task Start()
    {
        if (begun && !State.Stopped) return;
        begun = true;
        crashes = [];
        await Connect(ServerState.Starting, CancellationToken.None);
    }

    /// <summary>Quit: no more restarts. Returns the server to stop, if the app started it.</summary>
    public IServer? Quit()
    {
        restart?.Cancel();
        restart = null;
        var s = Server;
        Server = null;
        Set(ServerState.Quitting);
        return s is { Owned: true } ? s : null;
    }

    /// <summary>The live connection to an attached server dropped: if nothing answers any more, it's gone.</summary>
    public async Task CheckAttached()
    {
        if (State.Kind != ServerStateKind.Attached || Server is not { } s) return;
        if (await connector.Probe(baseUri, TimeSpan.FromSeconds(1.5)) == Probe.None && Server == s && State.Kind == ServerStateKind.Attached)
        {
            Server = null;
            Set(ServerState.Lost);
        }
    }

    void Set(ServerState next)
    {
        var old = State;
        if (next == old) return;
        State = next;
        Changed?.Invoke(old, next);
    }

    /// <summary>On the supervisor's own context (a server's exit is reported on a thread-pool thread).</summary>
    void OnContext(Action a)
    {
        if (context is null || SynchronizationContext.Current == context) a();
        else context.Post(_ => a(), null);
    }

    async Task Connect(ServerState phase, CancellationToken ct)
    {
        Set(phase);
        IServer s;
        try
        {
            s = await connector.ConnectOrStart(baseUri, launch, ct);
        }
        catch (Exception e)
        {
            if (ct.IsCancellationRequested || State.Kind == ServerStateKind.Quitting) return;
            var failure = e is ServerException se ? se.Error : ServerError.StartFailed(e.Message);
            // A restart that dies while starting is one more crash; a port someone else took isn't.
            if (phase.Kind == ServerStateKind.Restarting && failure.Kind == ServerErrorKind.StartFailed) Crash(phase.ExitCode);
            else Set(ServerState.Failed(failure));
            return;
        }
        if (ct.IsCancellationRequested || State.Kind == ServerStateKind.Quitting)
        {
            await s.StopAsync(); // Quit came while it was starting
            return;
        }
        Server = s;
        s.Crashed += code => OnContext(() => Exited(s, code));
        Set(s.Owned ? ServerState.Owned : ServerState.Attached);
        // It may have died before the handler was added.
        if (s.ExitCode is int code) Exited(s, code);
    }

    void Exited(IServer s, int code)
    {
        if (Server != s || State.Kind != ServerStateKind.Owned) return;
        Server = null;
        Crash(code);
    }

    void Crash(int code)
    {
        var at = now();
        crashes = [.. policy.Recent(crashes, at), at];
        if (policy.Delay(crashes.Count) is not TimeSpan delay)
        {
            Set(ServerState.Crashed(code));
            return;
        }
        var phase = ServerState.Restarting(crashes.Count, code);
        Set(phase);
        var cts = new CancellationTokenSource();
        restart = cts;
        // Not awaited: whoever saw the crash carries on; the restart reports through Changed.
        _ = RestartAfter(delay, phase, cts.Token);
    }

    async Task RestartAfter(TimeSpan delay, ServerState phase, CancellationToken ct)
    {
        try
        {
            if (delay > TimeSpan.Zero) await Task.Delay(delay, ct);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        if (ct.IsCancellationRequested || State != phase) return;
        await Connect(phase, ct);
    }
}
