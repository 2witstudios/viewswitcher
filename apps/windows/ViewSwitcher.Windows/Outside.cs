using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Windows.AppNotifications;
using Microsoft.Windows.AppNotifications.Builder;
using ViewSwitcher.Core;

namespace ViewSwitcher.Windows;

/// <summary>
/// Everything the app shows or opens outside its window goes through here (the Mac's Outside), so the
/// end-to-end run records it instead of opening browsers, dialogs and notifications on the test machine.
/// </summary>
public static partial class Outside
{
    public static readonly List<string> Opened = [];
    public static readonly List<string> Alerts = [];
    public static readonly List<string> Notices = [];

    /// <summary>http(s), plus Cursor's MCP install link: a scene is a page anyone can write, and opening file: or any other app scheme would launch things.</summary>
    public static void OpenInBrowser(Uri url)
    {
        if (!NavigationPolicy.OpensOutside(url)) return;
        if (Env.E2E) { lock (Opened) Opened.Add(url.AbsoluteUri); return; }
        Shell(url.AbsoluteUri);
    }

    /// <summary>A file the app saved (Add to Claude Desktop's extension), opened in the app that handles it.</summary>
    public static void OpenFile(string path)
    {
        if (Env.E2E) { lock (Opened) Opened.Add(path); return; }
        Shell(path);
    }

    /// <summary>A folder in Explorer, or a file shown selected in its folder.</summary>
    public static void OpenFolder(string path, bool select = false)
    {
        if (Env.E2E) { lock (Opened) Opened.Add(path); return; }
        try
        {
            var info = new ProcessStartInfo("explorer.exe") { UseShellExecute = false };
            if (select) info.ArgumentList.Add($"/select,{path}");
            else info.ArgumentList.Add(path);
            Process.Start(info);
        }
        catch (Exception) { }
    }

    static void Shell(string target)
    {
        try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); } catch (Exception) { }
    }

    public enum Icon : uint { Info = 0x40, Warning = 0x30, Error = 0x10 }

    /// <summary>A modal alert (the system's own message box, so it works with no window open). Returns whether the first button (OK / Yes) was chosen; in e2e, <paramref name="e2eAnswer"/>.</summary>
    public static bool Alert(string title, string message, Icon icon = Icon.Warning, bool okCancel = false, bool e2eAnswer = false, nint owner = 0)
    {
        if (Env.E2E) { lock (Alerts) Alerts.Add($"{title}: {message}"); return e2eAnswer; }
        const uint MB_OKCANCEL = 0x1, MB_SETFOREGROUND = 0x10000, MB_TOPMOST = 0x40000;
        var r = MessageBoxW(owner, message, title, (uint)icon | (okCancel ? MB_OKCANCEL : 0) | MB_SETFOREGROUND | (owner == 0 ? MB_TOPMOST : 0));
        return r == 1; // IDOK
    }

    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16)]
    private static partial int MessageBoxW(nint hwnd, string text, string caption, uint type);

    /// <summary>A Windows notification. One <paramref name="tag"/> at a time: a new one replaces the last (the server's).</summary>
    public static void Notify(string title, string body, string? tag = null)
    {
        if (Env.E2E) { lock (Notices) Notices.Add($"{title}: {body}"); return; }
        Notifier.Show(title, body, tag);
    }
}

/// <summary>Toasts through the Windows App SDK (unpackaged: registered for this exe at launch).</summary>
public static class Notifier
{
    static bool registered;

    public static void Register()
    {
        try
        {
            AppNotificationManager.Default.Register();
            registered = true;
        }
        catch (Exception) { }
    }

    public static void Unregister()
    {
        if (!registered) return;
        try { AppNotificationManager.Default.Unregister(); } catch (Exception) { }
    }

    public static void Show(string title, string body, string? tag)
    {
        if (!registered) return;
        try
        {
            var n = new AppNotificationBuilder().AddText(title).AddText(body).BuildNotification();
            if (tag is not null)
            {
                n.Tag = tag;
                n.Group = "viewswitcher";
            }
            AppNotificationManager.Default.Show(n);
        }
        catch (Exception) { }
    }
}
