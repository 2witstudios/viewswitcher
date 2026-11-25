import AppKit
import ServiceManagement
import Sparkle
import ViewSwitcherKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private(set) var server: Server?
    private(set) var live: LiveState?
    private(set) var switcher: SwitcherWindow?
    private var liveClient: LiveClient?
    private var statusItem: NSStatusItem?
    private(set) var statusMenu = NSMenu()
    private var restarting = false
    private var quitting = false
    private var stopped = false
    private var updater: SPUStandardUpdaterController?
    private var e2e: E2E?

    // ------------------------------------------------------------ lifecycle

    func applicationDidFinishLaunching(_ notification: Notification) {
        // One ViewSwitcher at a time: a second launch brings the first one forward.
        if let other = NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "")
            .first(where: { $0.processIdentifier != getpid() }), !Env.e2e {
            // Opening it again delivers a reopen event, so it shows its window (applicationShouldHandleReopen).
            if let url = other.bundleURL {
                NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration()) { _, _ in exit(0) }
                return
            }
            other.activate()
            exit(0)
        }
        NSApp.mainMenu = mainMenu()
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.imagePosition = .imageLeading
        statusMenu.delegate = self
        item.menu = statusMenu
        statusItem = item
        renderStatus()
        if let dir = Env.e2eDir { e2e = E2E(dir: dir, app: self) }
        startUpdater()

        Task {
            guard await startServer(atLaunch: true) else { return }
            watchState()
            renderStatus()
            openWindow()
        }
    }

    /// The Dock icon (or opening the app again) brings the window back.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openWindow()
        return false
    }

    /// No window doesn't mean quit: the server keeps running.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        quitting = true
        liveClient?.stop()
        guard !stopped, let s = server, s.owned else { return .terminateNow }
        server = nil
        // While AppKit waits for the reply it runs the main run loop in its modal mode, where main-actor
        // tasks don't run: stop off the main actor, and reply through a run-loop block in common modes.
        Task.detached {
            await s.stop()
            CFRunLoopPerformBlock(CFRunLoopGetMain(), CFRunLoopMode.commonModes.rawValue) {
                MainActor.assumeIsolated {
                    self.stopped = true
                    NSApp.reply(toApplicationShouldTerminate: true)
                }
            }
            CFRunLoopWakeUp(CFRunLoopGetMain())
        }
        return .terminateLater
    }

    // ------------------------------------------------------------ server (MAC-11)

    /// At launch a server that can't start ends the app; from Restart Server it only says why.
    @discardableResult
    func startServer(atLaunch: Bool) async -> Bool {
        do {
            guard let launch = Env.launch() else {
                throw ServerError.startFailed("This build has no server inside it. Run it with bun run mac:dev, or build it with bun run mac:build.")
            }
            server = try await connectOrStart(Env.base, launch: launch)
        } catch {
            let portTaken: Bool = if case ServerError.portTaken = error { true } else { false }
            let why = error.localizedDescription + (portTaken ? "" : "\n\nServer log: \(Env.logFile.path)")
            Outside.alert(portTaken ? "Port in use" : "ViewSwitcher couldn't start", why, style: .critical)
            if atLaunch {
                quitting = true
                NSApp.terminate(nil)
            }
            return false
        }
        server?.onExit = { [weak self] code in
            guard let self else { return }
            self.server = nil
            self.live = nil
            self.renderStatus()
            if !self.quitting { Outside.notify("ViewSwitcher server stopped", "It exited (\(code)). Use Restart Server in the menu bar.") }
        }
        return true
    }

    @objc func restartServer() {
        guard !restarting, server == nil else { return } // a second click while one starts would race it for the port
        restarting = true
        renderStatus()
        Task {
            if await startServer(atLaunch: false) {
                watchState()
                switcher?.reloadCurrent()
            }
            restarting = false
            renderStatus()
        }
    }

    /// The menu bar follows the live state over the server's WebSocket, like any switcher page.
    func watchState() {
        liveClient?.close()
        let client = LiveClient(base: Env.base)
        client.onState = { [weak self] state in
            self?.live = state
            self?.renderStatus()
        }
        client.onClose = { [weak self] in
            guard let self, let s = self.server, !s.owned, !self.quitting else { return }
            // Attached to a server someone else started (bun run dev) and it went away: forget it, so
            // the menu offers Restart Server (which attaches again, or starts the bundled one).
            Task {
                if await probe(Env.base) == .none, self.server === s {
                    self.server = nil
                    self.renderStatus()
                }
            }
        }
        liveClient = client
        client.start()
    }

    // ------------------------------------------------------------ window

    @objc func openWindow() {
        if switcher == nil { switcher = SwitcherWindow(base: Env.base) }
        switcher?.show()
    }

    /// The switcher's Edit with AI sheet (MCP-10): connect an agent, the agent on-air setting.
    @objc func editWithAI() {
        openWindow()
        switcher?.openAgentSheet()
    }

    // ------------------------------------------------------------ menu bar (MAC-12)

    var status: MenuStatus { MenuStatus(server == nil ? nil : live) }

    func renderStatus() {
        let s = status
        if let button = statusItem?.button {
            button.image = NSImage(named: s.live ? "StatusIconLive" : "StatusIcon")
            button.image?.isTemplate = !s.live
            button.title = s.title.isEmpty ? "" : " \(s.title)"
            button.toolTip = s.onAir
        }
        buildStatusMenu()
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        if menu === statusMenu { buildStatusMenu() }
    }

    private func item(_ title: String, _ action: Selector?, enabled: Bool = true) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: enabled ? action : nil, keyEquivalent: "")
        i.target = self
        i.isEnabled = enabled && action != nil
        return i
    }

    func buildStatusMenu() {
        let s = status
        let m = statusMenu
        m.autoenablesItems = false
        m.removeAllItems()
        for line in [s.onAir, s.obs, s.ipad] { m.addItem(item(line, nil, enabled: false)) }
        m.addItem(.separator())
        m.addItem(item("Open ViewSwitcher", #selector(openWindow)))
        m.addItem(item("Edit with AI…", #selector(editWithAI), enabled: server != nil))
        m.addItem(item("Open in Browser", #selector(openInBrowser), enabled: server != nil))
        m.addItem(item("Open Library Folder", #selector(openLibrary), enabled: server != nil))
        m.addItem(item(s.obsReady ? "Set Up OBS Again" : "Set Up OBS…", #selector(setUpObs), enabled: live?.obs.connected == true && server != nil))
        m.addItem(.separator())
        if server == nil { m.addItem(item(restarting ? "Starting Server…" : "Restart Server", #selector(restartServer), enabled: !restarting)) }
        m.addItem(item("Check for Updates…", #selector(checkForUpdates), enabled: updater != nil))
        let login = item("Open at Login", #selector(toggleLogin))
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        m.addItem(login)
        m.addItem(item("Show Server Log", #selector(showLog)))
        m.addItem(.separator())
        m.addItem(item(server.map { !$0.owned } == true ? "Quit ViewSwitcher (server keeps running)" : "Quit ViewSwitcher", #selector(quit)))
    }

    @objc func openInBrowser() { Outside.openInBrowser(Env.base.appendingPathComponent("")) }

    @objc func openLibrary() {
        Task {
            do {
                // The one API response with an absolute path in it, answered only on loopback (apps/server/src/index.ts).
                let (data, _) = try await URLSession.shared.data(from: Env.base.appendingPathComponent("api/info"))
                guard let info = try JSONSerialization.jsonObject(with: data) as? [String: Any], let path = info["library"] as? String else {
                    throw ServerError.startFailed("The server didn't say where the library is.")
                }
                Outside.openFolder(URL(fileURLWithPath: path, isDirectory: true))
            } catch {
                Outside.alert("Couldn't open the library folder", error.localizedDescription)
            }
        }
    }

    /// Setup never switches OBS's scene while it's live (the server checks too), but say so before doing anything.
    @objc func setUpObs() {
        if let live, live.obsLive {
            let answer = Outside.alert(
                "OBS is \(live.obs.streaming ? "streaming" : "recording")",
                "Set up the ViewSwitcher scene anyway? OBS will stay on the scene it's showing now; switch to ViewSwitcher in OBS when you're ready.",
                buttons: ["Set Up", "Cancel"], e2eAnswer: 1
            )
            guard answer == 0 else { return }
        }
        Task {
            do {
                var req = URLRequest(url: Env.base.appendingPathComponent("api/obs/setup"))
                req.httpMethod = "POST"
                req.setValue("application/json", forHTTPHeaderField: "content-type")
                req.httpBody = Data("{}".utf8)
                let (data, response) = try await URLSession.shared.data(for: req)
                let body = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
                guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                    throw ServerError.startFailed(body["error"] as? String ?? "The server said no.")
                }
                let missing = body["missing"] as? [String] ?? []
                let next = missing.isEmpty ? "" : " Add \(missing.joined(separator: ", ")) to the ViewSwitcher scene in OBS, then set up again."
                let switched = body["switched"] as? Bool ?? false
                Outside.notify("OBS is set up", (switched ? "The ViewSwitcher scene is ready." : "The ViewSwitcher scene is ready; OBS stayed on its current scene.") + next)
            } catch {
                Outside.alert("Couldn't set up OBS", error.localizedDescription)
            }
        }
    }

    /// Off by default (Decisions): a server starting at every login surprises someone who streams once a week.
    @objc func toggleLogin() {
        guard !Env.e2e else { return }
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() }
        } catch {
            Outside.alert("Couldn't change Open at Login", error.localizedDescription)
        }
        buildStatusMenu()
    }

    @objc func showLog() {
        capLog(Env.logFile)
        if !FileManager.default.fileExists(atPath: Env.logFile.path) { FileManager.default.createFile(atPath: Env.logFile.path, contents: nil) }
        Outside.openFolder(Env.logFile)
    }

    @objc func quit() { NSApp.terminate(nil) }

    // ------------------------------------------------------------ updates (MAC-15)

    /// Sparkle against the appcast on GitHub Releases. Not in a build without a public key (Debug)
    /// or with VIEWSWITCHER_UPDATES=0 (scripts/e2e.ts).
    func startUpdater() {
        let key = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String ?? ""
        guard Env.updatesEnabled, !Env.e2e, key.count > 20, Env.launch().map({ $0.executable.lastPathComponent == "viewswitcher-server" }) == true else { return }
        updater = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
    }

    @objc func checkForUpdates() { updater?.checkForUpdates(nil) }

    /// Check for Updates… is enabled only with a running updater (not in Debug, with updates off, or without a key).
    @objc func validateMenuItem(_ item: NSMenuItem) -> Bool {
        item.action == #selector(checkForUpdates) ? updater != nil : true
    }

    // ------------------------------------------------------------ app menu

    func mainMenu() -> NSMenu {
        let main = NSMenu()
        func sub(_ title: String, _ items: [NSMenuItem]) {
            let top = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            let m = NSMenu(title: title)
            items.forEach(m.addItem)
            top.submenu = m
            main.addItem(top)
        }
        func i(_ title: String, _ action: Selector, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
            let it = NSMenuItem(title: title, action: action, keyEquivalent: key)
            it.keyEquivalentModifierMask = mods
            it.target = target
            return it
        }
        sub("ViewSwitcher", [
            i("About ViewSwitcher", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            i("Check for Updates…", #selector(checkForUpdates), target: self),
            .separator(),
            i("Hide ViewSwitcher", #selector(NSApplication.hide(_:)), "h"),
            i("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            i("Show All", #selector(NSApplication.unhideAllApplications(_:))),
            .separator(),
            i("Quit ViewSwitcher", #selector(quit), "q", target: self),
        ])
        sub("File", [i("Close Window", #selector(NSWindow.performClose(_:)), "w")])
        // Undo/Redo forward to the page (MAC-13): see forwardUndo.
        sub("Edit", [
            i("Undo", #selector(forwardUndo(_:)), "z", target: self),
            i("Redo", #selector(forwardRedo(_:)), "z", [.command, .shift], target: self),
            .separator(),
            i("Cut", #selector(NSText.cut(_:)), "x"),
            i("Copy", #selector(NSText.copy(_:)), "c"),
            i("Paste", #selector(NSText.paste(_:)), "v"),
            i("Paste and Match Style", #selector(NSTextView.pasteAsPlainText(_:)), "v", [.command, .option, .shift]),
            i("Delete", #selector(NSText.delete(_:))),
            i("Select All", #selector(NSText.selectAll(_:)), "a"),
        ])
        sub("View", [
            i("Reload", #selector(reload), "r", target: self),
            .separator(),
            i("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])
        let window: [NSMenuItem] = [
            i("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
            i("Zoom", #selector(NSWindow.performZoom(_:))),
            .separator(),
            i("ViewSwitcher", #selector(openWindow), "0", target: self),
            i("Bring All to Front", #selector(NSApplication.arrangeInFront(_:))),
        ]
        sub("Window", window)
        NSApp.windowsMenu = main.items.last?.submenu
        return main
    }

    @objc func reload() { switcher?.webView.reload() }

    /// Edit → Undo / Redo (Decisions, 2026-11-24). WKWebView hands a typed ⌘Z to the page first, and
    /// the menu only gets it when the page didn't handle it: then it's the native text undo if focus
    /// is in a field, and nothing otherwise (the page already had it; sending another would undo twice).
    /// Chosen from the menu with the mouse, the page hasn't seen a ⌘Z, so it gets one, as in a browser,
    /// and the scene editor's own Undo (which saves the previous value back) runs.
    @objc func forwardUndo(_ sender: Any?) { forward(redo: false) }
    @objc func forwardRedo(_ sender: Any?) { forward(redo: true) }

    var lastUndoRoute = ""

    func forward(redo: Bool) {
        let native = { [weak self] in
            self?.lastUndoRoute = "native"
            NSApp.sendAction(redo ? Selector(("redo:")) : Selector(("undo:")), to: nil, from: nil)
        }
        guard let web = switcher?.webView, web.window?.isVisible == true else { return native() }
        let typed = NSApp.currentEvent.map { $0.type == .keyDown && $0.charactersIgnoringModifiers?.lowercased() == "z" } ?? false
        if typed {
            web.evaluateJavaScript(ShellBridge.focusEditableScript) { [weak self] r, _ in
                MainActor.assumeIsolated {
                    if (r as? Bool) == true { native() } else { self?.lastUndoRoute = "page-had-it" }
                }
            }
            return
        }
        web.evaluateJavaScript(ShellBridge.forwardUndoScript(redo: redo)) { [weak self] r, _ in
            MainActor.assumeIsolated {
                if (r as? String) == "page" { self?.lastUndoRoute = "page" } else { native() }
            }
        }
    }

    /// For scripts/e2e.ts: whether Check for Updates has a running updater behind it.
    var menuHasUpdater: Bool { updater != nil }
}
