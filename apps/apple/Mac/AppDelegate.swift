import AppKit
import ServiceManagement
import Sparkle
import ViewSwitcherKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    /// The server's whole life: starting, attached or owned, restarting after a crash, Quit.
    let supervisor = ServerSupervisor(base: Env.base) { try Env.launch() }
    var server: Server? { supervisor.server }
    private(set) var live: LiveState?
    private(set) var switcher: SwitcherWindow?
    private var liveClient: LiveClient?
    private var statusItem: NSStatusItem?
    private(set) var statusMenu = NSMenu()
    private lazy var menuBuilder = StatusMenuBuilder { [weak self] in self?.perform($0) }
    private var updater: SPUStandardUpdaterController?
    private var e2e: E2E?
    private(set) var remotes: RemotesWindow?
    private let announcer = Announcer()
    /// The banner over the switcher, kept here so a window opened later shows it too.
    private var notice: (text: String, until: Date?)?

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
        // Asked now, so the first banner (often the server stopping mid-show) isn't held behind the question.
        if !Env.e2e { Notifier.shared.requestPermission() }
        NSApp.mainMenu = MainMenu.build(app: self)
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.imagePosition = .imageLeading
        statusMenu.delegate = self
        item.menu = statusMenu
        statusItem = item
        supervisor.onChange = { [weak self] old, new in self?.serverChanged(from: old, to: new) }
        renderStatus()
        if let dir = Env.e2eDir { e2e = E2E(dir: dir, app: self) }
        startUpdater()

        Task {
            await supervisor.start()
            // At launch, a server that can't start ends the app.
            if case .failed(let why) = supervisor.state { return couldntStart(why, quit: true) }
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
        liveClient?.stop()
        guard let s = supervisor.quit() else { return .terminateNow }
        // While AppKit waits for the reply it runs the main run loop in its modal mode, where main-actor
        // tasks don't run: stop off the main actor, and reply through a run-loop block in common modes.
        Task.detached {
            await s.stop()
            CFRunLoopPerformBlock(CFRunLoopGetMain(), CFRunLoopMode.commonModes.rawValue) {
                MainActor.assumeIsolated { NSApp.reply(toApplicationShouldTerminate: true) }
            }
            CFRunLoopWakeUp(CFRunLoopGetMain())
        }
        return .terminateLater
    }

    // ------------------------------------------------------------ server

    /// What the person sees as the server comes and goes: the menu, a notification, the window's banner.
    func serverChanged(from old: ServerState, to new: ServerState) {
        switch new {
        case .owned, .attached:
            announceWifi()
            watchState()
            if case .restarting = old {
                Outside.notify("ViewSwitcher server restarted", "It stopped unexpectedly and is running again.", id: "server")
                showNotice("ViewSwitcher's server stopped unexpectedly and was restarted.", for: 8)
            } else {
                showNotice(nil)
            }
        case .restarting(let attempt, let code):
            down()
            if attempt == 1 { Outside.notify("ViewSwitcher server stopped", "It exited (\(code)). Restarting it now.", id: "server") }
            showNotice("ViewSwitcher's server stopped. Restarting it…")
        case .crashed(let code):
            down()
            Outside.notify("ViewSwitcher server keeps stopping", "It exited (\(code)) again, so it wasn't restarted. Choose Restart Server in the menu bar. Server log: \(Env.logFile.path)", id: "server")
            showNotice("ViewSwitcher's server keeps stopping. Choose Restart Server in the menu bar.")
        case .failed(let why):
            down()
            // A restart that found the port taken; at launch and from Restart Server, the caller says why.
            if case .restarting = old {
                Outside.notify("ViewSwitcher server stopped", why.localizedDescription, id: "server")
                showNotice("ViewSwitcher's server stopped and couldn't restart. Choose Restart Server in the menu bar.")
            }
        case .lost:
            down()
        case .starting, .quitting:
            break
        }
        renderStatus()
    }

    /// No server: nothing to announce or show.
    private func down() {
        announcer.set(false, port: 0)
        live = nil
    }

    private func couldntStart(_ why: ServerError, quit: Bool) {
        let portTaken: Bool = if case .portTaken = why { true } else { false }
        let text = why.localizedDescription + (portTaken ? "" : "\n\nServer log: \(Env.logFile.path)")
        Outside.alert(portTaken ? "Port in use" : "ViewSwitcher couldn't start", text, style: .critical)
        if quit { NSApp.terminate(nil) }
    }

    func restartServer() {
        // A second click while one starts would race it for the port; the supervisor ignores it.
        // (Starting is the supervisor's to refuse too; this also keeps the reload below from running.)
        guard supervisor.state.stopped else { return }
        Task {
            await supervisor.start()
            if case .failed(let why) = supervisor.state { return couldntStart(why, quit: false) }
            switcher?.reloadCurrent()
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
        // Attached to a server someone else started (bun run dev) and it went away: the supervisor
        // forgets it, so the menu offers Restart Server (which attaches again, or starts the bundled one).
        client.onClose = { [weak self] in
            Task { await self?.supervisor.checkAttached() }
        }
        liveClient = client
        client.start()
    }

    func showNotice(_ text: String?, for seconds: TimeInterval? = nil) {
        let until = seconds.map { Date().addingTimeInterval($0) }
        notice = text.map { ($0, until) }
        switcher?.showNotice(text, until: until)
    }

    // ------------------------------------------------------------ phones and tablets

    /// Bonjour follows the setting, for a server this app started (it was launched with the setting).
    func announceWifi() {
        announcer.set(Env.wifi && supervisor.state == .owned, port: Int(Env.port) ?? 7420)
    }

    func openRemotes() {
        if remotes == nil {
            let w = RemotesWindow()
            w.model.onEnabled = { [weak self] on, _ in
                Env.wifi = on
                self?.announceWifi()
                self?.buildStatusMenu()
            }
            remotes = w
        }
        remotes?.show()
    }

    /// The menu's checkbox: the server opens or closes its Wi-Fi listener now (closing it disconnects every device).
    func toggleWifi() {
        let on = !Env.wifi
        Task {
            do {
                let s = try await Env.api.setRemoteEnabled(on)
                Env.wifi = s.enabled
                announceWifi()
                buildStatusMenu()
                // A code made while Wi-Fi was off has no Wi-Fi link for the QR code: make a fresh one.
                if let w = remotes, w.window.isVisible {
                    if s.enabled { await w.model.newCode() } else { await w.model.refresh() }
                }
            } catch {
                Outside.alert("Couldn't change Wi-Fi connections", error.localizedDescription)
            }
        }
    }

    // ------------------------------------------------------------ window

    @objc func openWindow() {
        if switcher == nil {
            switcher = SwitcherWindow(base: Env.base)
            // A timed notice keeps its own end; one already past shows nothing.
            if let notice { switcher?.showNotice(notice.text, until: notice.until) }
        }
        switcher?.show()
    }

    /// The switcher's Edit with AI sheet: connect an agent, the agent on-air setting.
    func editWithAI() {
        openWindow()
        switcher?.openAgentSheet()
    }

    // ------------------------------------------------------------ menu bar

    var status: MenuStatus { MenuStatus(supervisor.state.running ? live : nil) }

    var menuContext: StatusMenu.Context {
        StatusMenu.Context(
            status: status,
            server: supervisor.state,
            obsConnected: live?.obs.connected == true,
            wifi: Env.wifi,
            updater: updater != nil,
            openAtLogin: SMAppService.mainApp.status == .enabled
        )
    }

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

    func buildStatusMenu() {
        menuBuilder.fill(statusMenu, with: StatusMenu.items(menuContext))
    }

    private func perform(_ action: StatusMenu.Action) {
        switch action {
        case .openWindow: openWindow()
        case .editWithAI: editWithAI()
        case .openInBrowser: openInBrowser()
        case .openLibrary: openLibrary()
        case .setUpObs: setUpObs()
        case .toggleWifi: toggleWifi()
        case .openRemotes: openRemotes()
        case .restartServer: restartServer()
        case .checkForUpdates: checkForUpdates()
        case .toggleLogin: toggleLogin()
        case .showLog: showLog()
        case .quit: quit()
        }
    }

    func openInBrowser() { Outside.openInBrowser(Env.base.appendingPathComponent("")) }

    func openLibrary() {
        Task {
            do {
                // One of the few answers with an absolute path in it, given only to this Mac itself.
                let info = try await Env.api.info()
                Outside.openFolder(URL(fileURLWithPath: info.library, isDirectory: true))
            } catch {
                Outside.alert("Couldn't open the library folder", error.localizedDescription)
            }
        }
    }

    /// Setup never switches OBS's scene while it's live (the server checks too), but say so before doing anything.
    func setUpObs() {
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
                let r = try await Env.api.setUpObs()
                let next = r.missing.isEmpty ? "" : " Add \(r.missing.joined(separator: ", ")) to the ViewSwitcher scene in OBS, then set up again."
                Outside.notify("OBS is set up", (r.switched ? "The ViewSwitcher scene is ready." : "The ViewSwitcher scene is ready; OBS stayed on its current scene.") + next)
            } catch {
                Outside.alert("Couldn't set up OBS", error.localizedDescription)
            }
        }
    }

    /// Off by default (Decisions): a server starting at every login surprises someone who streams once a week.
    func toggleLogin() {
        guard !Env.e2e else { return }
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() }
        } catch {
            Outside.alert("Couldn't change Open at Login", error.localizedDescription)
        }
        buildStatusMenu()
    }

    func showLog() {
        // A server this app attached to (bun run dev, another build's) writes its own log, not this
        // build's: show the logs folder, where the installed app's and a Debug build's are, rather than a file it doesn't use.
        if supervisor.state == .attached {
            let folder = Env.logFile.deletingLastPathComponent()
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            Outside.openFolder(folder)
            return
        }
        capLog(Env.logFile)
        if !FileManager.default.fileExists(atPath: Env.logFile.path) { FileManager.default.createFile(atPath: Env.logFile.path, contents: nil) }
        Outside.openFolder(Env.logFile)
    }

    @objc func quit() { NSApp.terminate(nil) }

    // ------------------------------------------------------------ updates

    /// Sparkle against the appcast on GitHub Releases. Not in a build without a public key (Debug)
    /// or with VIEWSWITCHER_UPDATES=0 (scripts/e2e.ts).
    func startUpdater() {
        let key = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String ?? ""
        guard Env.updatesEnabled, !Env.e2e, key.count > 20, (try? Env.launch())?.executable.lastPathComponent == "viewswitcher-server" else { return }
        updater = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
    }

    @objc func checkForUpdates() { updater?.checkForUpdates(nil) }

    /// Check for Updates… is enabled only with a running updater (not in Debug, with updates off, or without a key).
    @objc func validateMenuItem(_ item: NSMenuItem) -> Bool {
        item.action == #selector(checkForUpdates) ? updater != nil : true
    }

    // ------------------------------------------------------------ app menu actions (MainMenu.swift builds the menus)

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
