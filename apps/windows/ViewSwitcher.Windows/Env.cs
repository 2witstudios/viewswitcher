using System.Reflection;
using System.Security.Cryptography;
using ViewSwitcher.Core;

namespace ViewSwitcher.Windows;

/// <summary>Settings from the environment, read once (the Mac app's Environment.swift).</summary>
public static class Env
{
    static string? Var(string name) => Environment.GetEnvironmentVariable(name);

    public static readonly string Port = Var("PORT") is { Length: > 0 } p ? p : "7420";
    public static readonly Uri Base = new($"http://127.0.0.1:{Port}/");
    /// <summary>scripts/e2e.ts drives the app through files in this folder (E2E.cs). Unset in normal use.</summary>
    public static readonly string? E2EDir = Var("VIEWSWITCHER_E2E_DIR") is { Length: > 0 } d ? d : null;
    public static bool E2E => E2EDir is not null;
    public static readonly bool UpdatesEnabled = Var("VIEWSWITCHER_UPDATES") != "0";
    public static readonly string Version = Assembly.GetExecutingAssembly().GetName().Version is { } v ? $"{v.Major}.{v.Minor}.{v.Build}" : "0.0.0";

    /// <summary>The folder ViewSwitcher.exe is in: Helpers\ and Resources\ beside it in an installed or built app.</summary>
    public static readonly string AppDir = AppContext.BaseDirectory;
    public static readonly string Sidecar = Path.Combine(AppDir, "Helpers", "viewswitcher-server.exe");
    /// <summary>A build without the bundled server is a development build (bun run win:dev): its own settings, log and web view data.</summary>
    public static readonly bool Dev = !File.Exists(Sidecar);

    static readonly string LocalAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    static readonly string AppData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
    public static readonly string LogFile = ServerLog.File(LocalAppData, Dev, E2EDir);
    public static readonly string SettingsFile = E2EDir is not null ? Path.Combine(E2EDir, "settings.json") : AppPaths.Settings(AppData, Dev);
    public static readonly string WebViewData = E2EDir is not null ? Path.Combine(E2EDir, "WebView2") : AppPaths.WebView(LocalAppData, Dev);

    /// <summary>A new secret each launch, for the pairing endpoints only this app may call (/api/remote…). It goes to the server in its environment and never leaves this PC.</summary>
    public static readonly string AdminToken = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));

    public static ServerApi Api => new(Base, AdminToken);

    public static AppSettings Settings { get; } = AppSettings.Load(SettingsFile);
    public static void SaveSettings()
    {
        try { Settings.Save(SettingsFile); } catch (Exception) { }
    }

    /// <summary>"Let phones and tablets on this Wi-Fi connect": off by default and remembered.</summary>
    public static bool Wifi
    {
        get => Settings.WifiRemotes;
        set { Settings.WifiRemotes = value; SaveSettings(); }
    }

    /// <summary>The bundled server in a built app; `bun apps/server/src/index.ts` from a checkout (VIEWSWITCHER_REPO, set by scripts/dev.ts).</summary>
    public static Launch Launch()
    {
        var env = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (System.Collections.DictionaryEntry e in Environment.GetEnvironmentVariables()) env[(string)e.Key] = (string?)e.Value ?? "";
        env["PORT"] = Port;
        env["VIEWSWITCHER_ADMIN_TOKEN"] = AdminToken;
        env["VIEWSWITCHER_LAN"] = Wifi ? "1" : "0";
        // The server exits if this app goes away without stopping it (parent-watch.ts), and stops when
        // the app closes its stdin (main.ts): Windows has no SIGTERM.
        env["VIEWSWITCHER_PARENT_PID"] = Environment.ProcessId.ToString();
        env["VIEWSWITCHER_STOP_ON_STDIN"] = "1";
        // The Claude Desktop extension the server makes carries the app's version.
        env["VIEWSWITCHER_VERSION"] = Version;
        if (!Dev)
        {
            var res = Path.Combine(AppDir, "Resources");
            env["VIEWSWITCHER_WEB_DIST"] = Path.Combine(res, "web");
            env["VIEWSWITCHER_STARTER"] = Path.Combine(res, "starter");
            env["VIEWSWITCHER_LIBRARY_KIT"] = Path.Combine(res, "library-kit");
            env["VIEWSWITCHER_PACKS"] = Path.Combine(res, "packs"); // the built-in template packs
            return new Launch(Sidecar, [], env, LogFile);
        }
        var repo = Var("VIEWSWITCHER_REPO");
        var bun = Var("BUN") is { Length: > 0 } b ? b : Which("bun.exe");
        if (repo is null || bun is null)
            throw new ServerException(ServerError.StartFailed("This build has no server inside it. Run it with bun run win:dev, or build it with bun run win:build."));
        return new Launch(bun, [Path.Combine(repo, "apps", "server", "src", "index.ts")], env, LogFile);
    }

    public static string? Which(string name)
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var dirs = (Var("PATH") ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries).Append(Path.Combine(home, ".bun", "bin"));
        return dirs.Select(d => Path.Combine(d, name)).FirstOrDefault(File.Exists);
    }
}
