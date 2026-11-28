using System.Text.Json;
using System.IO;
using ViewSwitcher.Core;

namespace ViewSwitcher.Windows;

/// <summary>
/// The end-to-end script's handle on the app (the Mac's E2E.swift), active only with VIEWSWITCHER_E2E_DIR:
/// the app writes app.json (its pid, the server's state and pid, the tray's menu, what it opened or
/// notified) after every change, and runs the commands the script drops in as cmd-N.json, answering in
/// res-N.json.
/// </summary>
public sealed class E2E
{
    readonly string dir;
    readonly App app;
    readonly Microsoft.UI.Dispatching.DispatcherQueueTimer timer;
    int next = 1;

    public E2E(string dir, App app)
    {
        this.dir = dir;
        this.app = app;
        Directory.CreateDirectory(dir);
        timer = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread().CreateTimer();
        timer.Interval = TimeSpan.FromMilliseconds(100);
        timer.Tick += (_, _) => Poll();
        timer.Start();
    }

    public void Report()
    {
        var s = app.Supervisor;
        var data = new
        {
            pid = Environment.ProcessId,
            state = s?.State.Kind.ToString(),
            attempt = s?.State.Attempt,
            error = s?.State.Error?.Message,
            serverPid = s?.Server?.Pid,
            owned = s?.Server?.Owned,
            menu = app.TrayIcon?.Items.Select(i => i switch
            {
                StatusMenu.ActionItem a => new { title = a.Text, enabled = a.Enabled, @checked = a.Checked },
                _ => new { title = i.Title ?? "-", enabled = false, @checked = false },
            }),
            window = app.Switcher?.Visible ?? false,
            userAgent = app.Switcher?.UserAgent,
            remotes = app.Remotes?.Visible ?? false,
            wifi = Env.Wifi,
            opened = Snapshot(Outside.Opened),
            alerts = Snapshot(Outside.Alerts),
            notices = Snapshot(Outside.Notices),
        };
        Write("app.json", JsonSerializer.Serialize(data));
    }

    static string[] Snapshot(List<string> l)
    {
        lock (l) return [.. l];
    }

    void Write(string name, string text)
    {
        var tmp = Path.Combine(dir, $"{name}.tmp");
        try
        {
            File.WriteAllText(tmp, text);
            File.Move(tmp, Path.Combine(dir, name), overwrite: true);
        }
        catch (IOException) { }
    }

    void Poll()
    {
        Report();
        var file = Path.Combine(dir, $"cmd-{next}.json");
        if (!File.Exists(file)) return;
        string cmd;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(file));
            cmd = doc.RootElement.GetProperty("cmd").GetString() ?? "";
        }
        catch (Exception)
        {
            return; // still being written
        }
        var n = next++;
        _ = Answer(n, cmd);
    }

    async Task Answer(int n, string cmd)
    {
        string? result;
        try
        {
            result = await Run(cmd);
        }
        catch (Exception e)
        {
            result = e.Message;
        }
        Write($"res-{n}.json", JsonSerializer.Serialize(new { ok = result is null, error = result }));
    }

    async Task<string?> Run(string cmd)
    {
        switch (cmd)
        {
            case "open-window": app.OpenWindow(); return null;
            case "close-window": app.Switcher?.Hide(); return null;
            case "open-remotes": app.OpenRemotes(); return null;
            case "toggle-wifi": await app.ToggleWifi(); return null;
            case "restart-server": app.Perform(StatusMenu.Action.RestartServer); return null;
            case "edit-with-ai": app.Perform(StatusMenu.Action.EditWithAI); return null;
            case "quit": app.Quit(); return null;
            // Pictures of the app's own windows, without a screenshot of the desktop.
            case "capture-switcher":
                if (app.Switcher?.Web.CoreWebView2 is not { } core) return "no switcher window";
                using (var f = File.Create(Path.Combine(dir, "switcher.png")))
                    await core.CapturePreviewAsync(Microsoft.Web.WebView2.Core.CoreWebView2CapturePreviewImageFormat.Png, f.AsRandomAccessStream());
                return null;
            case "capture-remotes":
                if (app.Remotes?.Window.Content is not Microsoft.UI.Xaml.UIElement root) return "no Phones and Tablets window";
                await Capture(root, Path.Combine(dir, "remotes.png"));
                return null;
            default: return $"unknown command {cmd}";
        }
    }

    static async Task Capture(Microsoft.UI.Xaml.UIElement root, string file)
    {
        var rtb = new Microsoft.UI.Xaml.Media.Imaging.RenderTargetBitmap();
        await rtb.RenderAsync(root);
        var pixels = await rtb.GetPixelsAsync();
        using var stream = new global::Windows.Storage.Streams.InMemoryRandomAccessStream();
        var encoder = await global::Windows.Graphics.Imaging.BitmapEncoder.CreateAsync(global::Windows.Graphics.Imaging.BitmapEncoder.PngEncoderId, stream);
        encoder.SetPixelData(global::Windows.Graphics.Imaging.BitmapPixelFormat.Bgra8, global::Windows.Graphics.Imaging.BitmapAlphaMode.Premultiplied, (uint)rtb.PixelWidth, (uint)rtb.PixelHeight, 96, 96, System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions.ToArray(pixels));
        await encoder.FlushAsync();
        stream.Seek(0);
        using var f = File.Create(file);
        await stream.AsStreamForRead().CopyToAsync(f);
    }
}
