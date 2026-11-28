namespace ViewSwitcher.Core.Tests;

// The pure parts of the Kit port: the tray's text and menu, navigation, pairing text, the shell script.
// Each mirrors the Swift test it ports (MenuStatusTests, StatusMenuTests, NavigationPolicyTests,
// RemotesTests, ShellAndFeedTests).

public class MenuStatusTests
{
    static LiveState State(string? onAir = null, bool connected = true, ObsSetup? setup = null, bool streaming = false, bool recording = false, string? auth = null, UsbStatus? usb = null) =>
        new(onAir is null ? null : new OnAir(onAir), new ObsStatus(connected, recording, streaming, auth), setup, usb);

    static readonly ObsSetup Ready = new(true, true, true);

    [Fact]
    public void NoServer()
    {
        var s = MenuStatus.From(null);
        Assert.Equal("Server not responding", s.OnAir);
        Assert.Equal("OBS: unknown", s.Obs);
        Assert.False(s.Live);
        Assert.False(s.ObsReady);
    }

    [Fact]
    public void OnAirLabelIsTheTitleAndRedIcon()
    {
        var s = MenuStatus.From(State("Starting Soon", setup: Ready));
        Assert.Equal("Starting Soon", s.Title);
        Assert.True(s.Live);
        Assert.Equal("On air: Starting Soon", s.OnAir);
        Assert.Equal("OBS: connected", s.Obs);
        Assert.True(s.ObsReady);
    }

    [Fact]
    public void LongTitlesAreCutWithAnEllipsis()
    {
        var s = MenuStatus.From(State("A very long scene name for a show that runs long", setup: Ready));
        Assert.InRange(s.Title.Length, 2, MenuStatus.TitleMax); // a cut that ends in a space is trimmed
        Assert.Equal("A very long scene name…", s.Title);
        Assert.EndsWith("…", s.Title);
    }

    [Fact]
    public void ObsLines()
    {
        Assert.Equal("OBS: needs setup", MenuStatus.From(State(setup: new(true, false, true))).Obs);
        Assert.Equal("OBS: connected · add Camera, Screen", MenuStatus.From(State(setup: Ready with { MissingDevices = ["Camera", "Screen"] })).Obs);
        Assert.Equal("OBS: connected · live, recording", MenuStatus.From(State(setup: Ready, streaming: true, recording: true)).Obs);
        Assert.Equal("OBS: needs a password", MenuStatus.From(State(connected: false, auth: "missing")).Obs);
        Assert.Equal("OBS: refused the password", MenuStatus.From(State(connected: false, auth: "wrong")).Obs);
        Assert.Equal("OBS: not connected", MenuStatus.From(State(connected: false)).Obs);
        Assert.False(MenuStatus.From(State(setup: new(true, true, true, Ordered: false))).ObsReady);
    }

    [Fact]
    public void UsbLine()
    {
        Assert.Equal("iPhone or iPad: USB link off", MenuStatus.From(State()).Ipad);
        Assert.Equal("iPhone: connected over USB", MenuStatus.From(State(usb: new(true, true, true, "iPhone"))).Ipad);
    }

    [Fact]
    public void ServerMessagesAreReadLeniently()
    {
        var s = ServerMessage.State($$"""{"t":"state","state":{{TestServers.StateJson}}}""");
        Assert.NotNull(s);
        Assert.False(s!.Obs.Connected);
        Assert.Null(ServerMessage.State("""{"t":"library:changed","paths":[]}"""));
        Assert.Null(ServerMessage.State("not json"));
        var later = ServerMessage.State("""{"t":"state","state":{"onAir":{"label":"BRB","path":"x"},"obs":{"connected":true,"streaming":true,"newField":1},"somethingNew":[1,2]}}""");
        Assert.Equal("BRB", later!.OnAir!.Label);
        Assert.True(later.ObsLive);
    }
}

public class StatusMenuTests
{
    static StatusMenu.Context Ctx(ServerState server, MenuStatus? status = null, bool obs = true, bool wifi = false, bool usb = false) =>
        new(status ?? MenuStatus.From(new LiveState(null, new ObsStatus(obs), new ObsSetup(true, true, true))), server, obs, wifi, Updater: true, OpenAtLogin: false, Usb: usb);

    static List<string?> Titles(StatusMenu.Context c) => StatusMenu.Items(c).Select(i => i.Title).ToList();

    static StatusMenu.ActionItem Find(StatusMenu.Context c, StatusMenu.Action a) => StatusMenu.Items(c).OfType<StatusMenu.ActionItem>().Single(i => i.Action == a);

    [Fact]
    public void OwnedServerOffersEverything()
    {
        var c = Ctx(ServerState.Owned, wifi: true);
        var titles = Titles(c);
        Assert.Equal(["Nothing on air", "OBS: connected", null, "Open ViewSwitcher", "Edit with AI…", "Open in Browser", "Open Library Folder", "Set Up OBS Again", null, StatusMenu.WifiTitle, "Phones and Tablets…", null, "Check for Updates…", "Open at Login", "Show Server Log", null, "Quit ViewSwitcher"], titles);
        Assert.True(Find(c, StatusMenu.Action.ToggleWifi).Checked);
        Assert.Equal(RemoteText.Help, Find(c, StatusMenu.Action.ToggleWifi).ToolTip);
    }

    [Fact]
    public void TheUsbLineOnlyWhereThereIsAUsbLink()
    {
        Assert.DoesNotContain("iPhone or iPad: USB link off", Titles(Ctx(ServerState.Owned)));
        Assert.Contains("iPhone or iPad: USB link off", Titles(Ctx(ServerState.Owned, usb: true)));
    }

    [Fact]
    public void AttachedServerKeepsRunningOnQuitAndHasNoPairing()
    {
        var c = Ctx(ServerState.Attached);
        Assert.Equal("Quit ViewSwitcher (server keeps running)", Titles(c).Last());
        Assert.False(Find(c, StatusMenu.Action.ToggleWifi).Enabled);
        Assert.False(Find(c, StatusMenu.Action.OpenRemotes).Enabled);
        Assert.True(Find(c, StatusMenu.Action.OpenInBrowser).Enabled);
    }

    [Fact]
    public void WhileTheServerIsDownItsLineLeadsAndRestartIsOffered()
    {
        var crashed = Ctx(ServerState.Crashed(1), MenuStatus.From(null), obs: false);
        Assert.Equal("Server keeps stopping", Titles(crashed)[0]);
        Assert.True(Find(crashed, StatusMenu.Action.RestartServer).Enabled);
        Assert.False(Find(crashed, StatusMenu.Action.EditWithAI).Enabled);
        Assert.False(Find(crashed, StatusMenu.Action.SetUpObs).Enabled);
        Assert.Equal("Restarting Server…", Find(Ctx(ServerState.Restarting(1, 1)), StatusMenu.Action.RestartServer).Text);
        Assert.False(Find(Ctx(ServerState.Starting), StatusMenu.Action.RestartServer).Enabled);
        Assert.Equal("Server stopped again: restarting…", StatusMenu.ServerLine(ServerState.Restarting(2, 1)));
        Assert.DoesNotContain(StatusMenu.Items(Ctx(ServerState.Owned)), i => i is StatusMenu.ActionItem { Action: StatusMenu.Action.RestartServer });
    }

    [Fact]
    public void SetUpObsNeedsObsConnected()
    {
        Assert.False(Find(Ctx(ServerState.Owned, obs: false), StatusMenu.Action.SetUpObs).Enabled);
        var notReady = MenuStatus.From(new LiveState(null, new ObsStatus(true), new ObsSetup(false, false, false)));
        Assert.Equal("Set Up OBS…", Find(Ctx(ServerState.Owned, notReady), StatusMenu.Action.SetUpObs).Text);
    }
}

public class RestartPolicyTests
{
    [Fact]
    public void ZeroThenTwoThenTenThenStop()
    {
        var p = RestartPolicy.Standard;
        Assert.Equal(TimeSpan.Zero, p.Delay(1));
        Assert.Equal(TimeSpan.FromSeconds(2), p.Delay(2));
        Assert.Equal(TimeSpan.FromSeconds(10), p.Delay(3));
        Assert.Null(p.Delay(4));
        Assert.Null(p.Delay(0));
    }

    [Fact]
    public void OldCrashesDontCount()
    {
        var now = DateTime.UtcNow;
        Assert.Single(RestartPolicy.Standard.Recent([now.AddSeconds(-61), now.AddSeconds(-5)], now));
    }
}

public class NavigationPolicyTests
{
    static readonly Uri Server = new("http://127.0.0.1:7420/");
    static Uri U(string s) => new(s);

    [Fact]
    public void TheMainFrameStaysOnTheServer()
    {
        Assert.Equal(NavigationKind.Allow, NavigationPolicy.Window(U("http://127.0.0.1:7420/editor?x"), Server, mainFrame: true).Kind);
        Assert.Equal(NavigationKind.Allow, NavigationPolicy.Window(U("about:blank"), Server, true).Kind);
        var away = NavigationPolicy.Window(U("https://viewswitcher.com/ai"), Server, true);
        Assert.Equal(NavigationKind.OpenInBrowser, away.Kind);
        Assert.Equal(U("https://viewswitcher.com/ai"), away.Url);
        Assert.Equal(NavigationKind.OpenInBrowser, NavigationPolicy.Window(U("http://127.0.0.1:7421/"), Server, true).Kind); // another port is another site
        Assert.Equal(NavigationKind.OpenInBrowser, NavigationPolicy.Window(U("http://localhost:7420/"), Server, true).Kind);
    }

    [Fact]
    public void OtherSchemesAreRefused()
    {
        foreach (var s in new[] { @"file:///C:/Windows/win.ini", "ms-settings:privacy", "javascript:alert(1)", "vscode://file/x", "cursor://anysphere.cursor-deeplink/mcp/install?name=x" })
            Assert.Equal(NavigationKind.Deny, NavigationPolicy.Window(U(s), Server, true).Kind);
    }

    [Fact]
    public void CursorsInstallOnlyFromTheSwitchersOwnPage()
    {
        var link = U("cursor://anysphere.cursor-deeplink/mcp/install?name=viewswitcher&config=e30");
        Assert.Equal(NavigationKind.OpenInBrowser, NavigationPolicy.Window(link, Server, true, fromSwitcher: true).Kind);
        Assert.True(NavigationPolicy.StartedBySwitcher(U("http://127.0.0.1:7420/"), true, Server));
        Assert.False(NavigationPolicy.StartedBySwitcher(U("http://127.0.0.1:7420/library/daisy/templates/brb.html"), true, Server));
        Assert.False(NavigationPolicy.StartedBySwitcher(U("http://127.0.0.1:7420/"), false, Server));
        Assert.False(NavigationPolicy.IsCursorInstall(U("cursor://anysphere.cursor-deeplink/other")));
    }

    [Fact]
    public void NewWindowsNeverOpenInside()
    {
        Assert.Equal(NavigationKind.OpenInBrowser, NavigationPolicy.Window(U("http://127.0.0.1:7420/program"), Server, true, newWindow: true).Kind);
        Assert.Equal(NavigationKind.Deny, NavigationPolicy.Window(U("file:///C:/x"), Server, true, newWindow: true).Kind);
    }

    [Fact]
    public void FramesLoadWebAndDataButNoAppSchemes()
    {
        Assert.Equal(NavigationKind.Allow, NavigationPolicy.Window(U("http://127.0.0.1:7420/library/a/b.html"), Server, mainFrame: false).Kind);
        Assert.Equal(NavigationKind.Allow, NavigationPolicy.Window(U("data:text/html,x"), Server, false).Kind);
        Assert.Equal(NavigationKind.Deny, NavigationPolicy.Window(U("file:///C:/x"), Server, false).Kind);
    }

    [Fact]
    public void TheExtensionIsTheOneDownload()
    {
        Assert.True(NavigationPolicy.IsExtensionDownload(U("http://127.0.0.1:7420/api/agent/viewswitcher.mcpb"), Server));
        Assert.False(NavigationPolicy.IsExtensionDownload(U("http://127.0.0.1:7420/library/daisy/assets/x.zip"), Server));
        Assert.False(NavigationPolicy.IsExtensionDownload(U("http://evil.example/api/agent/viewswitcher.mcpb"), Server));
    }

    [Fact]
    public void RetryKeepsThePage()
    {
        Assert.Equal(U("http://127.0.0.1:7420/editor?path=x"), NavigationPolicy.RetryTarget(U("http://127.0.0.1:7420/editor?path=x"), null, Server));
        Assert.Equal(U("http://127.0.0.1:7420/streams"), NavigationPolicy.RetryTarget(U("https://elsewhere.example/"), U("http://127.0.0.1:7420/streams"), Server));
        Assert.Equal(U("http://127.0.0.1:7420/"), NavigationPolicy.RetryTarget(null, null, Server));
    }
}

public class RemoteTextTests
{
    [Fact]
    public void CodesAreReadInTwoHalves() => Assert.Equal("K7PQ-2MXA", RemoteText.Code("K7PQ2MXA"));

    [Fact]
    public void Expiry()
    {
        var now = DateTimeOffset.FromUnixTimeSeconds(1_000_000);
        Assert.Equal("Expires in 4:59", RemoteText.Expiry((1_000_000 + 299) * 1000.0, now));
        Assert.Equal("Expires in 5:00", RemoteText.Expiry((1_000_000 + 400) * 1000.0, now)); // never more than a code lives
        Assert.Equal("Expired", RemoteText.Expiry((1_000_000 - 1) * 1000.0, now));
    }

    [Fact]
    public void LastSeen()
    {
        var now = DateTimeOffset.FromUnixTimeSeconds(10_000_000);
        RemoteDevice D(double agoSeconds, int connected = 0) => new("d", "Phone", 0, (10_000_000 - agoSeconds) * 1000, connected);
        Assert.Equal("Connected now", RemoteText.LastSeen(D(5000, 1), now));
        Assert.Equal("Seen just now", RemoteText.LastSeen(D(10), now));
        Assert.Equal("Seen 3 min ago", RemoteText.LastSeen(D(200), now));
        Assert.Equal("Seen 2 h ago", RemoteText.LastSeen(D(7300), now));
        Assert.Equal("Seen 1 day ago", RemoteText.LastSeen(D(90_000), now));
        Assert.Equal("Seen 3 days ago", RemoteText.LastSeen(D(3 * 86_400 + 5), now));
    }
}

public class ShellInfoTests
{
    [Fact]
    public void TheScriptCarriesTheKindAndAQuotedNotice()
    {
        var info = new ShellInfo("It's \"restarting\" </script>");
        var json = info.ToJson();
        Assert.Contains("\"kind\":\"windows\"", json);
        Assert.DoesNotContain("</script>", json); // System.Text.Json escapes < and >
        var script = info.UserScript();
        Assert.Contains(json, script);
        Assert.Contains("window.top !== window", script);
        Assert.DoesNotContain("postMessage", script); // the page has no way to talk to the app
        Assert.Equal($"window.viewswitcherShell && window.viewswitcherShell.apply({json});", info.ApplyScript());
        Assert.Contains("\"notice\":null", new ShellInfo().ToJson());
    }
}

public class ServerInfoTests
{
    [Fact]
    public void AnOrphanIsTheAppsOwnServerWhoseAppIsGone()
    {
        var info = new ServerInfo("C:\\lib", 7420, Sidecar: true, ParentPid: 100, Pid: 200);
        Assert.True(info.IsOrphan(ownPid: 300, isAlive: _ => false));
        Assert.False(info.IsOrphan(300, _ => true));
        Assert.False(info.IsOrphan(100, _ => false)); // its parent is this app
        Assert.False((info with { Sidecar = false }).IsOrphan(300, _ => false));
        Assert.False((info with { Pid = null }).IsOrphan(300, _ => false));
    }
}

public class ServerLogTests
{
    [Fact]
    public void OneLogPerBuild()
    {
        Assert.Equal(Path.Combine("L", "ViewSwitcher", "Logs", "server.log"), ServerLog.File("L", dev: false, null));
        Assert.Equal(Path.Combine("L", "ViewSwitcher", "Logs", "server-dev.log"), ServerLog.File("L", dev: true, null));
        Assert.Equal(Path.Combine("E", "server.log"), ServerLog.File("L", dev: false, "E"));
    }

    [Fact]
    public void ALongLogStartsOver()
    {
        var dir = TestServers.TempDir();
        var file = Path.Combine(dir, "logs", "server.log");
        ServerLog.Cap(file, max: 10);
        Assert.True(Directory.Exists(Path.Combine(dir, "logs")));
        File.WriteAllText(file, "short");
        ServerLog.Cap(file, max: 10);
        Assert.Equal("short", File.ReadAllText(file));
        File.WriteAllText(file, new string('x', 50));
        ServerLog.Cap(file, max: 10);
        Assert.Equal("", File.ReadAllText(file));
    }
}

public class AppSettingsTests
{
    [Fact]
    public void RemembersWifiAndTheWindow()
    {
        var file = Path.Combine(TestServers.TempDir(), "App", "settings.json");
        Assert.False(AppSettings.Load(file).WifiRemotes); // off by default
        new AppSettings { WifiRemotes = true, Window = new(10, 20, 1440, 900, false) }.Save(file);
        var s = AppSettings.Load(file);
        Assert.True(s.WifiRemotes);
        Assert.Equal(1440, s.Window!.Width);
        File.WriteAllText(file, "{ broken");
        Assert.False(AppSettings.Load(file).WifiRemotes);
    }
}
