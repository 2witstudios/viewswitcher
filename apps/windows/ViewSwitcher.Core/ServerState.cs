namespace ViewSwitcher.Core;

public enum ServerStateKind
{
    /// <summary>Launching, or Restart Server: finding a server to attach to, or starting the bundled one.</summary>
    Starting,
    /// <summary>The app's own server is running.</summary>
    Owned,
    /// <summary>A server someone else started (bun run dev) is running; the app never stops it.</summary>
    Attached,
    /// <summary>The app's own server exited by itself; it is being brought back.</summary>
    Restarting,
    /// <summary>It kept exiting, so the app stopped bringing it back: Restart Server is up to the person.</summary>
    Crashed,
    /// <summary>The server the app attached to went away.</summary>
    Lost,
    /// <summary>No server could be started (or the port is someone else's).</summary>
    Failed,
    /// <summary>The app is quitting.</summary>
    Quitting,
}

/// <summary>Where the app's server is in its life (Kit's ServerState): one value, so the tray, the window and Quit read the same thing.</summary>
public sealed record ServerState(ServerStateKind Kind, int Attempt = 0, int ExitCode = 0, ServerError? Error = null)
{
    public static readonly ServerState Starting = new(ServerStateKind.Starting);
    public static readonly ServerState Owned = new(ServerStateKind.Owned);
    public static readonly ServerState Attached = new(ServerStateKind.Attached);
    public static readonly ServerState Lost = new(ServerStateKind.Lost);
    public static readonly ServerState Quitting = new(ServerStateKind.Quitting);
    public static ServerState Restarting(int attempt, int exitCode) => new(ServerStateKind.Restarting, attempt, exitCode);
    public static ServerState Crashed(int exitCode) => new(ServerStateKind.Crashed, ExitCode: exitCode);
    public static ServerState Failed(ServerError error) => new(ServerStateKind.Failed, Error: error);

    /// <summary>A server answers.</summary>
    public bool Running => Kind is ServerStateKind.Owned or ServerStateKind.Attached;

    /// <summary>Nothing is running or on its way: Restart Server is what's left.</summary>
    public bool Stopped => Kind is ServerStateKind.Crashed or ServerStateKind.Lost or ServerStateKind.Failed;
}

public enum ServerErrorKind { PortTaken, StartFailed }

public sealed record ServerError(ServerErrorKind Kind, string Detail)
{
    public static ServerError PortTaken(string port) => new(ServerErrorKind.PortTaken, port);
    public static ServerError StartFailed(string why) => new(ServerErrorKind.StartFailed, why);

    public string Message => Kind == ServerErrorKind.PortTaken
        ? $"Something else is using port {Detail}, so ViewSwitcher can't start its server there. Quit that app, or set PORT to another port."
        : Detail;
}

public sealed class ServerException(ServerError error) : Exception(error.Message)
{
    public ServerError Error { get; } = error;
}

/// <summary>
/// How the app brings its server back after it exits by itself: at once, then after 2 s, then 10 s,
/// and not a fourth time within a minute (Kit's RestartPolicy).
/// </summary>
public sealed record RestartPolicy(IReadOnlyList<TimeSpan> Delays, TimeSpan Window)
{
    public static readonly RestartPolicy Standard = new([TimeSpan.Zero, TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(10)], TimeSpan.FromSeconds(60));

    /// <summary>The crashes that still count at <paramref name="now"/>.</summary>
    public List<DateTime> Recent(IEnumerable<DateTime> crashes, DateTime now) => crashes.Where(c => now - c < Window).ToList();

    /// <summary>The wait before restarting, given the crashes that count (the latest included); null means stop.</summary>
    public TimeSpan? Delay(int crashes) => crashes >= 1 && crashes <= Delays.Count ? Delays[crashes - 1] : null;
}
