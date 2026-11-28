using Microsoft.UI;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using QRCoder;
using ViewSwitcher.Core;
using Windows.Graphics;
using System.Runtime.InteropServices.WindowsRuntime;
using Windows.Storage.Streams;

namespace ViewSwitcher.Windows;

/// <summary>
/// Phones and Tablets (the Mac's RemotesWindow): the Wi-Fi setting, a one-time code with its QR code, the
/// addresses phones use, and the paired devices. Every call carries the app's admin secret; attached
/// to a server it didn't start, pairing isn't available. On Windows it also checks what Windows needs for
/// phones to get in (the firewall rule, the Wi-Fi marked private) and offers to set that up.
/// </summary>
public sealed class RemotesWindow
{
    public Window Window { get; }
    readonly ToggleSwitch wifi = new() { OnContent = "On", OffContent = "Off" };
    readonly TextBlock status = Text("", 13, dim: true);
    readonly TextBlock code = new() { FontSize = 34, FontWeight = FontWeights.SemiBold, FontFamily = new FontFamily("Cascadia Mono, Consolas"), IsTextSelectionEnabled = true };
    readonly TextBlock expiry = Text("", 13, dim: true);
    readonly Image qr = new() { Width = 220, Height = 220, Stretch = Stretch.Uniform };
    readonly StackPanel urls = new() { Spacing = 2 };
    readonly StackPanel devices = new() { Spacing = 8 };
    readonly StackPanel pairing = new() { Spacing = 10, Visibility = Visibility.Collapsed };
    readonly InfoBar network = new() { IsClosable = false, Severity = InfoBarSeverity.Warning, Title = "Windows needs one setting for phones to connect" };
    readonly Button newCode = new() { Content = "New Code" };
    readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromSeconds(2) };
    RemoteStatus? last;
    string? shownCode;
    double codeExpires;
    string? pairUrl;
    bool syncing;
    List<WindowsNetwork.Connection> publicNets = [];

    /// <summary>The setting changed here: (on, the server's answer).</summary>
    public event Action<bool>? EnabledChanged;

    static TextBlock Text(string s, double size = 14, bool dim = false, bool bold = false) => new()
    {
        Text = s,
        FontSize = size,
        TextWrapping = TextWrapping.Wrap,
        Foreground = new SolidColorBrush(dim ? global::Windows.UI.Color.FromArgb(255, 160, 163, 172) : Colors.White),
        FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal,
    };

    public RemotesWindow()
    {
        var setup = new Button { Content = "Set Up Windows for Phones…" };
        setup.Click += async (_, _) => await SetUpWindows();
        network.ActionButton = setup;
        newCode.Click += async (_, _) => await NewCode();
        wifi.Toggled += async (_, _) =>
        {
            if (syncing) return;
            await SetEnabled(wifi.IsOn);
        };

        var head = new StackPanel { Spacing = 6, Children = { Text("Phones and Tablets", 22, bold: true), Text(RemoteText.Help, 13, dim: true) } };
        var row = new Grid { ColumnDefinitions = { new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }, new ColumnDefinition { Width = GridLength.Auto } } };
        var label = Text(StatusMenu.WifiTitle, 14);
        label.VerticalAlignment = VerticalAlignment.Center;
        row.Children.Add(label);
        Grid.SetColumn(wifi, 1);
        row.Children.Add(wifi);

        var codeCol = new StackPanel
        {
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
            Children = { Text("Scan the code with the phone's camera, or open one of these addresses on it and type the code:", 13, dim: true), code, expiry, urls, newCode },
        };
        var codeRow = new Grid { ColumnSpacing = 20, ColumnDefinitions = { new ColumnDefinition { Width = GridLength.Auto }, new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) } } };
        var qrFrame = new Border { Background = new SolidColorBrush(Colors.White), Padding = new Thickness(10), CornerRadius = new CornerRadius(8), Child = qr };
        codeRow.Children.Add(qrFrame);
        Grid.SetColumn(codeCol, 1);
        codeRow.Children.Add(codeCol);
        pairing.Children.Add(codeRow);

        var body = new StackPanel
        {
            Spacing = 16,
            Padding = new Thickness(24),
            Children =
            {
                head, row, network, status, pairing,
                Text("Paired", 15, bold: true),
                devices,
            },
        };
        Window = new Window
        {
            Title = "Phones and Tablets",
            Content = new ScrollViewer { Content = body, Background = new SolidColorBrush(SwitcherWindow.Graphite) },
        };
        if (Window.Content is FrameworkElement fe) fe.RequestedTheme = ElementTheme.Dark;
        var app = Window.AppWindow;
        app.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "ViewSwitcher.ico"));
        var scale = GetDpiForWindow(WinRT.Interop.WindowNative.GetWindowHandle(Window)) / 96.0;
        app.Resize(new SizeInt32((int)(620 * scale), (int)(760 * scale)));
        app.TitleBar.BackgroundColor = global::Windows.UI.Color.FromArgb(255, 16, 17, 22);
        app.TitleBar.ForegroundColor = Colors.White;
        app.TitleBar.ButtonBackgroundColor = global::Windows.UI.Color.FromArgb(255, 16, 17, 22);
        app.TitleBar.ButtonForegroundColor = Colors.White;
        app.Closing += (_, e) =>
        {
            e.Cancel = true;
            app.Hide();
            timer.Stop();
        };
        timer.Tick += async (_, _) => { await Refresh(); RenderExpiry(); };
    }

    public bool Visible => Window.AppWindow.IsVisible;

    public async void Show()
    {
        if (Env.E2E) Window.AppWindow.Show(activateWindow: false);
        else
        {
            Window.AppWindow.Show();
            Window.Activate();
        }
        timer.Start();
        await Refresh();
        await CheckWindows();
        // Wi-Fi on and no code yet: make one, so the window opens ready to pair.
        if (last is { Enabled: true } && shownCode is null) await NewCode();
    }

    public async Task Refresh()
    {
        try
        {
            Render(await Env.Api.RemoteStatus());
        }
        catch (Exception e)
        {
            RenderError(e.Message);
        }
    }

    async Task SetEnabled(bool on)
    {
        try
        {
            var s = await Env.Api.SetRemoteEnabled(on);
            Env.Wifi = s.Enabled;
            EnabledChanged?.Invoke(s.Enabled);
            Render(s);
            if (s.Enabled)
            {
                await CheckWindows();
                await NewCode();
            }
            else ClearCode();
        }
        catch (Exception e)
        {
            RenderError(e.Message);
        }
    }

    /// <summary>The menu changed the setting: show it, and a fresh code when it's on.</summary>
    public async Task Changed(bool on)
    {
        if (!Visible) return;
        if (on) { await CheckWindows(); await NewCode(); }
        else { ClearCode(); await Refresh(); }
    }

    public async Task NewCode()
    {
        try
        {
            var s = await Env.Api.NewPairingCode();
            if (s.Code?.Code is { } c)
            {
                shownCode = c;
                codeExpires = s.Code.ExpiresAt;
                pairUrl = s.PairUrl;
            }
            Render(s);
        }
        catch (Exception e)
        {
            RenderError(e.Message);
        }
    }

    void ClearCode()
    {
        shownCode = null;
        pairUrl = null;
        qr.Source = null;
    }

    void RenderError(string message)
    {
        status.Text = message;
        pairing.Visibility = Visibility.Collapsed;
        wifi.IsEnabled = false;
    }

    void Render(RemoteStatus s)
    {
        last = s;
        syncing = true;
        wifi.IsOn = s.Enabled;
        wifi.IsEnabled = true;
        syncing = false;
        status.Text = !s.Enabled ? "Off: only this PC can use the switcher." : s.CodeGuessed == true ? RemoteText.Guessed : "";
        status.Visibility = status.Text.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        // The code the server sent once stays until it expires or is used (the server never sends it again).
        if (s.Code is null && shownCode is not null && codeExpires < DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) ClearCode();
        pairing.Visibility = s.Enabled && shownCode is not null ? Visibility.Visible : Visibility.Collapsed;
        if (shownCode is not null)
        {
            code.Text = RemoteText.Code(shownCode);
            if (pairUrl is not null && qr.Source is null) _ = ShowQr(pairUrl);
        }
        urls.Children.Clear();
        foreach (var u in s.Urls) urls.Children.Add(new TextBlock { Text = u, FontSize = 13, IsTextSelectionEnabled = true, Foreground = new SolidColorBrush(Colors.White) });
        RenderExpiry();
        RenderDevices(s.Devices);
        network.IsOpen = s.Enabled && network.Message is { Length: > 0 };
    }

    void RenderExpiry()
    {
        if (shownCode is null) return;
        expiry.Text = RemoteText.Expiry(codeExpires);
        newCode.Content = expiry.Text == "Expired" ? "New Code" : "Another Code";
    }

    void RenderDevices(IReadOnlyList<RemoteDevice> list)
    {
        devices.Children.Clear();
        if (list.Count == 0)
        {
            devices.Children.Add(Text("None yet.", 13, dim: true));
            return;
        }
        foreach (var d in list)
        {
            var remove = new Button { Content = "Remove" };
            var id = d.Id;
            remove.Click += async (_, _) =>
            {
                try { Render(await Env.Api.RemoveDevice(id)); } catch (Exception e) { RenderError(e.Message); }
            };
            var g = new Grid { ColumnDefinitions = { new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }, new ColumnDefinition { Width = GridLength.Auto } } };
            g.Children.Add(new StackPanel { Children = { Text(d.Name, 14), Text(RemoteText.LastSeen(d), 12, dim: true) } });
            Grid.SetColumn(remove, 1);
            g.Children.Add(remove);
            devices.Children.Add(g);
        }
    }

    async Task ShowQr(string text)
    {
        var png = new PngByteQRCode(new QRCodeGenerator().CreateQrCode(text, QRCodeGenerator.ECCLevel.M)).GetGraphic(10);
        using var stream = new InMemoryRandomAccessStream();
        await stream.WriteAsync(png.AsBuffer());
        stream.Seek(0);
        var bmp = new BitmapImage();
        await bmp.SetSourceAsync(stream);
        qr.Source = bmp;
    }

    /// <summary>What Windows needs for phones to reach the server: the firewall rule, and no public Wi-Fi in the way.</summary>
    async Task CheckWindows()
    {
        if (Env.E2E) return;
        var rule = await WindowsNetwork.RuleExists();
        var nets = await WindowsNetwork.Connections();
        publicNets = nets.Where(n => n.Category == "Public" && !n.Alias.StartsWith("Tailscale", StringComparison.OrdinalIgnoreCase) && !n.Alias.StartsWith("vEthernet", StringComparison.OrdinalIgnoreCase)).ToList();
        var parts = new List<string>();
        if (publicNets.Count > 0) parts.Add($"Windows treats {string.Join(" and ", publicNets.Select(n => $"\"{n.Alias}\""))} as a public network, where it lets no phone in.");
        if (!rule) parts.Add("Windows Firewall has no rule for ViewSwitcher yet.");
        network.Message = parts.Count == 0 ? "" : string.Join(" ", parts) + " Set Up Windows for Phones asks Windows once (an admin prompt) to allow ViewSwitcher on private networks" + (publicNets.Count > 0 ? " and to make this network private. Only do that on a network you trust, like home or church Wi-Fi." : ".");
        network.IsOpen = last is { Enabled: true } && parts.Count > 0;
    }

    async Task SetUpWindows()
    {
        var exe = Env.Dev ? Env.Which("bun.exe") ?? "" : Env.Sidecar;
        var ok = await WindowsNetwork.SetUp(exe, int.Parse(Env.Port), publicNets.Select(n => n.Alias));
        await CheckWindows();
        if (!ok && network.IsOpen) network.Severity = InfoBarSeverity.Error;
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern uint GetDpiForWindow(nint hwnd);
}
