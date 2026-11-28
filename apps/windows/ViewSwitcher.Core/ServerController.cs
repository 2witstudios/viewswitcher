using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace ViewSwitcher.Core;

// The ViewSwitcher server behind the Windows app (Kit's ServerController.swift): attach to one that
// already answers on the port (e.g. `bun run dev`), otherwise start the bundled one and own it. Only a
// server this app started is ever stopped, and an orphan an earlier run left behind is replaced.

public enum Probe
{
    /// <summary>A ViewSwitcher server answers.</summary>
    ViewSwitcher,
    /// <summary>Something else answers on the port.</summary>
    Other,
    /// <summary>Something holds the port but didn't answer in time.</summary>
    Slow,
    /// <summary>Nothing listens.</summary>
    None,
}

/// <summary>How a server is started: the bundled one, or `bun …/apps/server/src/index.ts` from a checkout.</summary>
public sealed record Launch(string Executable, IReadOnlyList<string> Arguments, IReadOnlyDictionary<string, string> Environment, string LogFile);

/// <summary>A server the app is using: its own (it can be stopped) or one someone else started.</summary>
public interface IServer
{
    Uri Base { get; }
    bool Owned { get; }
    int? Pid { get; }
    /// <summary>The exit code once an owned server has exited, else null.</summary>
    int? ExitCode { get; }
    /// <summary>Raised (on a thread-pool thread) when an owned server exits without <see cref="StopAsync"/>: a crash.</summary>
    event Action<int>? Crashed;
    /// <summary>Stops the server if this app started it; returns once it has exited.</summary>
    Task StopAsync();
}

/// <summary>Finds or starts a server (the supervisor's one dependency, so its tests can stand in for it).</summary>
public interface IServerConnector
{
    Task<IServer> ConnectOrStart(Uri baseUri, Func<Launch> launch, CancellationToken ct);
    Task<Probe> Probe(Uri baseUri, TimeSpan timeout);
}

public static class ServerLog
{
    public const long MaxBytes = 5 * 1024 * 1024;

    /// <summary>
    /// Where this build's server log goes, so builds never share one: the installed app's is
    /// %LOCALAPPDATA%\ViewSwitcher\Logs\server.log, a development build's server-dev.log beside it, an
    /// end-to-end run's in its own folder.
    /// </summary>
    public static string File(string localAppData, bool dev, string? e2eDir)
    {
        if (e2eDir is not null) return Path.Combine(e2eDir, "server.log");
        return Path.Combine(localAppData, "ViewSwitcher", "Logs", dev ? "server-dev.log" : "server.log");
    }

    /// <summary>Start a fresh log once it's past <paramref name="max"/> bytes, so it never grows forever.</summary>
    public static void Cap(string file, long max = MaxBytes)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        try
        {
            if (new FileInfo(file) is { Exists: true, Length: var n } && n > max) System.IO.File.WriteAllBytes(file, []);
        }
        catch (IOException) { }
    }
}

/// <summary>The real connector: HTTP probes, and processes in a kill-on-close Job Object.</summary>
public sealed class ServerConnector : IServerConnector
{
    static readonly HttpClient Http = Loopback.Client();

    /// <summary>The Job Object every started server goes in (null off Windows, or when it couldn't be made).</summary>
    readonly JobObject? job = OperatingSystem.IsWindows() ? TryJob() : null;
    readonly TimeSpan readyTimeout;
    readonly TimeSpan slowFor;

    public ServerConnector(TimeSpan? readyTimeout = null, TimeSpan? slowFor = null)
    {
        this.readyTimeout = readyTimeout ?? TimeSpan.FromSeconds(20);
        this.slowFor = slowFor ?? TimeSpan.FromSeconds(5);
    }

    static JobObject? TryJob()
    {
        try
        {
            return OperatingSystem.IsWindows() ? new JobObject() : null;
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>What answers at <paramref name="baseUri"/>: a ViewSwitcher server, something else, or nothing.</summary>
    public async Task<Probe> Probe(Uri baseUri, TimeSpan timeout)
    {
        using var cts = new CancellationTokenSource(timeout);
        try
        {
            using var res = await Http.GetAsync(new Uri(baseUri, "api/state"), cts.Token);
            if (res.StatusCode != System.Net.HttpStatusCode.OK) return Core.Probe.Other;
            var text = await res.Content.ReadAsStringAsync(cts.Token);
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            return root.ValueKind == JsonValueKind.Object && root.TryGetProperty("obs", out _) && root.TryGetProperty("onAir", out _) ? Core.Probe.ViewSwitcher : Core.Probe.Other;
        }
        catch (OperationCanceledException)
        {
            return Core.Probe.Slow;
        }
        catch (JsonException)
        {
            return Core.Probe.Other;
        }
        catch (HttpRequestException e) when (e.HttpRequestError == HttpRequestError.InvalidResponse)
        {
            return Core.Probe.Other;
        }
        catch (HttpRequestException)
        {
            return Core.Probe.None;
        }
    }

    /// <summary>What answers, asking again for up to <see cref="slowFor"/> while it's slow (a busy server isn't "something else" yet).</summary>
    public async Task<Probe> SettledProbe(Uri baseUri, CancellationToken ct)
    {
        var deadline = DateTime.UtcNow + slowFor;
        while (true)
        {
            var p = await Probe(baseUri, TimeSpan.FromSeconds(1.5));
            if (p != Core.Probe.Slow || DateTime.UtcNow >= deadline || ct.IsCancellationRequested) return p;
            await Task.Delay(250, ct);
        }
    }

    public async Task<IServer> ConnectOrStart(Uri baseUri, Func<Launch> launch, CancellationToken ct)
    {
        var taken = new ServerException(ServerError.PortTaken(baseUri.Port.ToString()));
        switch (await SettledProbe(baseUri, ct))
        {
            case Core.Probe.Other or Core.Probe.Slow: throw taken;
            case Core.Probe.None: return await Start(baseUri, launch(), ct);
        }
        ServerInfo info;
        try
        {
            info = await new ServerApi(baseUri, timeout: TimeSpan.FromSeconds(2)).Info();
        }
        catch (Exception e) when (e is HttpRequestException or ServerApiException or OperationCanceledException)
        {
            // It answered a moment ago but not this: ask again rather than attach to something that may be gone.
            return await SettledProbe(baseUri, ct) switch
            {
                Core.Probe.ViewSwitcher => new AttachedServer(baseUri),
                Core.Probe.None => await Start(baseUri, launch(), ct),
                _ => throw taken,
            };
        }
        if (!info.IsOrphan(Environment.ProcessId, Processes.Alive) || info.Pid is not int pid) return new AttachedServer(baseUri);
        // The pid comes from whatever answers on the port: it's only ended once it's confirmed to be this
        // app's own server executable, left without its app.
        var l = launch();
        if (IsLeftoverServer(pid, l.Executable))
        {
            await StopOrphan(pid, baseUri, ct);
            return await Start(baseUri, l, ct);
        }
        return await PortFrees(baseUri, TimeSpan.FromSeconds(4), ct) ? await Start(baseUri, launch(), ct) : new AttachedServer(baseUri);
    }

    /// <summary>Whether <paramref name="pid"/> runs the same executable this app launches.</summary>
    static bool IsLeftoverServer(int pid, string executable)
    {
        var path = Processes.ExecutablePath(pid);
        return path is not null && string.Equals(Path.GetFullPath(path), Path.GetFullPath(executable), StringComparison.OrdinalIgnoreCase);
    }

    async Task StopOrphan(int pid, Uri baseUri, CancellationToken ct)
    {
        try
        {
            using var p = Process.GetProcessById(pid);
            p.Kill(); // no stdin of ours to close: its app is gone
        }
        catch (Exception) { }
        if (await PortFrees(baseUri, TimeSpan.FromSeconds(6), ct)) return;
        throw new ServerException(ServerError.StartFailed($"A ViewSwitcher server left over from before (process {pid}) wouldn't stop. End it in Task Manager, then open ViewSwitcher again."));
    }

    async Task<bool> PortFrees(Uri baseUri, TimeSpan within, CancellationToken ct)
    {
        var deadline = DateTime.UtcNow + within;
        while (DateTime.UtcNow < deadline && !ct.IsCancellationRequested)
        {
            if (await Probe(baseUri, TimeSpan.FromSeconds(0.5)) == Core.Probe.None) return true;
            await Task.Delay(150, ct);
        }
        return false;
    }

    async Task<IServer> Start(Uri baseUri, Launch launch, CancellationToken ct)
    {
        var server = OwnedServer.Start(baseUri, launch, job);
        var deadline = DateTime.UtcNow + readyTimeout;
        while (DateTime.UtcNow < deadline)
        {
            // Quit, or a restart called off: don't leave a server starting with nobody waiting for it.
            if (ct.IsCancellationRequested)
            {
                await server.StopAsync();
                throw new OperationCanceledException(ct);
            }
            if (server.ExitCode is not null)
            {
                await Task.Delay(100, CancellationToken.None); // let the last output land in the tail
                throw new ServerException(ServerError.StartFailed($"The ViewSwitcher server stopped while starting.\n\n{server.Tail.Trim()}"));
            }
            if (await Probe(baseUri, TimeSpan.FromSeconds(0.5)) == Core.Probe.ViewSwitcher) return server;
            await Task.Delay(150, CancellationToken.None);
        }
        await server.StopAsync();
        throw new ServerException(ServerError.StartFailed($"The ViewSwitcher server didn't answer within {(int)readyTimeout.TotalSeconds} s.\n\n{server.Tail.Trim()}"));
    }
}

/// <summary>A server someone else started: never stopped.</summary>
public sealed class AttachedServer(Uri baseUri) : IServer
{
    public Uri Base { get; } = baseUri;
    public bool Owned => false;
    public int? Pid => null;
    public int? ExitCode => null;
#pragma warning disable CS0067 // never raised: an attached server isn't ours to watch
    public event Action<int>? Crashed;
#pragma warning restore CS0067
    public Task StopAsync() => Task.CompletedTask;
}

/// <summary>
/// The app's own server process. Its stdin is a pipe the app holds; closing it is how the app stops the
/// server (Windows has no SIGTERM; apps/server/src/main.ts VIEWSWITCHER_STOP_ON_STDIN), and it's ended
/// outright 3 s later if it hasn't gone.
/// </summary>
public sealed class OwnedServer : IServer
{
    readonly Process process;
    readonly object gate = new();
    readonly StreamWriter? log;
    readonly StringBuilder tail = new();
    readonly TaskCompletionSource exited = new(TaskCreationOptions.RunContinuationsAsynchronously);
    bool stopping;
    int? exitCode;

    public Uri Base { get; }
    public bool Owned => true;
    public int? Pid { get; }
    public int? ExitCode { get { lock (gate) return exitCode; } }
    public event Action<int>? Crashed;
    public string Tail { get { lock (gate) return tail.ToString(); } }

    OwnedServer(Uri baseUri, Process process, StreamWriter? log)
    {
        Base = baseUri;
        this.process = process;
        this.log = log;
        Pid = process.Id;
    }

    public static OwnedServer Start(Uri baseUri, Launch launch, JobObject? job)
    {
        ServerLog.Cap(launch.LogFile);
        StreamWriter? log = null;
        try
        {
            log = new StreamWriter(new FileStream(launch.LogFile, FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete)) { AutoFlush = true };
            log.WriteLine($"\n--- {DateTime.Now:O} starting {launch.Executable} {string.Join(" ", launch.Arguments)}");
        }
        catch (IOException) { }

        var info = new ProcessStartInfo(launch.Executable)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
            WorkingDirectory = Path.GetDirectoryName(launch.Executable) ?? Environment.CurrentDirectory,
        };
        foreach (var a in launch.Arguments) info.ArgumentList.Add(a);
        info.Environment.Clear();
        foreach (var (k, v) in launch.Environment) info.Environment[k] = v;

        var process = new Process { StartInfo = info, EnableRaisingEvents = true };
        try
        {
            process.Start();
        }
        catch (Exception e)
        {
            log?.WriteLine(e.Message);
            log?.Dispose();
            throw new ServerException(ServerError.StartFailed($"The ViewSwitcher server couldn't start.\n\n{e.Message}"));
        }
        if (OperatingSystem.IsWindows())
        {
            try
            {
                job?.Add(process);
            }
            catch (Exception e)
            {
                log?.WriteLine($"--- couldn't put the server in the app's job ({e.Message}); it still exits when the app does (VIEWSWITCHER_PARENT_PID)");
            }
        }
        var server = new OwnedServer(baseUri, process, log);
        process.OutputDataReceived += (_, e) => server.Write(e.Data);
        process.ErrorDataReceived += (_, e) => server.Write(e.Data);
        process.Exited += (_, _) => server.DidExit();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        if (process.HasExited) server.DidExit();
        return server;
    }

    void Write(string? line)
    {
        if (line is null) return;
        lock (gate)
        {
            try { log?.WriteLine(line); } catch (IOException) { } catch (ObjectDisposedException) { }
            tail.Append(line).Append('\n');
            if (tail.Length > 2000) tail.Remove(0, tail.Length - 2000);
        }
    }

    void DidExit()
    {
        bool wasStopping;
        int code;
        // The last output lines, outside the lock: their handlers take it.
        try { process.WaitForExit(); } catch (Exception) { }
        lock (gate)
        {
            if (exitCode is not null) return;
            code = SafeExitCode();
            exitCode = code;
            wasStopping = stopping;
            try { log?.WriteLine($"--- server exited ({code})"); log?.Dispose(); } catch (Exception) { }
        }
        exited.TrySetResult();
        if (!wasStopping) Crashed?.Invoke(code);
    }

    int SafeExitCode()
    {
        try { return process.ExitCode; } catch (Exception) { return -1; }
    }

    public async Task StopAsync()
    {
        lock (gate)
        {
            if (exitCode is not null) return;
            stopping = true;
        }
        try { process.StandardInput.Close(); } catch (Exception) { } // the server's stop signal
        if (await Task.WhenAny(exited.Task, Task.Delay(3000)) != exited.Task)
        {
            try { process.Kill(entireProcessTree: true); } catch (Exception) { }
            await Task.WhenAny(exited.Task, Task.Delay(3000));
        }
    }
}
