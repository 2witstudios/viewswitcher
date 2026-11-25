#if os(macOS)
import Foundation

/// The menu-bar item's menu, as data: what it lists for a state of the app, and what each item does.
/// The Mac app turns it into an NSMenu (StatusMenuBuilder); scripts/e2e.ts reads that menu back.
public enum StatusMenu {
    public enum Action: Sendable {
        case openWindow, editWithAI, openInBrowser, openLibrary, setUpObs
        case toggleWifi, openRemotes
        case restartServer, checkForUpdates, toggleLogin, showLog, quit
    }

    public enum Item: Equatable, Sendable {
        /// A line of status (never clickable).
        case info(String)
        case separator
        case action(String, Action, enabled: Bool = true, checked: Bool = false, toolTip: String? = nil)

        public var title: String? {
            switch self {
            case .info(let t), .action(let t, _, _, _, _): t
            case .separator: nil
            }
        }
    }

    /// What the app knows when the menu opens.
    public struct Context: Equatable, Sendable {
        public var status: MenuStatus
        public var server: ServerState
        public var obsConnected: Bool
        public var wifi: Bool
        public var updater: Bool
        public var openAtLogin: Bool

        public init(status: MenuStatus, server: ServerState, obsConnected: Bool, wifi: Bool, updater: Bool, openAtLogin: Bool) {
            self.status = status
            self.server = server
            self.obsConnected = obsConnected
            self.wifi = wifi
            self.updater = updater
            self.openAtLogin = openAtLogin
        }
    }

    public static let wifiTitle = "Let Phones and Tablets on This Wi-Fi Connect"

    /// The server line: what's happening to it, when that isn't simply "running".
    public static func serverLine(_ s: ServerState) -> String? {
        switch s {
        case .starting: "Server: starting…"
        case .restarting(let attempt, _): attempt > 1 ? "Server stopped again: restarting…" : "Server stopped: restarting…"
        case .crashed: "Server keeps stopping"
        case .lost: "Server: stopped"
        case .failed: "Server: couldn't start"
        case .owned, .attached, .quitting: nil
        }
    }

    public static func items(_ c: Context) -> [Item] {
        let s = c.status
        let up = c.server.running
        let owned = c.server == .owned
        var items: [Item] = []
        // While the server is down, what happened to it takes the on-air line ("Server not responding").
        items += [serverLine(c.server) ?? s.onAir, s.obs, s.ipad].map { .info($0) }
        items += [
            .separator,
            .action("Open ViewSwitcher", .openWindow),
            .action("Edit with AI…", .editWithAI, enabled: up),
            .action("Open in Browser", .openInBrowser, enabled: up),
            .action("Open Library Folder", .openLibrary, enabled: up),
            .action(s.obsReady ? "Set Up OBS Again" : "Set Up OBS…", .setUpObs, enabled: up && c.obsConnected),
            .separator,
            .action(wifiTitle, .toggleWifi, enabled: owned, checked: c.wifi, toolTip: RemoteText.help),
            .action("Phones and Tablets…", .openRemotes, enabled: owned),
            .separator,
        ]
        switch c.server {
        case .starting: items.append(.action("Starting Server…", .restartServer, enabled: false))
        case .restarting: items.append(.action("Restarting Server…", .restartServer, enabled: false))
        case .crashed, .lost, .failed: items.append(.action("Restart Server", .restartServer))
        case .owned, .attached, .quitting: break
        }
        items += [
            .action("Check for Updates…", .checkForUpdates, enabled: c.updater),
            .action("Open at Login", .toggleLogin, checked: c.openAtLogin),
            .action("Show Server Log", .showLog),
            .separator,
            .action(c.server == .attached ? "Quit ViewSwitcher (server keeps running)" : "Quit ViewSwitcher", .quit),
        ]
        return items
    }
}
#endif
