import AppKit
import UniformTypeIdentifiers
import WebKit
import ViewSwitcherKit

/// Keeps the last mouse-down, so a drag the page asks for (ShellBridge) can start from it.
final class SwitcherWebView: WKWebView {
    private(set) var lastMouseDown: NSEvent?
    override func mouseDown(with event: NSEvent) {
        lastMouseDown = event
        super.mouseDown(with: event)
    }
}

/// Breaks the retain cycle WKUserContentController would make with the window controller.
final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        target?.userContentController(c, didReceive: m)
    }
}

/// The switcher's window (MAC-11, MAC-13, MAC-13a). Closing hides it; the server keeps serving.
@MainActor
final class SwitcherWindow: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    /// The traffic lights are centered in this row: the switcher's sidebar brand row and the editor's top bar (64 px).
    static let headerRow: CGFloat = 64
    /// From the window's left edge to the close button, as in the header's own padding (20 px).
    static let lightsLeft: CGFloat = 20
    /// The band at the top of the page kept clear of controls, for dragging (the page's top padding).
    static let dragStrip: CGFloat = 28

    let window: NSWindow
    let webView: SwitcherWebView
    private let base: URL
    private(set) var fullscreen = false
    /// The page's main-frame loads that failed and are being retried.
    private var retry: DispatchWorkItem?
    var events: [String] = []

    init(base: URL) {
        self.base = base
        let config = WKWebViewConfiguration()
        // The switcher tells the Mac window from the iPad app by its user agent (apps/web/src/lib/client-kind.ts).
        config.applicationNameForUserAgent = "ViewSwitcher-Mac/\(Env.version)"
        config.preferences.javaScriptCanOpenWindowsAutomatically = true // so window.open reaches the UI delegate, which refuses it
        config.preferences.isElementFullscreenEnabled = true
        config.mediaTypesRequiringUserActionForPlayback = []
        webView = SwitcherWebView(frame: .zero, configuration: config)
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false
        )
        super.init()

        let bg = Theme.side
        window.title = "ViewSwitcher"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = NSColor(srgbRed: bg.r, green: bg.g, blue: bg.b, alpha: 1)
        window.minSize = NSSize(width: 760, height: 520)
        window.isReleasedWhenClosed = false
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.delegate = self
        window.center()
        window.setFrameAutosaveName("ViewSwitcher")

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.setValue(false, forKey: "drawsBackground") // the window's graphite shows until the page paints
        #if DEBUG
        webView.isInspectable = true
        #endif
        config.userContentController.add(WeakMessageHandler(self), name: ShellBridge.handler)
        installShellScript()
        window.contentView = webView

        NotificationCenter.default.addObserver(forName: NSView.frameDidChangeNotification, object: nil, queue: .main) { [weak self] n in
            MainActor.assumeIsolated {
                guard let self, let v = n.object as? NSView, v.window === self.window, v === self.titlebarContainer else { return }
                self.layoutTrafficLights()
            }
        }
        layoutTrafficLights()
        load()
    }

    func load() { webView.load(URLRequest(url: base.appendingPathComponent(""))) }

    /// After Restart Server: stay on the page that was open (the editor, a stream) when it's on the server.
    func reloadCurrent() {
        if let url = webView.url, NavigationPolicy.mac(url, server: base, mainFrame: true) == .allow, url.scheme?.hasPrefix("http") == true {
            webView.load(URLRequest(url: url))
        } else {
            load()
        }
    }

    func show() {
        if !window.isVisible { window.makeKeyAndOrderFront(nil) }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        layoutTrafficLights()
    }

    // ------------------------------------------------------------ safe zones (MAC-13a)

    private var closeButton: NSButton? { window.standardWindowButton(.closeButton) }
    /// NSTitlebarContainerView: holds the title bar and its buttons.
    private var titlebarContainer: NSView? { closeButton?.superview?.superview }

    /// Center the traffic lights in the header row, 20 px in (like Electron's trafficLightPosition):
    /// grow the title bar container to the row's height and place the buttons in it. AppKit puts
    /// them back on some layout passes, so this runs again whenever the container's frame changes.
    func layoutTrafficLights() {
        guard !fullscreen, let close = closeButton,
              let mini = window.standardWindowButton(.miniaturizeButton),
              let zoom = window.standardWindowButton(.zoomButton),
              let container = titlebarContainer else { return }
        let h = Self.headerRow
        let frame = NSRect(x: 0, y: window.frame.height - h, width: window.frame.width, height: h)
        if container.frame != frame { container.frame = frame }
        let spacing = mini.frame.minX - close.frame.minX
        for (i, b) in [close, mini, zoom].enumerated() {
            let origin = NSPoint(x: Self.lightsLeft + CGFloat(i) * (spacing > 0 ? spacing : 20), y: ((h - b.frame.height) / 2).rounded())
            if b.frame.origin != origin { b.setFrameOrigin(origin) }
        }
        pushShellInfo()
    }

    var shellInfo: ShellInfo {
        let zoomMaxX = window.standardWindowButton(.zoomButton)?.frame.maxX ?? 72
        return ShellInfo.mac(lightsInset: Double(zoomMaxX + 14), headerRow: Double(Self.headerRow), dragStrip: Double(Self.dragStrip), fullscreen: fullscreen)
    }

    private var pushed: ShellInfo?
    private func pushShellInfo() {
        let info = shellInfo
        guard info != pushed else { return }
        pushed = info
        installShellScript()
        webView.evaluateJavaScript(ShellBridge.applyScript(info))
    }

    /// The page reads the shell's insets from the start, so a reload never flashes the browser layout.
    private func installShellScript() {
        let ucc = webView.configuration.userContentController
        ucc.removeAllUserScripts()
        ucc.addUserScript(WKUserScript(source: ShellBridge.userScript(pushed ?? shellInfo), injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    func windowWillEnterFullScreen(_ notification: Notification) {
        fullscreen = true
        pushShellInfo()
    }

    func windowDidExitFullScreen(_ notification: Notification) {
        fullscreen = false
        layoutTrafficLights()
        pushShellInfo()
        if hideAfterFullScreen {
            hideAfterFullScreen = false
            window.orderOut(nil)
        }
    }

    func windowDidResize(_ notification: Notification) { layoutTrafficLights() }

    /// The page asked to drag the window (a mouse-down on a [data-drag-region]) or zoom it (double-click).
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let body = message.body as? [String: Any], let t = body["t"] as? String else { return }
        events.append(t)
        switch t {
        case "drag":
            guard NSEvent.pressedMouseButtons & 1 == 1, let down = webView.lastMouseDown else { return }
            window.performDrag(with: down)
        case "zoom":
            // What a double-click on a title bar does (System Settings → Desktop & Dock).
            switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") {
            case "Minimize": window.performMiniaturize(nil)
            case "None": break
            default: window.performZoom(nil)
            }
        default: break
        }
    }

    // ------------------------------------------------------------ close hides

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if sender.styleMask.contains(.fullScreen) {
            // Hiding a full-screen window leaves an empty Space; leave full screen, then hide.
            hideAfterFullScreen = true
            sender.toggleFullScreen(nil)
            return false
        }
        sender.orderOut(nil)
        return false
    }

    private var hideAfterFullScreen = false

    // ------------------------------------------------------------ navigation (MAC-13)

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        let mainFrame = action.targetFrame?.isMainFrame ?? true
        switch NavigationPolicy.mac(url, server: base, mainFrame: mainFrame, newWindow: action.targetFrame == nil) {
        case .allow:
            decisionHandler(action.shouldPerformDownload ? .cancel : .allow)
        case .openInBrowser(let u):
            Outside.openInBrowser(u)
            decisionHandler(.cancel)
        case .deny:
            events.append("denied \(url.absoluteString)")
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void) {
        // Nothing downloads into the app.
        decisionHandler(response.canShowMIMEType ? .allow : .cancel)
    }

    /// window.open and target=_blank: never a second window; web pages go to the browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, case .openInBrowser(let u) = NavigationPolicy.mac(url, server: base, mainFrame: true, newWindow: true) {
            Outside.openInBrowser(u)
        } else {
            events.append("denied window \(action.request.url?.absoluteString ?? "")")
        }
        return nil
    }

    // The server can be starting (Dock click during launch) or restarting: keep retrying instead of
    // leaving an error page up. A cancelled load (a navigation replaced it) isn't a failure.
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        if e.domain == "WebKitErrorDomain" && e.code == 102 { return } // frame load interrupted (a policy cancel)
        scheduleRetry()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        if e.domain == "WebKitErrorDomain" && e.code == 102 { return }
        scheduleRetry()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { scheduleRetry() }

    func scheduleRetry() {
        retry?.cancel()
        let item = DispatchWorkItem { [weak self] in self?.load() }
        retry = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 1, execute: item)
    }

    // ------------------------------------------------------------ permissions (MAC-13)

    /// No camera or microphone for a scene, or anything it embeds. (Geolocation and notifications
    /// aren't offered to pages by a WKWebView this app doesn't grant them to; clipboard writes from a
    /// click, which the editor's Copy text uses, are WebKit's default.)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void) {
        events.append("denied media \(origin.host)")
        decisionHandler(.deny)
    }

    // ------------------------------------------------------------ alert, confirm, prompt, file inputs

    private func sheet(_ build: (NSAlert) -> Void, done: @escaping (NSApplication.ModalResponse, NSAlert) -> Void) {
        let a = NSAlert()
        build(a)
        if Env.e2e {
            events.append("dialog \(a.messageText)")
            return done(.alertSecondButtonReturn, a)
        }
        if window.isVisible { a.beginSheetModal(for: window) { done($0, a) } } else { done(a.runModal(), a) }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
        sheet({ $0.messageText = message; $0.addButton(withTitle: "OK") }) { _, _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
        sheet({ $0.messageText = message; $0.addButton(withTitle: "OK"); $0.addButton(withTitle: "Cancel") }) { r, _ in completionHandler(r == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (String?) -> Void) {
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        field.stringValue = defaultText ?? ""
        sheet({ $0.messageText = prompt; $0.accessoryView = field; $0.addButton(withTitle: "OK"); $0.addButton(withTitle: "Cancel") }) { r, _ in
            completionHandler(r == .alertFirstButtonReturn ? field.stringValue : nil)
        }
    }

    /// <input type=file> (adding assets to an org).
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        // The page's only file input is the assets page (accept="image/*,video/*,audio/*"), which
        // WKOpenPanelParameters doesn't pass on.
        panel.allowedContentTypes = [.image, .movie, .audio]
        panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
    }
}
