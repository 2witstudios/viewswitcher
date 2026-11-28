namespace ViewSwitcher.Core;

/// <summary>The tray icon's menu, as data: what it lists for a state of the app, and what each item does (Kit's StatusMenu).</summary>
public static class StatusMenu
{
    public enum Action
    {
        OpenWindow, EditWithAI, OpenInBrowser, OpenLibrary, SetUpObs,
        ToggleWifi, OpenRemotes,
        RestartServer, CheckForUpdates, ToggleLogin, ShowLog, Quit,
    }

    public abstract record Item
    {
        public virtual string? Title => null;
    }

    /// <summary>A line of status (never clickable).</summary>
    public sealed record Info(string Text) : Item
    {
        public override string? Title => Text;
    }

    public sealed record Separator : Item;

    public sealed record ActionItem(string Text, Action Action, bool Enabled = true, bool Checked = false, string? ToolTip = null) : Item
    {
        public override string? Title => Text;
    }

    /// <summary>What the app knows when the menu opens. <see cref="Usb"/>: show the iPhone and iPad line (only where the server has a USB-C link).</summary>
    public sealed record Context(MenuStatus Status, ServerState Server, bool ObsConnected, bool Wifi, bool Updater, bool OpenAtLogin, bool Usb = false);

    public const string WifiTitle = "Let Phones and Tablets on This Wi-Fi Connect";

    /// <summary>The server line: what's happening to it, when that isn't simply "running".</summary>
    public static string? ServerLine(ServerState s) => s.Kind switch
    {
        ServerStateKind.Starting => "Server: starting…",
        ServerStateKind.Restarting => s.Attempt > 1 ? "Server stopped again: restarting…" : "Server stopped: restarting…",
        ServerStateKind.Crashed => "Server keeps stopping",
        ServerStateKind.Lost => "Server: stopped",
        ServerStateKind.Failed => "Server: couldn't start",
        _ => null,
    };

    public static List<Item> Items(Context c)
    {
        var s = c.Status;
        var up = c.Server.Running;
        var owned = c.Server.Kind == ServerStateKind.Owned;
        var items = new List<Item>
        {
            // While the server is down, what happened to it takes the on-air line ("Server not responding").
            new Info(ServerLine(c.Server) ?? s.OnAir),
            new Info(s.Obs),
        };
        if (c.Usb) items.Add(new Info(s.Ipad));
        items.AddRange([
            new Separator(),
            new ActionItem("Open ViewSwitcher", Action.OpenWindow),
            new ActionItem("Edit with AI…", Action.EditWithAI, up),
            new ActionItem("Open in Browser", Action.OpenInBrowser, up),
            new ActionItem("Open Library Folder", Action.OpenLibrary, up),
            new ActionItem(s.ObsReady ? "Set Up OBS Again" : "Set Up OBS…", Action.SetUpObs, up && c.ObsConnected),
            new Separator(),
            new ActionItem(WifiTitle, Action.ToggleWifi, owned, c.Wifi, RemoteText.Help),
            new ActionItem("Phones and Tablets…", Action.OpenRemotes, owned),
            new Separator(),
        ]);
        if (c.Server.Kind == ServerStateKind.Starting) items.Add(new ActionItem("Starting Server…", Action.RestartServer, false));
        else if (c.Server.Kind == ServerStateKind.Restarting) items.Add(new ActionItem("Restarting Server…", Action.RestartServer, false));
        else if (c.Server.Stopped) items.Add(new ActionItem("Restart Server", Action.RestartServer));
        items.AddRange([
            new ActionItem("Check for Updates…", Action.CheckForUpdates, c.Updater),
            new ActionItem("Open at Login", Action.ToggleLogin, Checked: c.OpenAtLogin),
            new ActionItem("Show Server Log", Action.ShowLog),
            new Separator(),
            new ActionItem(c.Server.Kind == ServerStateKind.Attached ? "Quit ViewSwitcher (server keeps running)" : "Quit ViewSwitcher", Action.Quit),
        ]);
        return items;
    }
}
