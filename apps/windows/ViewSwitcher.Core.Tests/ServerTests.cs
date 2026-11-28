using System.Diagnostics;

namespace ViewSwitcher.Core.Tests;

// Kit's ServerControllerTests, ServerSupervisorTests and ServerAPITests on Windows: Bun stub servers,
// started and killed for real (skipped without bun).

public sealed class ServerControllerTests : IDisposable
{
    readonly string tmp = TestServers.TempDir();
    readonly List<IServer> started = [];
    static readonly ServerConnector Fast = new(readyTimeout: TimeSpan.FromSeconds(10), slowFor: TimeSpan.FromSeconds(0.5));

    public void Dispose()
    {
        foreach (var s in started) s.StopAsync().Wait(5000);
        try { Directory.Delete(tmp, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    async Task<IServer> Connect(Uri b, Launch launch)
    {
        var s = await Fast.ConnectOrStart(b, () => launch, CancellationToken.None);
        started.Add(s);
        return s;
    }

    [Fact]
    public async Task ProbeTellsViewSwitcherFromOthersAndNothing()
    {
        using var vs = TestServers.Stub.Answering(TestServers.StateJson);
        using var other = TestServers.Stub.Answering("""{"hello":"world"}""");
        using var missing = TestServers.Stub.Answering("nope", 404);
        Assert.Equal(Probe.ViewSwitcher, await Fast.Probe(vs.Base, TimeSpan.FromSeconds(2)));
        Assert.Equal(Probe.Other, await Fast.Probe(other.Base, TimeSpan.FromSeconds(2)));
        Assert.Equal(Probe.Other, await Fast.Probe(missing.Base, TimeSpan.FromSeconds(2)));
        Assert.Equal(Probe.None, await Fast.Probe(TestServers.BaseFor(TestServers.FreePort()), TimeSpan.FromSeconds(2)));
    }

    [Fact]
    public async Task AttachesToARunningServerAndNeverStopsIt()
    {
        using var vs = TestServers.Stub.Answering(TestServers.StateJson);
        var s = await Fast.ConnectOrStart(vs.Base, () => throw new InvalidOperationException("must not start one"), CancellationToken.None);
        Assert.False(s.Owned);
        await s.StopAsync();
        Assert.Equal(Probe.ViewSwitcher, await Fast.Probe(vs.Base, TimeSpan.FromSeconds(2)));
    }

    [Fact]
    public async Task APortSomethingElseHoldsIsTaken()
    {
        using var other = TestServers.Stub.Answering("<html>", 200);
        var e = await Assert.ThrowsAsync<ServerException>(() => Fast.ConnectOrStart(other.Base, () => throw new InvalidOperationException(), CancellationToken.None));
        Assert.Equal(ServerErrorKind.PortTaken, e.Error.Kind);
        Assert.Contains($"port {other.Base.Port}", e.Message);
    }

    [SkippableFact]
    public async Task StartsOwnsAndStopsThroughStdin()
    {
        var port = TestServers.FreePort();
        var b = TestServers.BaseFor(port);
        var s = await Connect(b, TestServers.Launch(port, TestServers.Serving, tmp));
        Assert.True(s.Owned);
        Assert.NotNull(s.Pid);
        Assert.Equal(Probe.ViewSwitcher, await Fast.Probe(b, TimeSpan.FromSeconds(2)));
        var watch = Stopwatch.StartNew();
        await s.StopAsync();
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(2.5), $"closing stdin stopped it ({watch.Elapsed})"); // not the 3 s kill
        Assert.Equal(0, s.ExitCode);
        Assert.Equal(Probe.None, await Fast.Probe(b, TimeSpan.FromSeconds(2)));
        Assert.Contains("stub up", File.ReadAllText(Path.Combine(tmp, "logs", "server.log")));
    }

    [SkippableFact]
    public async Task AServerThatIgnoresStdinIsEndedAfterThreeSeconds()
    {
        var port = TestServers.FreePort();
        var deaf = $"process.stdin.resume(); Bun.serve({{ hostname: '127.0.0.1', port: Number(process.env.PORT), fetch: () => Response.json({TestServers.StateJson}) }});";
        var s = await Connect(TestServers.BaseFor(port), TestServers.Launch(port, deaf, tmp));
        var watch = Stopwatch.StartNew();
        await s.StopAsync();
        Assert.InRange(watch.Elapsed.TotalSeconds, 2.5, 8);
        Assert.NotNull(s.ExitCode);
    }

    [SkippableFact]
    public async Task OneThatDiesWhileStartingSaysWhy()
    {
        var port = TestServers.FreePort();
        var e = await Assert.ThrowsAsync<ServerException>(() => Connect(TestServers.BaseFor(port), TestServers.Launch(port, "console.error('no library here'); process.exit(3);", tmp)));
        Assert.Equal(ServerErrorKind.StartFailed, e.Error.Kind);
        Assert.Contains("stopped while starting", e.Message);
        Assert.Contains("no library here", e.Message);
    }

    [SkippableFact]
    public async Task OneThatNeverAnswersIsGivenUpOn()
    {
        var port = TestServers.FreePort();
        var quick = new ServerConnector(readyTimeout: TimeSpan.FromSeconds(1.5), slowFor: TimeSpan.FromSeconds(0.3));
        var e = await Assert.ThrowsAsync<ServerException>(() => quick.ConnectOrStart(TestServers.BaseFor(port), () => TestServers.Launch(port, $"{TestServers.StopsOnStdin} console.log('thinking'); setInterval(() => {{}}, 1000);", tmp), CancellationToken.None));
        Assert.Contains("didn't answer within 1 s", e.Message);
        Assert.Contains("thinking", e.Message);
    }

    [Fact]
    public async Task AMissingExecutableSaysSo()
    {
        var port = TestServers.FreePort();
        var launch = new Launch(Path.Combine(tmp, "nope.exe"), [], new Dictionary<string, string>(), Path.Combine(tmp, "logs", "server.log"));
        var e = await Assert.ThrowsAsync<ServerException>(() => Fast.ConnectOrStart(TestServers.BaseFor(port), () => launch, CancellationToken.None));
        Assert.Contains("couldn't start", e.Message);
    }

    [SkippableFact]
    public async Task ACrashIsReported()
    {
        var port = TestServers.FreePort();
        var s = await Connect(TestServers.BaseFor(port), TestServers.Launch(port, TestServers.Serving, tmp));
        var crashed = new TaskCompletionSource<int>();
        s.Crashed += code => crashed.TrySetResult(code);
        Process.GetProcessById(s.Pid!.Value).Kill();
        Assert.Same(crashed.Task, await Task.WhenAny(crashed.Task, Task.Delay(5000)));
        Assert.NotNull(s.ExitCode);
    }
}

public sealed class ServerSupervisorTests : IDisposable
{
    readonly string tmp = TestServers.TempDir();
    readonly List<ServerSupervisor> supervisors = [];
    /// <summary>Fast enough for a test, in the same shape as the real one.</summary>
    static readonly RestartPolicy Quick = new([TimeSpan.Zero, TimeSpan.FromSeconds(0.3), TimeSpan.FromSeconds(0.6)], TimeSpan.FromSeconds(60));

    public void Dispose()
    {
        foreach (var s in supervisors) s.Quit()?.StopAsync().Wait(5000);
        try { Directory.Delete(tmp, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    (ServerSupervisor, Uri) Make(RestartPolicy? policy = null, string? script = null)
    {
        var port = TestServers.FreePort();
        var b = TestServers.BaseFor(port);
        var launch = TestServers.Launch(port, script ?? TestServers.Serving, tmp);
        var s = new ServerSupervisor(b, () => launch, new ServerConnector(TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(0.5)), policy ?? Quick);
        supervisors.Add(s);
        return (s, b);
    }

    /// <summary>Kill the running server as a crash would, and wait until the supervisor has it back (or gave up).</summary>
    static async Task<int?> Crash(ServerSupervisor s)
    {
        if (s.Server?.Pid is not int old) return null;
        Process.GetProcessById(old).Kill();
        await TestServers.Until(() => s.Server?.Pid != old);
        await TestServers.Until(() => s.State == ServerState.Owned || s.State.Stopped);
        return s.Server?.Pid;
    }

    [SkippableFact]
    public async Task StartsItsOwnServerAndStopsItOnQuit()
    {
        var (s, b) = Make();
        var seen = new List<ServerState>();
        s.Changed += (_, next) => { lock (seen) seen.Add(next); };
        await s.Start();
        Assert.Equal(ServerState.Owned, s.State);
        Assert.Equal([ServerState.Owned], seen); // starting is the state it begins in
        var own = s.Quit();
        Assert.Equal(ServerState.Quitting, s.State);
        Assert.NotNull(own);
        await own!.StopAsync();
        Assert.Equal(Probe.None, await new ServerConnector().Probe(b, TimeSpan.FromSeconds(2)));
    }

    [Fact]
    public async Task AttachesAndNeverStopsWhatItDidntStart()
    {
        using var running = TestServers.Stub.Answering(TestServers.StateJson);
        var s = new ServerSupervisor(running.Base, () => throw new ServerException(ServerError.StartFailed("must not start one")), policy: Quick);
        supervisors.Add(s);
        await s.Start();
        Assert.Equal(ServerState.Attached, s.State);
        Assert.Null(s.Quit());
    }

    [SkippableFact]
    public async Task BringsACrashedServerBack()
    {
        var (s, b) = Make();
        var seen = new List<ServerState>();
        s.Changed += (_, next) => { lock (seen) seen.Add(next); };
        await s.Start();
        var first = s.Server?.Pid;
        var second = await Crash(s);
        Assert.Equal(ServerState.Owned, s.State);
        Assert.NotNull(second);
        Assert.NotEqual(first, second);
        lock (seen)
        {
            Assert.Equal(3, seen.Count);
            Assert.Equal(ServerStateKind.Restarting, seen[1].Kind);
            Assert.Equal(1, seen[1].Attempt);
        }
        Assert.Equal(Probe.ViewSwitcher, await new ServerConnector().Probe(b, TimeSpan.FromSeconds(2)));
    }

    [SkippableFact]
    public async Task WaitsLongerEachTimeThenGivesUpAndRestartServerStartsAfresh()
    {
        var (s, _) = Make();
        var attempts = new List<int>();
        s.Changed += (_, next) => { if (next.Kind == ServerStateKind.Restarting) lock (attempts) attempts.Add(next.Attempt); };
        await s.Start();
        for (var i = 0; i < 3; i++) await Crash(s);
        Assert.Equal(ServerState.Owned, s.State); // three crashes in a minute are each restarted
        Assert.Equal([1, 2, 3], attempts);
        Process.GetProcessById(s.Server!.Pid!.Value).Kill();
        Assert.True(await TestServers.Until(() => s.State.Kind == ServerStateKind.Crashed), $"the fourth crash stops the restarts ({s.State})");
        Assert.Null(s.Server);
        await s.Start();
        Assert.Equal(ServerState.Owned, s.State);
        await Crash(s);
        Assert.Equal(1, attempts.Last()); // the count started over
    }

    [SkippableFact]
    public async Task QuitWhileWaitingToRestartRestartsNothing()
    {
        var (s, b) = Make(new RestartPolicy([TimeSpan.FromSeconds(0.5)], TimeSpan.FromSeconds(60)));
        await s.Start();
        Process.GetProcessById(s.Server!.Pid!.Value).Kill();
        Assert.True(await TestServers.Until(() => s.State.Kind == ServerStateKind.Restarting));
        Assert.Null(s.Quit());
        await Task.Delay(1500);
        Assert.Equal(ServerState.Quitting, s.State);
        Assert.Equal(Probe.None, await new ServerConnector().Probe(b, TimeSpan.FromSeconds(2)));
    }

    [Fact]
    public async Task APortSomeoneElseHoldsFails()
    {
        using var other = TestServers.Stub.Answering("<html>");
        var s = new ServerSupervisor(other.Base, () => throw new InvalidOperationException(), new ServerConnector(slowFor: TimeSpan.FromSeconds(0.3)), Quick);
        supervisors.Add(s);
        await s.Start();
        Assert.Equal(ServerStateKind.Failed, s.State.Kind);
        Assert.Equal(ServerErrorKind.PortTaken, s.State.Error!.Kind);
        Assert.True(s.State.Stopped);
    }

    [Fact]
    public async Task AnAttachedServerThatGoesAwayIsLost()
    {
        var running = TestServers.Stub.Answering(TestServers.StateJson);
        var s = new ServerSupervisor(running.Base, () => throw new InvalidOperationException(), policy: Quick);
        supervisors.Add(s);
        await s.Start();
        await s.CheckAttached();
        Assert.Equal(ServerState.Attached, s.State); // still answering
        running.Dispose();
        await s.CheckAttached();
        Assert.Equal(ServerState.Lost, s.State);
    }
}

public sealed class ServerApiTests
{
    [Fact]
    public async Task PairingCallsCarryTheSecretAndOthersDont()
    {
        const string status = """{"enabled":true,"port":7420,"localName":"studio.local","urls":["http://studio.local:7420/"],"code":{"code":"K7PQ2MXA","expiresAt":1},"devices":[{"id":"a","name":"Phone","pairedAt":1,"lastSeen":2,"connected":1}],"pairUrl":"http://192.168.1.5:7420/pair?c=K7PQ2MXA"}""";
        using var stub = new TestServers.Stub(r => r.Url!.AbsolutePath switch
        {
            "/api/remote/code" => (200, status),
            "/api/remote" => (200, status),
            "/api/obs/setup" => (200, """{"missing":["Camera"],"switched":false}"""),
            _ => (500, """{"error":"nope"}"""),
        });
        var api = new ServerApi(stub.Base, "secret");
        var s = await api.NewPairingCode();
        Assert.Equal("K7PQ2MXA", s.Code!.Code);
        Assert.Equal("Phone", s.Devices[0].Name);
        Assert.Equal("http://192.168.1.5:7420/pair?c=K7PQ2MXA", s.PairUrl);
        await api.SetRemoteEnabled(false);
        var setup = await api.SetUpObs();
        Assert.Equal(["Camera"], setup.Missing);
        lock (stub.Requests)
        {
            Assert.Equal(("POST", "/api/remote/code", "secret"), (stub.Requests[0].Method, stub.Requests[0].Path, stub.Requests[0].Admin));
            Assert.Equal("""{"enabled":false}""", stub.Requests[1].Body);
            Assert.Null(stub.Requests[2].Admin); // only the pairing calls carry it
        }
        var e = await Assert.ThrowsAsync<ServerApiException>(() => api.Info());
        Assert.Equal("nope", e.Message);
    }

    [Fact]
    public async Task AServerWithAnotherSecretSaysPairingNeedsTheAppsOwn()
    {
        using var stub = TestServers.Stub.Answering("""{"error":"Not found"}""", 404);
        var e = await Assert.ThrowsAsync<ServerApiException>(() => new ServerApi(stub.Base, "secret").RemoteStatus());
        Assert.Equal(ServerApi.PairingNeedsOwnServer, e.Message);
    }
}
