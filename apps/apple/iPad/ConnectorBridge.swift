import AVFoundation
import UIKit
import VisionKit
import WebKit
import ViewSwitcherKit

/// What the bundled connector page (viewswitcher://connector/) can ask the app for, as
/// `window.webkit.messageHandlers.vs.postMessage(...)` with a reply:
///  - `"scan"`: the camera reads the Mac's pairing QR code; replies with { link, local } (local: the same
///    pairing on the Mac's .local name, when the code names it), or null.
///  - `"browse"`: finds Macs running ViewSwitcher on this Wi-Fi by Bonjour; replies with
///    { macs: [{ name, url }], denied } (denied: Local Network access is off for the app).
/// Only the connector may ask: never the switcher the Mac serves, a scene, or any other page.
final class ConnectorBridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var host: UIViewController?

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor (Any?, String?) -> Void) {
        guard NavigationPolicy.connectorBridgeAllowed(isMainFrame: message.frameInfo.isMainFrame, scheme: message.frameInfo.securityOrigin.protocol) else {
            return replyHandler(nil, "Not available here")
        }
        switch message.body as? String {
        case "scan": scan { link in
            guard let link else { return replyHandler(nil, nil) }
            replyHandler(["link": link.absoluteString, "local": PairingLink.localAlternative(link)?.absoluteString as Any], nil)
        }
        case "browse": MacFinder.find { macs, denied in replyHandler(["macs": macs.map { ["name": $0.name, "url": $0.url] }, "denied": denied], nil) }
        default: replyHandler(nil, "Unknown request")
        }
    }

    // ------------------------------------------------------------ scan

    private func scan(_ done: @escaping @MainActor (URL?) -> Void) {
        // Already presenting (the scanner or the camera alert): UIKit would refuse a second one and never reply.
        guard let host, host.presentedViewController == nil else { return done(nil) }
        guard DataScannerViewController.isSupported else { return tell(host, "No camera", "Use Enter code instead.", done) }
        // Ask for the camera first: with access denied the scanner would only show black.
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: present(on: host, done)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                Task { @MainActor [weak self] in
                    guard let self, let host = self.host else { return done(nil) }
                    granted ? self.present(on: host, done) : self.cameraOff(host, done)
                }
            }
        default: cameraOff(host, done)
        }
    }

    private func present(on host: UIViewController, _ done: @escaping @MainActor (URL?) -> Void) {
        let nav = UINavigationController(rootViewController: PairingScanner(done: done))
        nav.modalPresentationStyle = .fullScreen
        host.present(nav, animated: true)
    }

    private func cameraOff(_ host: UIViewController, _ done: @escaping @MainActor (URL?) -> Void) {
        let a = UIAlertController(title: "Camera is off", message: "Allow the camera for ViewSwitcher in Settings, or use Enter code.", preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Settings", style: .default) { _ in
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            done(nil)
        })
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in done(nil) })
        host.present(a, animated: true)
    }

    private func tell(_ host: UIViewController, _ title: String, _ message: String, _ done: @escaping @MainActor (URL?) -> Void) {
        let a = UIAlertController(title: title, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in done(nil) })
        host.present(a, animated: true)
    }
}

/// The camera, full screen, until it sees a ViewSwitcher pairing code or the user cancels.
private final class PairingScanner: UIViewController, DataScannerViewControllerDelegate {
    private let done: @MainActor (URL?) -> Void
    private var finished = false
    private let scanner = DataScannerViewController(
        recognizedDataTypes: [.barcode(symbologies: [.qr])],
        qualityLevel: .balanced, recognizesMultipleItems: false,
        isHighFrameRateTrackingEnabled: false, isHighlightingEnabled: true)
    private let note = UILabel()

    init(done: @escaping @MainActor (URL?) -> Void) {
        self.done = done
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Scan the code on your Mac"
        view.backgroundColor = .black
        navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .cancel, primaryAction: UIAction { [weak self] _ in self?.finish(nil) })
        addChild(scanner)
        scanner.view.frame = view.bounds
        scanner.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(scanner.view)
        scanner.didMove(toParent: self)
        scanner.delegate = self
        note.textColor = .white
        note.font = .preferredFont(forTextStyle: .headline)
        note.textAlignment = .center
        note.backgroundColor = UIColor.black.withAlphaComponent(0.6)
        note.layer.cornerRadius = 10
        note.clipsToBounds = true
        note.isHidden = true
        note.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(note)
        NSLayoutConstraint.activate([
            note.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            note.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
            note.heightAnchor.constraint(equalToConstant: 44),
            note.widthAnchor.constraint(greaterThanOrEqualToConstant: 240),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        do { try scanner.startScanning() } catch { show("Camera unavailable: use Enter code") }
    }

    private func show(_ text: String) {
        note.text = "  \(text)  "
        note.isHidden = false
    }

    func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
        for item in addedItems {
            guard case .barcode(let code) = item, let text = code.payloadStringValue else { continue }
            if let link = PairingLink.parse(text) { return finish(link) }
            show("Not a ViewSwitcher code")
        }
    }

    func dataScanner(_ dataScanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
        show("Allow the camera in Settings")
    }

    private func finish(_ link: URL?) {
        guard !finished else { return }
        finished = true
        scanner.stopScanning()
        dismiss(animated: true) { [done] in done(link) }
    }
}

/// Macs running ViewSwitcher on this Wi-Fi. The Mac app announces "ViewSwitcher" as an
/// _http._tcp service while phones may connect (RemotesWindow.swift); a second Mac on the same
/// network gets a numbered name. Browses until the first Mac answers (then a moment more for others), or
/// a long limit: the first search on a fresh install waits behind iOS's Local Network prompt, and no
/// results arrive while it's up. Only a .local name is accepted (PairingLink.bonjourMac).
@MainActor
final class MacFinder: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
    struct Mac: Equatable { let name: String; let url: String }
    private static var running: [MacFinder] = []

    private var browser = NetServiceBrowser()
    private var services: [NetService] = []
    private var found: [Mac] = []
    private var denied = false
    /// When the first policy refusal came: the retries stop after `promptTime` (long enough to answer the prompt).
    private var refusedAt: Date?
    private let promptTime: TimeInterval = 8
    private var settling = false
    private var done: (([Mac], Bool) -> Void)?

    /// `limit`: the longest it looks with nothing found; `settle`: how long it keeps looking after the first Mac.
    static func find(limit: TimeInterval = 30, settle: TimeInterval = 1.2, _ done: @escaping ([Mac], Bool) -> Void) {
        let f = MacFinder()
        running.append(f)
        f.done = done
        f.settle = settle
        f.search()
        DispatchQueue.main.asyncAfter(deadline: .now() + limit) { f.finish() }
    }

    private func search() {
        browser.stop()
        browser = NetServiceBrowser()
        browser.delegate = self
        browser.searchForServices(ofType: "_http._tcp.", inDomain: "local.")
    }
    private var settle: TimeInterval = 1.2

    private func finish() {
        guard let report = done else { return }
        done = nil
        browser.stop()
        services.forEach { $0.stop() }
        MacFinder.running.removeAll { $0 === self }
        report(found, denied && found.isEmpty)
    }

    nonisolated func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        MainActor.assumeIsolated {
            guard service.name.hasPrefix("ViewSwitcher") else { return }
            services.append(service)
            service.delegate = self
            service.resolve(withTimeout: 5)
        }
    }

    /// Refused by policy (kDNSServiceErr_PolicyDenied): Local Network access is off, or its first-run prompt is
    /// still up (the app is inactive then). Search again until the prompt is answered, then for a few seconds
    /// more, and report `denied` if it's still refused (or at the overall limit). Any other failure (Wi-Fi off, the daemon) ends the search as "no Mac", not a trip to Settings.
    nonisolated func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
        MainActor.assumeIsolated {
            guard errorDict[NetService.errorCode]?.intValue == -65570 else { return finish() }
            denied = true
            // iOS's prompt makes the app inactive: the window starts only once it's answered and we're active.
            guard UIApplication.shared.applicationState == .active else { refusedAt = nil; return retry() }
            let since = refusedAt ?? Date()
            refusedAt = since
            if Date().timeIntervalSince(since) >= promptTime { return finish() }
            retry()
        }
    }

    private func retry() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self, self.done != nil else { return }
            self.search()
        }
    }

    /// A search actually started (access allowed): only now is an earlier refusal out of date. Clearing it on
    /// every retry instead would lose the refusal when the limit lands between a retry and its answer.
    nonisolated func netServiceBrowserWillSearch(_ browser: NetServiceBrowser) {
        MainActor.assumeIsolated { denied = false }
    }

    nonisolated func netServiceDidResolveAddress(_ sender: NetService) {
        MainActor.assumeIsolated {
            guard let host = sender.hostName, let url = PairingLink.bonjourMac(host: host, port: sender.port) else { return }
            let name = URL(string: url)?.host ?? url
            let mac = Mac(name: MacFinder.displayName(name), url: url)
            if !found.contains(mac) { found.append(mac) }
            if !settling {
                settling = true
                DispatchQueue.main.asyncAfter(deadline: .now() + settle) { [weak self] in self?.finish() }
            }
        }
    }

    /// "studio-mac.local" → "studio-mac": what the list shows.
    static func displayName(_ host: String) -> String {
        host.hasSuffix(".local") ? String(host.dropLast(6)) : host
    }
}
