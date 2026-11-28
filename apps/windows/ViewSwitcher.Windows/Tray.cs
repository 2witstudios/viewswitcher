using System.Runtime.InteropServices;
using H.NotifyIcon.Core;
using Microsoft.Win32;
using ViewSwitcher.Core;

namespace ViewSwitcher.Windows;

/// <summary>
/// The notification-area icon (the Mac's menu-bar item): red while something is on air, the on-air line
/// as its tooltip, and a menu rebuilt from <see cref="StatusMenu.Items"/>. A left click opens the window.
/// </summary>
public sealed partial class Tray : IDisposable
{
    readonly TrayIconWithContextMenu icon;
    readonly Action<StatusMenu.Action> perform;
    readonly Action openWindow;
    readonly Microsoft.UI.Dispatching.DispatcherQueue ui;
    readonly Dictionary<string, nint> icons = [];
    /// <summary>The last menu, as titles (E2E.cs reads it back).</summary>
    public List<StatusMenu.Item> Items { get; private set; } = [];

    public Tray(Action<StatusMenu.Action> perform, Action openWindow)
    {
        this.perform = perform;
        this.openWindow = openWindow;
        ui = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();
        icon = new TrayIconWithContextMenu(Env.Dev ? "ViewSwitcher (development)" : "ViewSwitcher")
        {
            Icon = Load(TrayIconFile(live: false)),
            ToolTip = "ViewSwitcher",
            ContextMenu = new PopupMenu(),
        };
        icon.Create();
        icon.MessageWindow.MouseEventReceived += (_, e) =>
        {
            if (e.MouseEvent == MouseEvent.IconLeftMouseUp) ui.TryEnqueue(() => this.openWindow());
        };
    }

    /// <summary>The tray icon for the taskbar's theme: light marks on a dark taskbar, dark on a light one; red while live.</summary>
    static string TrayIconFile(bool live)
    {
        if (live) return "TrayLive.ico";
        using var k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
        return k?.GetValue("SystemUsesLightTheme") is int light && light == 1 ? "TrayLight.ico" : "TrayDark.ico";
    }

    nint Load(string file)
    {
        if (icons.TryGetValue(file, out var h)) return h;
        var path = Path.Combine(AppContext.BaseDirectory, "Assets", file);
        var size = GetSystemMetrics(49 /* SM_CXSMICON */);
        h = LoadImageW(0, path, 1 /* IMAGE_ICON */, size, size, 0x10 /* LR_LOADFROMFILE */);
        icons[file] = h;
        return h;
    }

    public void Render(MenuStatus status, List<StatusMenu.Item> items)
    {
        icon.UpdateIcon(Load(TrayIconFile(status.Live)));
        // The tooltip: what's on air, and OBS, since the tray has no room for a title beside its icon.
        var tip = status.Title.Length > 0 ? $"ViewSwitcher · {status.OnAir}" : $"ViewSwitcher · {status.OnAir} · {status.Obs}";
        icon.UpdateToolTip(tip.Length > 120 ? tip[..119] + "…" : tip);
        Items = items;
        var menu = new PopupMenu();
        foreach (var item in items)
        {
            switch (item)
            {
                case StatusMenu.Separator:
                    menu.Items.Add(new PopupMenuSeparator());
                    break;
                case StatusMenu.Info info:
                    menu.Items.Add(new PopupMenuItem(info.Text, (_, _) => { }) { Enabled = false });
                    break;
                case StatusMenu.ActionItem a:
                    var action = a.Action;
                    menu.Items.Add(new PopupMenuItem(a.Text, (_, _) => ui.TryEnqueue(() => perform(action))) { Enabled = a.Enabled, Checked = a.Checked });
                    break;
            }
        }
        icon.ContextMenu = menu;
    }

    public void Dispose()
    {
        icon.Dispose();
        foreach (var h in icons.Values) if (h != 0) DestroyIcon(h);
    }

    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16)]
    private static partial nint LoadImageW(nint instance, string name, uint type, int cx, int cy, uint load);

    [LibraryImport("user32.dll")]
    private static partial int GetSystemMetrics(int index);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool DestroyIcon(nint icon);
}
