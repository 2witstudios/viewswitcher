import UIKit
import WebKit
import ViewSwitcherKit

/// Serves the bundled connector (Connector/index.html) at viewswitcher://connector/, and the offline
/// demo (Connector/demo/, MAC-18) at viewswitcher://connector/demo/. The switcher sends the app back
/// to the connector when the server has been gone a while (apps/web/src/lib/live.ts).
final class ConnectorScheme: NSObject, WKURLSchemeHandler {
    let root = Bundle.main.resourceURL!.appendingPathComponent("Connector")

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.host?.lowercased() == "connector" else {
            return task.didFailWithError(URLError(.unsupportedURL))
        }
        // (URL.path drops a trailing slash, so a folder is recognised on disk: demo/ → demo/index.html.)
        var file = root.appendingPathComponent(String(url.path.drop(while: { $0 == "/" }))).standardizedFileURL
        var isFolder: ObjCBool = false
        if FileManager.default.fileExists(atPath: file.path, isDirectory: &isFolder), isFolder.boolValue {
            // Only as demo/: without the slash its relative URLs (show.js, media/…) would resolve one level up.
            guard url.hasDirectoryPath || url.path.isEmpty || url.path == "/" else {
                return task.didFailWithError(URLError(.fileDoesNotExist))
            }
            file = file.appendingPathComponent("index.html")
        }
        guard file.path.hasPrefix(root.standardizedFileURL.path + "/"), let data = try? Data(contentsOf: file) else {
            return task.didFailWithError(URLError(.fileDoesNotExist))
        }
        let type = switch file.pathExtension {
        case "html": "text/html"
        case "svg": "image/svg+xml"
        case "js": "text/javascript"
        case "css": "text/css"
        case "webp": "image/webp"
        case "jpg", "jpeg": "image/jpeg"
        case "png": "image/png"
        default: "application/octet-stream"
        }
        task.didReceive(URLResponse(url: url, mimeType: type, expectedContentLength: data.count, textEncodingName: type.hasPrefix("text/") ? "utf-8" : nil))
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// Serves capacitor://localhost/migrate once, on the first launch after the Capacitor build: a page on
/// that old origin reads the network address it saved and hands it to the connector (#network=…).
/// Same bundle id, same web data store, so the old origin's localStorage is still there.
final class CapacitorMigration: NSObject, WKURLSchemeHandler {
    static let url = URL(string: "capacitor://localhost/migrate")!
    static let doneKey = "migratedCapacitorNetwork"

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let html = """
        <!doctype html><meta charset="utf-8"><script>
        let v = ""; try { v = localStorage.getItem("viewswitcher.network") || ""; } catch {}
        location.replace("\(NavigationPolicy.connectorScheme)://connector/#network=" + encodeURIComponent(v));
        </script>
        """
        let data = Data(html.utf8)
        task.didReceive(URLResponse(url: task.request.url ?? Self.url, mimeType: "text/html", expectedContentLength: data.count, textEncodingName: "utf-8"))
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// The app's one screen, on iPad and iPhone (PHONE-1): a web view from edge to edge. The page keeps its controls inside the safe
/// area itself (viewport-fit=cover and env(safe-area-inset-*) in apps/web/src/styles.css, MAC-13a),
/// so its own background reaches every edge in each orientation, Split View and Stage Manager.
final class SwitcherViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    static let connector = URL(string: "\(NavigationPolicy.connectorScheme)://connector/")!
    static let demo = URL(string: "\(NavigationPolicy.connectorScheme)://connector/demo/")!
    private var webView: WKWebView!
    /// The connector's scan and Bonjour requests (PHONE-4, PHONE-5).
    private let bridge = ConnectorBridge()

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    override func loadView() {
        let config = WKWebViewConfiguration()
        // The switcher treats a page as the iPad app by this (apps/web/src/lib/client-kind.ts).
        config.applicationNameForUserAgent = "ViewSwitcher-iPad/\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0")"
        config.setURLSchemeHandler(ConnectorScheme(), forURLScheme: NavigationPolicy.connectorScheme)
        config.setURLSchemeHandler(CapacitorMigration(), forURLScheme: "capacitor")
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.addUserScript(WKUserScript(source: ShellBridge.userScript(ShellInfo(kind: .ipad)), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        bridge.host = self
        config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "vs")
        #if DEBUG
        // The simulator shares the Mac's ports, so the connector's USB-C probe (127.0.0.1:7420) would
        // find the Mac's own switcher. VIEWSWITCHER_PROBE points it somewhere else (tests, screenshots).
        if let probe = ProcessInfo.processInfo.environment["VIEWSWITCHER_PROBE"],
           let json = try? JSONEncoder().encode(probe), let literal = String(data: json, encoding: .utf8) {
            config.userContentController.addUserScript(WKUserScript(source: "window.VIEWSWITCHER_USB = \(literal);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        #endif
        let web = WKWebView(frame: .zero, configuration: config)
        let bg = Theme.background
        web.backgroundColor = UIColor(red: bg.r, green: bg.g, blue: bg.b, alpha: 1)
        web.isOpaque = false
        web.scrollView.backgroundColor = web.backgroundColor
        // The page handles the safe area (env()), not the scroll view: no automatic insets.
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.bounces = false
        web.navigationDelegate = self
        web.uiDelegate = self
        #if DEBUG
        web.isInspectable = true
        #endif
        webView = web
        view = web
        #if DEBUG
        // Screenshots only (scripts/ipad-shots.sh): VIEWSWITCHER_WEB_WIDTH lays the web view out at a
        // Split View width against the window's left edge, as the left app of a split would be.
        if let w = ProcessInfo.processInfo.environment["VIEWSWITCHER_WEB_WIDTH"].flatMap(Double.init) {
            let container = UIView()
            container.backgroundColor = .black
            web.translatesAutoresizingMaskIntoConstraints = false
            container.addSubview(web)
            NSLayoutConstraint.activate([
                web.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                web.topAnchor.constraint(equalTo: container.topAnchor),
                web.bottomAnchor.constraint(equalTo: container.bottomAnchor),
                web.widthAnchor.constraint(equalToConstant: w),
            ])
            view = container
        }
        #endif
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        #if DEBUG
        // Tests and screenshots: VIEWSWITCHER_RESET=1 starts as a first launch (no saved address, no Mac
        // connected before), so the connector opens the demo again.
        if ProcessInfo.processInfo.environment["VIEWSWITCHER_RESET"] == "1" {
            UserDefaults.standard.set(true, forKey: CapacitorMigration.doneKey)
            WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) { [weak self] in
                self?.webView.load(URLRequest(url: Self.start))
            }
            return
        }
        #endif
        webView.load(URLRequest(url: Self.start))
    }

    /// The connector, which opens the demo by itself on a first launch with no Mac (MAC-18). In a Debug
    /// build, VIEWSWITCHER_SERVER (e.g. http://127.0.0.1:7445) opens that server directly instead, for
    /// the simulator, which shares the Mac's ports and would otherwise find whatever switcher runs on the
    /// Mac's 7420; VIEWSWITCHER_START=demo opens the demo.
    static var start: URL {
        #if DEBUG
        let env = ProcessInfo.processInfo.environment
        if let s = env["VIEWSWITCHER_SERVER"], let u = URL(string: s) { return u }
        if env["VIEWSWITCHER_START"] == "demo" { return demo }
        #endif
        if !UserDefaults.standard.bool(forKey: CapacitorMigration.doneKey) {
            UserDefaults.standard.set(true, forKey: CapacitorMigration.doneKey)
            return CapacitorMigration.url
        }
        return connector
    }

    // ------------------------------------------------------------ navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        switch NavigationPolicy.iPad(url, mainFrame: action.targetFrame?.isMainFrame ?? true, newWindow: action.targetFrame == nil) {
        case .allow: decisionHandler(.allow)
        case .openInBrowser(let u):
            UIApplication.shared.open(u)
            decisionHandler(.cancel)
        case .deny: decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, case .openInBrowser(let u) = NavigationPolicy.iPad(url, mainFrame: true, newWindow: true) {
            UIApplication.shared.open(u)
        }
        return nil
    }

    /// The server went away mid-load (the Mac slept, the cable came out): back to the connector.
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let e = error as NSError
        if e.code == NSURLErrorCancelled || (e.domain == "WebKitErrorDomain" && e.code == 102) { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            self?.webView.load(URLRequest(url: Self.connector))
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    // ------------------------------------------------------------ permissions and dialogs

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void) {
        decisionHandler(.deny)
    }

    func webView(_ webView: WKWebView, requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void) {
        decisionHandler(.deny)
    }

    private func present(_ alert: UIAlertController) {
        var top: UIViewController = self
        while let p = top.presentedViewController { top = p }
        top.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (String?) -> Void) {
        let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        a.addTextField { $0.text = defaultText }
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(a.textFields?.first?.text) })
        present(a)
    }
}
