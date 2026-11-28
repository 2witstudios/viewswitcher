namespace ViewSwitcher.Core;

public enum NavigationKind { Allow, OpenInBrowser, Deny }

/// <summary>What the web view does with a navigation (Kit's NavigationDecision).</summary>
public sealed record NavigationDecision(NavigationKind Kind, Uri? Url = null)
{
    public static readonly NavigationDecision Allow = new(NavigationKind.Allow);
    public static readonly NavigationDecision Deny = new(NavigationKind.Deny);
    public static NavigationDecision OpenInBrowser(Uri url) => new(NavigationKind.OpenInBrowser, url);
}

/// <summary>Kit's NavigationPolicy, for the Windows window. Pure, so the tests cover every case.</summary>
public static class NavigationPolicy
{
    static string Scheme(Uri u) => u.Scheme.ToLowerInvariant();

    public static bool IsWeb(Uri url) => Scheme(url) is "http" or "https";

    static int? Port(Uri u) => u.IsDefaultPort ? (Scheme(u) == "https" ? 443 : Scheme(u) == "http" ? 80 : null) : u.Port;

    public static bool SameOrigin(Uri a, Uri b) =>
        Scheme(a) == Scheme(b) && string.Equals(a.Host, b.Host, StringComparison.OrdinalIgnoreCase) && Port(a) == Port(b);

    /// <summary>Edit with AI's "Add to Cursor": only Cursor's MCP install, which asks before it adds anything.</summary>
    public static bool IsCursorInstall(Uri url) =>
        Scheme(url) == "cursor" && url.Host.Equals("anysphere.cursor-deeplink", StringComparison.OrdinalIgnoreCase) && url.AbsolutePath == "/mcp/install";

    /// <summary>What may leave the window for another app: web pages, and Cursor's install link.</summary>
    public static bool OpensOutside(Uri url) => IsWeb(url) || IsCursorInstall(url);

    /// <summary>A navigation the switcher itself started: from its own pages in the main frame, never a scene (/library/).</summary>
    public static bool StartedBySwitcher(Uri? source, bool sourceMainFrame, Uri server) =>
        sourceMainFrame && source is not null && SameOrigin(source, server) && !source.AbsolutePath.StartsWith("/library/", StringComparison.OrdinalIgnoreCase);

    /// <summary>Edit with AI's "Add to Claude Desktop": the one download the window lets through (saved to Downloads and opened).</summary>
    public static bool IsExtensionDownload(Uri url, Uri server) => SameOrigin(url, server) && url.AbsolutePath == "/api/agent/viewswitcher.mcpb";

    /// <summary>Schemes a frame inside the page may load, never file: or app schemes.</summary>
    public static bool FrameAllowed(Uri url) => Scheme(url) is "http" or "https" or "about" or "blob" or "data";

    /// <summary>
    /// The window: the main frame stays on the server; other web pages go to the browser. <paramref name="newWindow"/>
    /// is window.open / target=_blank, which never opens inside the app. Cursor's install link opens only
    /// when <paramref name="fromSwitcher"/>.
    /// </summary>
    public static NavigationDecision Window(Uri url, Uri server, bool mainFrame, bool newWindow = false, bool fromSwitcher = false)
    {
        var outside = IsWeb(url) || (fromSwitcher && IsCursorInstall(url));
        if (newWindow) return outside ? NavigationDecision.OpenInBrowser(url) : NavigationDecision.Deny;
        if (!mainFrame) return FrameAllowed(url) ? NavigationDecision.Allow : NavigationDecision.Deny;
        if (SameOrigin(url, server)) return NavigationDecision.Allow;
        // about:blank and the like while the page sets itself up are harmless; everything else leaves.
        if (Scheme(url) == "about") return NavigationDecision.Allow;
        return outside ? NavigationDecision.OpenInBrowser(url) : NavigationDecision.Deny;
    }

    /// <summary>A page on the server the window may load again.</summary>
    public static bool OnServer(Uri url, Uri server) => Scheme(url).StartsWith("http") && Window(url, server, true).Kind == NavigationKind.Allow;

    /// <summary>
    /// What the window loads when a load failed (the server restarting) or after Restart Server: the page
    /// that failed to open, else the one that was open, when it's on the server; else the root. Never the
    /// root when a page can be kept, so nobody is dropped out of the editor.
    /// </summary>
    public static Uri RetryTarget(Uri? failed, Uri? current, Uri server) =>
        new[] { failed, current }.FirstOrDefault(u => u is not null && OnServer(u, server)) ?? new Uri(server, "/");

    /// <summary>A URL string as a Uri, or null when it isn't one.</summary>
    public static Uri? Parse(string? s) => Uri.TryCreate(s, UriKind.Absolute, out var u) ? u : null;
}
