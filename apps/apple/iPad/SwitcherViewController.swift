import UIKit
import WebKit
import ViewSwitcherKit

/// Serves the bundled connector (Connector/index.html) at viewswitcher://connector/. The switcher
/// sends the app back there when the server has been gone a while (apps/web/src/lib/live.ts).
final class ConnectorScheme: NSObject, WKURLSchemeHandler {
    let root = Bundle.main.resourceURL!.appendingPathComponent("Connector")

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.host?.lowercased() == "connector" else {
            return task.didFailWithError(URLError(.unsupportedURL))
        }
        let name = url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())
        let file = root.appendingPathComponent(name).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path + "/"), let data = try? Data(contentsOf: file) else {
            return task.didFailWithError(URLError(.fileDoesNotExist))
        }
        let type = switch file.pathExtension {
        case "html": "text/html"
        case "svg": "image/svg+xml"
        default: "application/octet-stream"
        }
        task.didReceive(URLResponse(url: url, mimeType: type, expectedContentLength: data.count, textEncodingName: type == "text/html" ? "utf-8" : nil))
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// The iPad's one screen: a web view from edge to edge. The page keeps its controls inside the safe
/// area itself (viewport-fit=cover and env(safe-area-inset-*) in apps/web/src/styles.css, MAC-13a),
/// so its own background reaches every edge in each orientation, Split View and Stage Manager.
final class SwitcherViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    static let connector = URL(string: "\(NavigationPolicy.connectorScheme)://connector/")!
    private var webView: WKWebView!

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    override func loadView() {
        let config = WKWebViewConfiguration()
        // The switcher treats a page as the iPad app by this (apps/web/src/lib/client-kind.ts).
        config.applicationNameForUserAgent = "ViewSwitcher-iPad/\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0")"
        config.setURLSchemeHandler(ConnectorScheme(), forURLScheme: NavigationPolicy.connectorScheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.addUserScript(WKUserScript(source: ShellBridge.userScript(ShellInfo(kind: .ipad)), injectionTime: .atDocumentStart, forMainFrameOnly: true))
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
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.load(URLRequest(url: Self.connector))
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
