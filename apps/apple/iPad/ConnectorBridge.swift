import UIKit
import VisionKit
import WebKit
import ViewSwitcherKit

/// What the bundled connector page (viewswitcher://connector/) can ask the app for, as
/// `window.webkit.messageHandlers.vs.postMessage(...)` with a reply (PHONE-4, PHONE-5):
///  - `"scan"`: the camera reads the Mac's pairing QR code; replies with the pairing link, or null.
///  - `"browse"`: finds Macs running ViewSwitcher on this Wi-Fi by Bonjour; replies with [{ name, url }].
/// Only the connector may ask: never the switcher the Mac serves, a scene, or any other page.
final class ConnectorBridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var host: UIViewController?

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == NavigationPolicy.connectorScheme else {
            return replyHandler(nil, "Not available here")
        }
        switch message.body as? String {
        case "scan": scan { replyHandler($0?.absoluteString, nil) }
        case "browse": MacFinder.find { macs in replyHandler(macs.map { ["name": $0.name, "url": $0.url] }, nil) }
        default: replyHandler(nil, "Unknown request")
        }
    }

    // ------------------------------------------------------------ scan (PHONE-4)

    private func scan(_ done: @escaping @MainActor (URL?) -> Void) {
        guard let host else { return done(nil) }
        guard DataScannerViewController.isSupported else {
            let a = UIAlertController(title: "No camera", message: "Use Enter code instead.", preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in done(nil) })
            return host.present(a, animated: true)
        }
        let scanner = PairingScanner(done: done)
        let nav = UINavigationController(rootViewController: scanner)
        nav.modalPresentationStyle = .fullScreen
        host.present(nav, animated: true)
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
        try? scanner.startScanning()
    }

    func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
        for item in addedItems {
            guard case .barcode(let code) = item, let text = code.payloadStringValue else { continue }
            if let link = PairingLink.parse(text) { return finish(link) }
            note.text = "  Not a ViewSwitcher code  "
            note.isHidden = false
        }
    }

    func dataScanner(_ dataScanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
        note.text = "  Allow the camera in Settings  "
        note.isHidden = false
    }

    private func finish(_ link: URL?) {
        guard !finished else { return }
        finished = true
        scanner.stopScanning()
        dismiss(animated: true) { [done] in done(link) }
    }
}

/// Macs running ViewSwitcher on this Wi-Fi (PHONE-5). The Mac app announces "ViewSwitcher" as an
/// _http._tcp service while phones may connect (RemotesWindow.swift, MAC-23); a second Mac on the same
/// network gets a numbered name. Browses for a moment, resolves each to its .local name, and reports.
@MainActor
final class MacFinder: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
    struct Mac: Equatable { let name: String; let url: String }
    private static var running: [MacFinder] = []

    private let browser = NetServiceBrowser()
    private var services: [NetService] = []
    private var found: [Mac] = []
    private var done: ((([Mac]) -> Void))?

    static func find(seconds: TimeInterval = 2.5, _ done: @escaping ([Mac]) -> Void) {
        let f = MacFinder()
        running.append(f)
        f.done = done
        f.browser.delegate = f
        f.browser.searchForServices(ofType: "_http._tcp.", inDomain: "local.")
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { f.finish() }
    }

    private func finish() {
        browser.stop()
        services.forEach { $0.stop() }
        let report = done
        done = nil
        MacFinder.running.removeAll { $0 === self }
        report?(found)
    }

    nonisolated func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        MainActor.assumeIsolated {
            guard service.name.hasPrefix("ViewSwitcher") else { return }
            services.append(service)
            service.delegate = self
            service.resolve(withTimeout: 2)
        }
    }

    nonisolated func netServiceDidResolveAddress(_ sender: NetService) {
        MainActor.assumeIsolated {
            guard let host = sender.hostName?.lowercased(), sender.port > 0 else { return }
            let name = host.hasSuffix(".") ? String(host.dropLast()) : host
            let mac = Mac(name: MacFinder.displayName(name), url: "http://\(name):\(sender.port)")
            if !found.contains(mac) { found.append(mac) }
        }
    }

    /// "studio-mac.local" → "studio-mac": what the list shows.
    static func displayName(_ host: String) -> String {
        host.hasSuffix(".local") ? String(host.dropLast(6)) : host
    }
}
