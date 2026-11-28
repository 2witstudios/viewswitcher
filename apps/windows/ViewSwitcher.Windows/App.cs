using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Markup;
using ViewSwitcher.Core;

namespace ViewSwitcher.Windows;

/// <summary>
/// The Windows app (the Mac's AppDelegate): the server's whole life through ServerSupervisor, what the
/// person sees as it comes and goes (the tray, a notification, the window's banner), and the tray's actions.
/// </summary>
public sealed partial class App : Application, IXamlMetadataProvider
{
    // Code-only WinUI: the WinUI controls' own XAML types, which a XAML App would generate.
    readonly Microsoft.UI.Xaml.XamlTypeInfo.XamlControlsXamlMetaDataProvider controls = new();
    public IXamlType GetXamlType(Type type) => controls.GetXamlType(type);
    public IXamlType GetXamlType(string fullName) => controls.GetXamlType(fullName);
    public XmlnsDefinition[] GetXmlnsDefinitions() => controls.GetXmlnsDefinitions();

    public static new App Current => (App)Application.Current;

    ServerSupervisor supervisor = null!;
    LiveState? live;
    SwitcherWindow? switcher;
    RemotesWindow? remotes;
    LiveClient? liveClient;
    Tray? tray;
    readonly Announcer announcer = new();
    Updates? updates;
    E2E? e2e;
    /// <summary>The banner over the switcher, kept here so a window opened later shows it too.</summary>
    (string Text, DateTime? Until)? notice;
    readonly bool startHidden;
    bool quitting;

    public App(bool startHidden)
    {
        this.startHidden = startHidden;
        UnhandledException += (_, e) =>
        {
            try { File.AppendAllText(Env.LogFile, $"\n--- app error: {e.Exception}\n"); } catch (Exception) { }
            e.Handled = true;
        };
    }

    public ServerSupervisor Supervisor => supervisor;
    public SwitcherWindow? Switcher => switcher;
    public RemotesWindow? Remotes => remotes;
    public Tray? TrayIcon => tray;

    protected override async void OnLaunched(LaunchActivatedEventArgs args)
    {
        Resources.MergedDictionaries.Add(new Microsoft.UI.Xaml.Controls.XamlControlsResources());
        if (!Env.E2E) Notifier.Register();
        supervisor = new ServerSupervisor(Env.Base, Env.Launch);
        supervisor.Changed += ServerChanged;
        tray = new Tray(Perform, OpenWindow);
        Render();
        if (Env.E2EDir is { } dir) e2e = new E2E(dir, this);
        updates = Updates.Start();
        await supervisor.Start();
        // At launch, a server that can't start ends the app.
        if (supervisor.State.Kind == ServerStateKind.Failed)
        {
            CouldntStart(supervisor.State.Error!, quit: true);
            return;
        }
        // Opened at login, the app waits in the tray; otherwise the window opens.
        if (!startHidden) OpenWindow();
        e2e?.Report();
    }

    /// <summary>A second launch of ViewSwitcher (Program.cs redirects it here): show the window.</summary>
    public void Activated() => OpenWindow();

    // ------------------------------------------------------------ server

    void ServerChanged(ServerState old, ServerState next)
    {
        switch (next.Kind)
        {
            case ServerStateKind.Owned or ServerStateKind.Attached:
                AnnounceWifi();
                WatchState();
                if (old.Kind == ServerStateKind.Restarting)
                {
                    Outside.Notify("ViewSwitcher server restarted", "It stopped unexpectedly and is running again.", "server");
                    ShowNotice("ViewSwitcher's server stopped unexpectedly and was restarted.", TimeSpan.FromSeconds(8));
                }
                else ShowNotice(null);
                break;
            case ServerStateKind.Restarting:
                Down();
                if (next.Attempt == 1) Outside.Notify("ViewSwitcher server stopped", $"It exited ({next.ExitCode}). Restarting it now.", "server");
                ShowNotice("ViewSwitcher's server stopped. Restarting it…");
                break;
            case ServerStateKind.Crashed:
                Down();
                Outside.Notify("ViewSwitcher server keeps stopping", $"It exited ({next.ExitCode}) again, so it wasn't restarted. Choose Restart Server from the ViewSwitcher icon in the taskbar. Server log: {Env.LogFile}", "server");
                ShowNotice("ViewSwitcher's server keeps stopping. Choose Restart Server from the ViewSwitcher icon in the taskbar.");
                break;
            case ServerStateKind.Failed:
                Down();
                // A restart that found the port taken; at launch and from Restart Server, the caller says why.
                if (old.Kind == ServerStateKind.Restarting)
                {
                    Outside.Notify("ViewSwitcher server stopped", next.Error!.Message, "server");
                    ShowNotice("ViewSwitcher's server stopped and couldn't restart. Choose Restart Server from the ViewSwitcher icon in the taskbar.");
                }
                break;
            case ServerStateKind.Lost:
                Down();
                break;
        }
        Render();
        e2e?.Report();
    }

    void Down()
    {
        announcer.Set(false, 0);
        live = null;
    }

    void CouldntStart(ServerError why, bool quit)
    {
        var taken = why.Kind == ServerErrorKind.PortTaken;
        Outside.Alert(taken ? "Port in use" : "ViewSwitcher couldn't start", why.Message + (taken ? "" : $"\n\nServer log: {Env.LogFile}"), Outside.Icon.Error);
        if (quit) Quit();
    }

    async void RestartServer()
    {
        // A second click while one starts would race it for the port; the supervisor ignores it.
        if (!supervisor.State.Stopped) return;
        await supervisor.Start();
        if (supervisor.State.Kind == ServerStateKind.Failed)
        {
            CouldntStart(supervisor.State.Error!, quit: false);
            return;
        }
        switcher?.ReloadCurrent();
    }

    /// <summary>The tray follows the live state over the server's WebSocket, like any switcher page.</summary>
    void WatchState()
    {
        liveClient?.Stop();
        var client = new LiveClient(Env.Base);
        client.State += state =>
        {
            live = state;
            Render();
        };
        // Attached to a server someone else started and it went away: Restart Server attaches again, or starts the bundled one.
        client.Closed += async () => await supervisor.CheckAttached();
        liveClient = client;
        client.Start();
    }

    void ShowNotice(string? text, TimeSpan? @for = null)
    {
        var until = @for is { } f ? DateTime.UtcNow + f : (DateTime?)null;
        notice = text is null ? null : (text, until);
        switcher?.ShowNotice(text, until);
    }

    // ------------------------------------------------------------ phones and tablets

    /// <summary>mDNS follows the setting, for a server this app started (it was launched with the setting).</summary>
    void AnnounceWifi() => announcer.Set(Env.Wifi && supervisor.State.Kind == ServerStateKind.Owned, int.Parse(Env.Port));

    public void OpenRemotes()
    {
        if (remotes is null)
        {
            remotes = new RemotesWindow();
            remotes.EnabledChanged += _ =>
            {
                AnnounceWifi();
                Render();
            };
        }
        remotes.Show();
    }

    /// <summary>The tray's checkbox: the server opens or closes its Wi-Fi listener now (closing it disconnects every device).</summary>
    public async Task ToggleWifi()
    {
        var on = !Env.Wifi;
        try
        {
            var s = await Env.Api.SetRemoteEnabled(on);
            Env.Wifi = s.Enabled;
            AnnounceWifi();
            Render();
            if (remotes is not null) await remotes.Changed(s.Enabled);
            // The first time it's on, Phones and Tablets shows what Windows needs (the firewall, a private network).
            if (s.Enabled && remotes is not { Visible: true }) OpenRemotes();
        }
        catch (Exception e)
        {
            Outside.Alert("Couldn't change Wi-Fi connections", e.Message);
        }
    }

    // ------------------------------------------------------------ window

    public void OpenWindow()
    {
        if (switcher is null)
        {
            switcher = new SwitcherWindow(Env.Base);
            if (notice is { } n) switcher.ShowNotice(n.Text, n.Until);
        }
        switcher.Show();
    }

    void EditWithAI()
    {
        OpenWindow();
        switcher?.OpenAgentSheet();
    }

    // ------------------------------------------------------------ tray

    MenuStatus Status => MenuStatus.From(supervisor.State.Running ? live : null);

    StatusMenu.Context MenuContext => new(Status, supervisor.State, live?.Obs.Connected == true, Env.Wifi, updates?.Available == true, !Env.E2E && LoginItem.Enabled, Usb: live?.Usb?.Enabled == true);

    public void Render() => tray?.Render(Status, StatusMenu.Items(MenuContext));

    public void Perform(StatusMenu.Action action)
    {
        switch (action)
        {
            case StatusMenu.Action.OpenWindow: OpenWindow(); break;
            case StatusMenu.Action.EditWithAI: EditWithAI(); break;
            case StatusMenu.Action.OpenInBrowser: Outside.OpenInBrowser(Env.Base); break;
            case StatusMenu.Action.OpenLibrary: OpenLibrary(); break;
            case StatusMenu.Action.SetUpObs: SetUpObs(); break;
            case StatusMenu.Action.ToggleWifi: _ = ToggleWifi(); break;
            case StatusMenu.Action.OpenRemotes: OpenRemotes(); break;
            case StatusMenu.Action.RestartServer: RestartServer(); break;
            case StatusMenu.Action.CheckForUpdates: updates?.Check(interactive: true); break;
            case StatusMenu.Action.ToggleLogin: ToggleLogin(); break;
            case StatusMenu.Action.ShowLog: ShowLog(); break;
            case StatusMenu.Action.Quit: Quit(); break;
        }
    }

    async void OpenLibrary()
    {
        try
        {
            // One of the few answers with an absolute path in it, given only to this PC itself.
            var info = await Env.Api.Info();
            Outside.OpenFolder(info.Library);
        }
        catch (Exception e)
        {
            Outside.Alert("Couldn't open the library folder", e.Message);
        }
    }

    /// <summary>Setup never switches OBS's scene while it's live (the server checks too), but say so before doing anything.</summary>
    async void SetUpObs()
    {
        if (live is { ObsLive: true } l)
        {
            var go = Outside.Alert($"OBS is {(l.Obs.Streaming ? "streaming" : "recording")}", "Set up the ViewSwitcher scene anyway? OBS will stay on the scene it's showing now; switch to ViewSwitcher in OBS when you're ready.", okCancel: true);
            if (!go) return;
        }
        try
        {
            var r = await Env.Api.SetUpObs();
            var next = r.Missing.Count == 0 ? "" : $" Add {string.Join(", ", r.Missing)} to the ViewSwitcher scene in OBS, then set up again.";
            Outside.Notify("OBS is set up", (r.Switched ? "The ViewSwitcher scene is ready." : "The ViewSwitcher scene is ready; OBS stayed on its current scene.") + next);
        }
        catch (Exception e)
        {
            Outside.Alert("Couldn't set up OBS", e.Message);
        }
    }

    void ToggleLogin()
    {
        if (Env.E2E) return;
        try
        {
            LoginItem.Enabled = !LoginItem.Enabled;
        }
        catch (Exception e)
        {
            Outside.Alert("Couldn't change Open at Login", e.Message);
        }
        Render();
    }

    void ShowLog()
    {
        // A server this app attached to writes its own log: show the logs folder rather than a file it doesn't use.
        var folder = Path.GetDirectoryName(Env.LogFile)!;
        Directory.CreateDirectory(folder);
        if (supervisor.State.Kind == ServerStateKind.Attached)
        {
            Outside.OpenFolder(folder);
            return;
        }
        ServerLog.Cap(Env.LogFile);
        if (!File.Exists(Env.LogFile)) File.WriteAllText(Env.LogFile, "");
        Outside.OpenFile(Env.LogFile);
    }

    /// <summary>Quit stops only a server this app started; then the app ends.</summary>
    public async void Quit()
    {
        if (quitting) return;
        quitting = true;
        liveClient?.Stop();
        announcer.Stop();
        switcher?.Hide();
        var own = supervisor?.Quit();
        if (own is not null) await own.StopAsync();
        e2e?.Report();
        tray?.Dispose();
        if (!Env.E2E) Notifier.Unregister();
        Exit();
    }
}
