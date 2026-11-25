import AppKit
import ViewSwitcherKit

/// Settings from the environment, read once.
enum Env {
    static let vars = ProcessInfo.processInfo.environment
    static let port = vars["PORT"] ?? "7420"
    static let base = URL(string: "http://127.0.0.1:\(port)")!
    /// scripts/e2e.ts drives the app through files in this folder (E2E.swift). Unset in normal use.
    static let e2eDir = vars["VIEWSWITCHER_E2E_DIR"].map { URL(fileURLWithPath: $0) }
    static var e2e: Bool { e2eDir != nil }
    static let updatesEnabled = vars["VIEWSWITCHER_UPDATES"] != "0"
    static let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    static let logFile = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/ViewSwitcher/server.log")
    /// A new secret each launch, for the pairing endpoints only this app may call (apps/server: /api/remote…).
    /// It goes to the server in its environment and never leaves this Mac.
    static let adminToken: String = {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { fatalError("no random bytes") }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }()

    /// "Let phones and tablets on this Wi-Fi connect" (MAC-23): off by default and remembered. The
    /// end-to-end check keeps its own value in memory, so it never changes the installed app's setting.
    @MainActor static var wifi: Bool {
        get { e2e ? e2eWifi : UserDefaults.standard.bool(forKey: "wifiRemotes") }
        set { if e2e { e2eWifi = newValue } else { UserDefaults.standard.set(newValue, forKey: "wifiRemotes") } }
    }
    @MainActor private static var e2eWifi = false

    /// The bundled sidecar in a built app; `bun apps/server/src/index.ts` from a checkout (scripts/dev.sh sets VIEWSWITCHER_REPO).
    @MainActor static func launch() -> Launch? {
        var env = vars
        env["PORT"] = port
        env["VIEWSWITCHER_ADMIN_TOKEN"] = adminToken
        env["VIEWSWITCHER_LAN"] = wifi ? "1" : "0"
        // The server exits if this app goes away without stopping it (apps/server/src/index.ts).
        env["VIEWSWITCHER_PARENT_PID"] = String(getpid())
        // The Claude Desktop extension the server makes carries the app's version.
        env["VIEWSWITCHER_VERSION"] = version
        let contents = Bundle.main.bundleURL.appendingPathComponent("Contents")
        let sidecar = contents.appendingPathComponent("Helpers/viewswitcher-server")
        if FileManager.default.isExecutableFile(atPath: sidecar.path) {
            let res = contents.appendingPathComponent("Resources")
            env["VIEWSWITCHER_WEB_DIST"] = res.appendingPathComponent("web").path
            env["VIEWSWITCHER_STARTER"] = res.appendingPathComponent("starter").path
            env["VIEWSWITCHER_LIBRARY_KIT"] = res.appendingPathComponent("library-kit").path
            return Launch(executable: sidecar, environment: env, logFile: logFile)
        }
        guard let repo = vars["VIEWSWITCHER_REPO"] else { return nil }
        let bun = vars["BUN"].map { URL(fileURLWithPath: $0) } ?? which("bun")
        guard let bun else { return nil }
        return Launch(executable: bun, arguments: ["\(repo)/apps/server/src/index.ts"], environment: env, logFile: logFile)
    }

    static func which(_ name: String) -> URL? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let dirs = (vars["PATH"] ?? "").split(separator: ":").map(String.init) + ["\(home)/.bun/bin", "/opt/homebrew/bin", "/usr/local/bin"]
        return dirs.map { URL(fileURLWithPath: $0).appendingPathComponent(name) }.first { FileManager.default.isExecutableFile(atPath: $0.path) }
    }
}

/// Everything the app shows or opens outside its window goes through here, so scripts/e2e.ts can
/// record it instead of opening browsers, alerts and notifications on the test machine.
@MainActor
enum Outside {
    static var opened: [String] = []
    static var alerts: [String] = []
    static var notices: [String] = []

    /// http(s), plus Cursor's MCP install link (NavigationPolicy): a scene is a page anyone can write,
    /// and opening file: or any other app URL scheme would launch things.
    static func openInBrowser(_ url: URL) {
        guard NavigationPolicy.opensOutside(url) else { return }
        if Env.e2e { opened.append(url.absoluteString); return }
        NSWorkspace.shared.open(url)
    }

    /// A file the app saved (Add to Claude Desktop's extension), opened in the app that handles it.
    static func openFile(_ url: URL) {
        if Env.e2e { opened.append(url.path); return }
        NSWorkspace.shared.open(url)
    }

    static func openFolder(_ url: URL) {
        if Env.e2e { opened.append(url.path); return }
        NSWorkspace.shared.open(url)
    }

    /// A modal alert; returns the index of the button chosen (in e2e: `e2eAnswer`).
    @discardableResult
    static func alert(_ title: String, _ message: String, style: NSAlert.Style = .warning, buttons: [String] = ["OK"], e2eAnswer: Int = 0) -> Int {
        if Env.e2e { alerts.append("\(title): \(message)"); return e2eAnswer }
        let a = NSAlert()
        a.alertStyle = style
        a.messageText = title
        a.informativeText = message
        buttons.forEach { a.addButton(withTitle: $0) }
        NSApp.activate(ignoringOtherApps: true)
        return a.runModal().rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
    }

    static func notify(_ title: String, _ body: String) {
        if Env.e2e { notices.append("\(title): \(body)"); return }
        Notifier.shared.post(title, body)
    }
}
