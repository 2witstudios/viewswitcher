using System.Text.Json;

namespace ViewSwitcher.Core;

/// <summary>
/// What the Windows app remembers (the Mac app's UserDefaults): "Let phones and tablets on this Wi-Fi
/// connect" (off by default) and where the window was. One small JSON file, written whole.
/// </summary>
public sealed class AppSettings
{
    public bool WifiRemotes { get; set; }
    public WindowPlacement? Window { get; set; }

    public sealed record WindowPlacement(int X, int Y, int Width, int Height, bool Maximized);

    public static AppSettings Load(string file)
    {
        try
        {
            return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(file), Json.Options) ?? new();
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return new();
        }
    }

    public void Save(string file)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        var tmp = $"{file}.{Guid.NewGuid():N}.tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(this, Json.Options));
        File.Move(tmp, file, overwrite: true);
    }
}

/// <summary>
/// The app's own files. Settings sit beside the server's state for this computer (%APPDATA%\ViewSwitcher,
/// apps/server/src/platform-dirs.ts); the log and the web view's cache in %LOCALAPPDATA%\ViewSwitcher,
/// where the installer puts the app, and which an uninstall may clear. A development build keeps its own.
/// </summary>
public static class AppPaths
{
    public static string Settings(string appData, bool dev) => Path.Combine(appData, "ViewSwitcher", "App", dev ? "settings-dev.json" : "settings.json");
    public static string WebView(string localAppData, bool dev) => Path.Combine(localAppData, "ViewSwitcher", dev ? "WebView2-dev" : "WebView2");
}
