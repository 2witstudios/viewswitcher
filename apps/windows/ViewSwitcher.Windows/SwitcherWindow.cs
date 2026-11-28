using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using ViewSwitcher.Core;
using Windows.Graphics;

namespace ViewSwitcher.Windows;

/// <summary>
/// The switcher in a window (the Mac's SwitcherWindow): WebView2 on the server, which stays the only site
/// the main frame shows; other web pages open in the browser, other schemes are refused, and nothing
/// opens a second window. No camera or microphone, no downloads but Edit with AI's Claude Desktop
/// extension. A load that fails (the server restarting) is tried again on the same page. Closing hides
/// the window: the server keeps serving OBS and the phones. The page gets no way to call into the app.
/// </summary>
public sealed class SwitcherWindow
{
    public static readonly global::Windows.UI.Color Graphite = global::Windows.UI.Color.FromArgb(255, 11, 12, 15);
    static readonly global::Windows.UI.Color Side = global::Windows.UI.Color.FromArgb(255, 16, 17, 22);

    public Window Window { get; }
    public WebView2 Web { get; } = new() { DefaultBackgroundColor = Graphite };
    readonly Uri server;
    ShellInfo shell = new();
    DateTime? noticeUntil;
    Uri? lastFailed;
    readonly List<DateTime> crashes = [];
    bool ready;
    /// <summary>What the window's user agent says (E2E.cs checks it).</summary>
    public string? UserAgent { get; private set; }

    public SwitcherWindow(Uri server)
    {
        this.server = server;
        Window = new Window { Title = Env.Dev ? "ViewSwitcher (development)" : "ViewSwitcher", Content = new Grid { Background = new Microsoft.UI.Xaml.Media.SolidColorBrush(Graphite), Children = { Web } } };
        var app = Window.AppWindow;
        app.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "ViewSwitcher.ico"));
        var bar = app.TitleBar;
        bar.BackgroundColor = Side;
        bar.InactiveBackgroundColor = Side;
        bar.ForegroundColor = Colors.White;
        bar.InactiveForegroundColor = global::Windows.UI.Color.FromArgb(255, 150, 152, 160);
        bar.ButtonBackgroundColor = Side;
        bar.ButtonInactiveBackgroundColor = Side;
        bar.ButtonForegroundColor = Colors.White;
        bar.ButtonInactiveForegroundColor = global::Windows.UI.Color.FromArgb(255, 150, 152, 160);
        bar.ButtonHoverBackgroundColor = global::Windows.UI.Color.FromArgb(255, 40, 42, 50);
        bar.ButtonHoverForegroundColor = Colors.White;
        bar.ButtonPressedBackgroundColor = global::Windows.UI.Color.FromArgb(255, 54, 56, 66);
        if (app.Presenter is OverlappedPresenter p)
        {
            try
            {
                p.PreferredMinimumWidth = 760;
                p.PreferredMinimumHeight = 520;
            }
            catch (Exception) { }
        }
        Place();
        // Closing hides it: the server keeps running for OBS and the phones (Quit is in the tray).
        app.Closing += (_, e) =>
        {
            e.Cancel = true;
            Hide();
        };
        _ = Setup();
    }

    void Place()
    {
        var app = Window.AppWindow;
        var scale = (double)GetDpiForWindow(WinRT.Interop.WindowNative.GetWindowHandle(Window)) / 96;
        if (Env.Settings.Window is { } w && w.Width >= 400 && w.Height >= 300 && OnScreen(w))
        {
            app.MoveAndResize(new RectInt32(w.X, w.Y, w.Width, w.Height));
            if (w.Maximized && app.Presenter is OverlappedPresenter op) op.Maximize();
            return;
        }
        var area = DisplayArea.GetFromWindowId(app.Id, DisplayAreaFallback.Primary).WorkArea;
        var width = Math.Min((int)(1440 * scale), area.Width - 40);
        var height = Math.Min((int)(900 * scale), area.Height - 40);
        app.MoveAndResize(new RectInt32(area.X + (area.Width - width) / 2, area.Y + (area.Height - height) / 2, width, height));
    }

    static bool OnScreen(AppSettings.WindowPlacement w)
    {
        var area = DisplayArea.GetFromRect(new RectInt32(w.X, w.Y, w.Width, w.Height), DisplayAreaFallback.None);
        return area is not null;
    }

    void Remember()
    {
        var app = Window.AppWindow;
        var max = app.Presenter is OverlappedPresenter { State: OverlappedPresenterState.Maximized };
        if (app.Presenter is OverlappedPresenter { State: OverlappedPresenterState.Minimized }) return;
        Env.Settings.Window = max && Env.Settings.Window is { } before ? before with { Maximized = true } : new(app.Position.X, app.Position.Y, app.Size.Width, app.Size.Height, max);
        Env.SaveSettings();
    }

    public bool Visible => Window.AppWindow.IsVisible;

    public void Show()
    {
        // The end-to-end run never takes the foreground from whatever the person is doing on the test machine.
        if (Env.E2E)
        {
            Window.AppWindow.Show(activateWindow: false);
            return;
        }
        Window.AppWindow.Show();
        if (Window.AppWindow.Presenter is OverlappedPresenter { State: OverlappedPresenterState.Minimized } p) p.Restore();
        Window.Activate();
        SetForegroundWindow(WinRT.Interop.WindowNative.GetWindowHandle(Window));
    }

    public void Hide()
    {
        Remember();
        Window.AppWindow.Hide();
    }

    async Task Setup()
    {
        CoreWebView2Environment env;
        try
        {
            var options = new CoreWebView2EnvironmentOptions { AdditionalBrowserArguments = "--disable-features=msSmartScreenProtection" };
            env = await CoreWebView2Environment.CreateWithOptionsAsync(null, Env.WebViewData, options);
            await Web.EnsureCoreWebView2Async(env);
        }
        catch (Exception e)
        {
            Outside.Alert("ViewSwitcher needs WebView2", $"The Microsoft Edge WebView2 Runtime isn't available, so the switcher can't be shown. It comes with Windows 11; on Windows 10, install it from Microsoft (go.microsoft.com/fwlink/p/?LinkId=2124703).\n\n{e.Message}", Outside.Icon.Error);
            return;
        }
        var core = Web.CoreWebView2;
        var s = core.Settings;
        // The switcher reads "ViewSwitcher-Windows" as the desktop app (apps/web/src/lib/client-kind.ts).
        s.UserAgent = $"{s.UserAgent} ViewSwitcher-Windows/{Env.Version}";
        UserAgent = s.UserAgent;
        s.AreDevToolsEnabled = Env.Dev;
        s.AreHostObjectsAllowed = false;
        s.IsWebMessageEnabled = false;
        s.IsStatusBarEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        await core.AddScriptToExecuteOnDocumentCreatedAsync(shell.UserScript());

        core.NavigationStarting += (_, e) =>
        {
            var url = NavigationPolicy.Parse(e.Uri);
            if (url is null) { e.Cancel = true; return; }
            var fromSwitcher = NavigationPolicy.StartedBySwitcher(NavigationPolicy.Parse(core.Source), true, server);
            Decide(NavigationPolicy.Window(url, server, mainFrame: true, fromSwitcher: fromSwitcher), () => e.Cancel = true);
        };
        core.FrameNavigationStarting += (_, e) =>
        {
            var url = NavigationPolicy.Parse(e.Uri);
            if (url is null || NavigationPolicy.Window(url, server, mainFrame: false).Kind != NavigationKind.Allow) e.Cancel = true;
        };
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true; // never a second window
            if (NavigationPolicy.Parse(e.Uri) is { } url) Decide(NavigationPolicy.Window(url, server, mainFrame: true, newWindow: true), () => { });
        };
        // Schemes WebView2 would hand to Windows itself: never; what may leave goes through NavigationPolicy above.
        core.LaunchingExternalUriScheme += (_, e) => e.Cancel = true;
        core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
        core.DownloadStarting += (sender, e) =>
        {
            e.Cancel = true;
            if (NavigationPolicy.Parse(e.DownloadOperation.Uri) is { } url && NavigationPolicy.IsExtensionDownload(url, server)) _ = SaveExtension();
        };
        core.NavigationCompleted += (_, e) =>
        {
            if (e.IsSuccess)
            {
                lastFailed = null;
                ApplyShell();
                return;
            }
            if (e.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled) return;
            // The server restarting: try the same page again in a second, never the root when a page can be kept.
            lastFailed = NavigationPolicy.Parse(core.Source) ?? lastFailed;
            RetrySoon();
        };
        core.ProcessFailed += (_, e) =>
        {
            if (e.ProcessFailedKind is not (CoreWebView2ProcessFailedKind.RenderProcessExited or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive or CoreWebView2ProcessFailedKind.BrowserProcessExited)) return;
            var now = DateTime.UtcNow;
            crashes.RemoveAll(c => now - c > TimeSpan.FromSeconds(30));
            crashes.Add(now);
            // A page that keeps crashing its renderer goes back to the root.
            if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited) return;
            if (crashes.Count >= 2) core.Navigate(new Uri(server, "/").AbsoluteUri);
            else core.Reload();
        };
        ready = true;
        core.Navigate(server.AbsoluteUri);
    }

    void Decide(NavigationDecision d, Action cancel)
    {
        switch (d.Kind)
        {
            case NavigationKind.Allow:
                return;
            case NavigationKind.OpenInBrowser:
                cancel();
                Outside.OpenInBrowser(d.Url!);
                return;
            default:
                cancel();
                return;
        }
    }

    void RetrySoon()
    {
        var target = NavigationPolicy.RetryTarget(lastFailed, null, server);
        Window.DispatcherQueue.TryEnqueue(async () =>
        {
            await Task.Delay(1000);
            if (ready && lastFailed is not null) Web.CoreWebView2.Navigate(target.AbsoluteUri);
        });
    }

    /// <summary>After Restart Server: the page that was open, or the root.</summary>
    public void ReloadCurrent()
    {
        if (!ready) return;
        var target = NavigationPolicy.RetryTarget(lastFailed, NavigationPolicy.Parse(Web.CoreWebView2.Source), server);
        Web.CoreWebView2.Navigate(target.AbsoluteUri);
    }

    public void Reload()
    {
        if (ready) Web.CoreWebView2.Reload();
    }

    /// <summary>Edit with AI: the switcher's own sheet (#ai).</summary>
    public void OpenAgentSheet()
    {
        if (!ready) return;
        var current = NavigationPolicy.Parse(Web.CoreWebView2.Source);
        if (current is not null && NavigationPolicy.SameOrigin(current, server) && !current.AbsolutePath.StartsWith("/library/"))
            _ = Web.CoreWebView2.ExecuteScriptAsync("location.hash = 'ai';");
        else Web.CoreWebView2.Navigate(new Uri(server, "/?ai").AbsoluteUri);
    }

    /// <summary>A banner over the switcher (its server stopped and is coming back); <paramref name="until"/> ends it by itself.</summary>
    public void ShowNotice(string? text, DateTime? until = null)
    {
        if (until is { } u && u <= DateTime.UtcNow) text = null;
        shell = new ShellInfo(text);
        noticeUntil = until;
        ApplyShell();
        if (until is { } end)
        {
            Window.DispatcherQueue.TryEnqueue(async () =>
            {
                await Task.Delay(end - DateTime.UtcNow);
                if (noticeUntil == end) ShowNotice(null);
            });
        }
    }

    void ApplyShell()
    {
        if (ready) _ = Web.CoreWebView2.ExecuteScriptAsync(shell.ApplyScript());
    }

    /// <summary>Add to Claude Desktop: the extension for this install, saved to Downloads and opened, so Claude Desktop asks to install it.</summary>
    async Task SaveExtension()
    {
        try
        {
            var bytes = await Env.Api.AgentExtension();
            var downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
            Directory.CreateDirectory(downloads);
            var file = Path.Combine(downloads, "ViewSwitcher.mcpb");
            await File.WriteAllBytesAsync(file, bytes);
            Outside.OpenFile(file);
        }
        catch (Exception e)
        {
            Outside.Alert("Couldn't add ViewSwitcher to Claude Desktop", e.Message);
        }
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern uint GetDpiForWindow(nint hwnd);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern bool SetForegroundWindow(nint hwnd);
}
