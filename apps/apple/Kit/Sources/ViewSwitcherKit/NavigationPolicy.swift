import Foundation

/// What a web view does with a navigation. Pure, so XCTest covers every case.
public enum NavigationDecision: Equatable, Sendable {
    case allow
    /// Cancel it and open the URL outside: in the default browser (http and https), or Cursor's MCP install link.
    case openInBrowser(URL)
    /// Cancel it: a scheme that could launch something (file:, app URL schemes, javascript: …).
    case deny
}

public enum NavigationPolicy {
    static func isWeb(_ url: URL) -> Bool {
        let s = url.scheme?.lowercased()
        return s == "http" || s == "https"
    }

    static func sameOrigin(_ a: URL, _ b: URL) -> Bool {
        a.scheme?.lowercased() == b.scheme?.lowercased() && a.host?.lowercased() == b.host?.lowercased() && port(a) == port(b)
    }

    static func port(_ u: URL) -> Int? {
        u.port ?? (u.scheme?.lowercased() == "https" ? 443 : u.scheme?.lowercased() == "http" ? 80 : nil)
    }

    /// Edit with AI's "Add to Cursor" (cursor.com/docs/mcp/install-links): the one app URL the Mac window
    /// opens. Only Cursor's MCP install, which asks before it adds anything, never another cursor: link.
    public static func isCursorInstall(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "cursor" && url.host?.lowercased() == "anysphere.cursor-deeplink" && url.path == "/mcp/install"
    }

    /// What may leave the window for another app: web pages, and Cursor's install link.
    public static func opensOutside(_ url: URL) -> Bool { isWeb(url) || isCursorInstall(url) }

    /// A navigation the switcher itself started: from the main frame while it shows the switcher's own
    /// pages, never a scene. (Scenes are sandboxed frames without allow-top-navigation, so they can't
    /// navigate the window anyway; a scene opened on its own in the window is under /library/.)
    /// `source` is the URL of the frame the navigation came from, nil when unknown.
    public static func startedBySwitcher(source: URL?, sourceMainFrame: Bool, server: URL) -> Bool {
        guard sourceMainFrame, let s = source, sameOrigin(s, server) else { return false }
        return !s.path.lowercased().hasPrefix("/library/")
    }

    /// Edit with AI's "Add to Claude Desktop": the server's extension for this install, which the Mac
    /// window saves to Downloads and opens (Claude Desktop shows its install dialog). Nothing else downloads.
    public static func isExtensionDownload(_ url: URL, server: URL) -> Bool {
        sameOrigin(url, server) && url.path == "/api/agent/viewswitcher.mcpb"
    }

    /// Schemes a frame inside the page may load (scene previews, the editor), never file: or app schemes.
    public static func frameAllowed(_ url: URL) -> Bool {
        ["http", "https", "about", "blob", "data"].contains(url.scheme?.lowercased() ?? "")
    }

    /// The Mac window: the main frame stays on the server; other web pages go to the browser.
    /// `newWindow` is window.open / target=_blank, which never opens inside the app. Cursor's install
    /// link opens only when `fromSwitcher` (startedBySwitcher): Edit with AI's own button, never a scene.
    public static func mac(_ url: URL, server: URL, mainFrame: Bool, newWindow: Bool = false, fromSwitcher: Bool = false) -> NavigationDecision {
        let outside = isWeb(url) || (fromSwitcher && isCursorInstall(url))
        if newWindow { return outside ? .openInBrowser(url) : .deny }
        if !mainFrame { return frameAllowed(url) ? .allow : .deny }
        if sameOrigin(url, server) { return .allow }
        // about:blank and the like while the page sets itself up are harmless; everything else leaves.
        if url.scheme?.lowercased() == "about" { return .allow }
        return outside ? .openInBrowser(url) : .deny
    }

    /// The scheme of the iPad app's bundled connector page (viewswitcher://connector/).
    public static let connectorScheme = "viewswitcher"

    /// A page on the server the Mac window may load again (http(s), allowed in the main frame).
    public static func onServer(_ url: URL, server: URL) -> Bool {
        url.scheme?.hasPrefix("http") == true && mac(url, server: server, mainFrame: true) == .allow
    }

    /// What the Mac window loads when a load failed (the server restarting) or after Restart Server:
    /// the page that failed to open, else the one that was open, when it's on the server; else the
    /// switcher's root. Never the root when a page can be kept, so nobody is dropped out of the editor.
    public static func retryTarget(failed: URL?, current: URL?, server: URL) -> URL {
        [failed, current].compactMap { $0 }.first { onServer($0, server: server) } ?? server.appendingPathComponent("")
    }

    /// Who may ask the app for the camera scanner and Bonjour (ConnectorBridge): only the bundled
    /// connector or demo in the main frame, never a page the Mac serves, a scene, or a subframe.
    public static func connectorBridgeAllowed(isMainFrame: Bool, scheme: String) -> Bool {
        isMainFrame && scheme.lowercased() == connectorScheme
    }

    /// Hosts the iPhone and iPad app may show in its main frame (the Capacitor app's allowNavigation): the
    /// USB-C tunnel on 127.0.0.1, tailscale serve (*.ts.net), Bonjour names (*.local), and a private LAN
    /// address, which the Mac's pairing QR code carries. A LAN device could answer as either a
    /// .local name or an address, so the address adds nothing a .local name didn't already allow.
    public static func iPadHostAllowed(_ host: String?) -> Bool {
        guard let h = host?.lowercased(), !h.isEmpty else { return false }
        return h == "127.0.0.1" || h == "localhost" || h.hasSuffix(".ts.net") || h.hasSuffix(".local") || PairingLink.isPrivateIPv4(h)
    }

    /// The iPad app: the connector, then the switcher on an allowed host; other web pages go to Safari.
    public static func iPad(_ url: URL, mainFrame: Bool, newWindow: Bool = false) -> NavigationDecision {
        if newWindow { return isWeb(url) ? .openInBrowser(url) : .deny }
        if !mainFrame { return frameAllowed(url) ? .allow : .deny }
        let scheme = url.scheme?.lowercased()
        if scheme == connectorScheme { return url.host?.lowercased() == "connector" ? .allow : .deny }
        if scheme == "about" { return .allow }
        // The one-time hand-over from the Capacitor build's origin (CapacitorMigration in the app).
        if scheme == "capacitor" { return url.host?.lowercased() == "localhost" && url.path == "/migrate" ? .allow : .deny }
        guard isWeb(url) else { return .deny }
        return iPadHostAllowed(url.host) ? .allow : .openInBrowser(url)
    }
}
