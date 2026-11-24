import Foundation

/// What a web view does with a navigation (MAC-13, MAC-14). Pure, so XCTest covers every case.
public enum NavigationDecision: Equatable, Sendable {
    case allow
    /// Cancel it and open the URL in the default browser (http and https only).
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

    /// Schemes a frame inside the page may load (scene previews, the editor), never file: or app schemes.
    public static func frameAllowed(_ url: URL) -> Bool {
        ["http", "https", "about", "blob", "data"].contains(url.scheme?.lowercased() ?? "")
    }

    /// The Mac window: the main frame stays on the server; other web pages go to the browser.
    /// `newWindow` is window.open / target=_blank, which never opens inside the app.
    public static func mac(_ url: URL, server: URL, mainFrame: Bool, newWindow: Bool = false) -> NavigationDecision {
        if newWindow { return isWeb(url) ? .openInBrowser(url) : .deny }
        if !mainFrame { return frameAllowed(url) ? .allow : .deny }
        if sameOrigin(url, server) { return .allow }
        // about:blank and the like while the page sets itself up are harmless; everything else leaves.
        if url.scheme?.lowercased() == "about" { return .allow }
        return isWeb(url) ? .openInBrowser(url) : .deny
    }

    /// The scheme of the iPad app's bundled connector page (viewswitcher://connector/).
    public static let connectorScheme = "viewswitcher"

    /// Hosts the iPad app may show in its main frame (the Capacitor app's allowNavigation): the
    /// USB-C tunnel on 127.0.0.1, tailscale serve (*.ts.net) and Bonjour names (*.local).
    public static func iPadHostAllowed(_ host: String?) -> Bool {
        guard let h = host?.lowercased(), !h.isEmpty else { return false }
        return h == "127.0.0.1" || h == "localhost" || h.hasSuffix(".ts.net") || h.hasSuffix(".local")
    }

    /// The iPad app: the connector, then the switcher on an allowed host; other web pages go to Safari.
    public static func iPad(_ url: URL, mainFrame: Bool, newWindow: Bool = false) -> NavigationDecision {
        if newWindow { return isWeb(url) ? .openInBrowser(url) : .deny }
        if !mainFrame { return frameAllowed(url) ? .allow : .deny }
        let scheme = url.scheme?.lowercased()
        if scheme == connectorScheme { return url.host?.lowercased() == "connector" ? .allow : .deny }
        if scheme == "about" { return .allow }
        guard isWeb(url) else { return .deny }
        return iPadHostAllowed(url.host) ? .allow : .openInBrowser(url)
    }
}
