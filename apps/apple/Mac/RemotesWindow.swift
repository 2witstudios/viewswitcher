import AppKit
import SwiftUI
import ViewSwitcherKit

/// Bonjour: "ViewSwitcher" as an http service on the Wi-Fi while phones may connect, so it
/// shows up next to <mac>.local in network browsers.
@MainActor
final class Announcer {
    private var service: NetService?

    func set(_ on: Bool, port: Int) {
        if on, service == nil {
            let s = NetService(domain: "local.", type: "_http._tcp.", name: "ViewSwitcher", port: Int32(port))
            s.setTXTRecord(NetService.data(fromTXTRecord: ["path": Data("/".utf8)]))
            s.publish()
            service = s
        } else if !on, let s = service {
            s.stop()
            service = nil
        }
    }
}

/// What the Phones and Tablets window shows.
@MainActor
final class RemotesModel: ObservableObject {
    @Published var status: RemoteStatus?
    /// The code this window asked for (the server never sends it again), and its link for the QR code.
    @Published var code: String?
    @Published var pairUrl: String?
    @Published var error: String?
    @Published var now = Date()
    @Published var busy = false
    /// Tells the app the setting changed (menu checkmark, Bonjour, UserDefaults).
    var onEnabled: (Bool, Int) -> Void = { _, _ in }

    private var timer: Timer?
    /// Bumped by every change this window makes; a status read that started before one is dropped,
    /// so an old snapshot can't clear a new code or flip the setting back.
    private var generation = 0

    var codeOpen: Bool {
        guard code != nil, let open = status?.code else { return false }
        return open.expiresAt / 1000 > now.timeIntervalSince1970
    }

    func start() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        Task { await refresh(newCodeIfNone: true) }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private var ticks = 0
    private func tick() {
        now = Date()
        ticks += 1
        if ticks % 2 == 0 { Task { await refresh() } }
    }

    func refresh(newCodeIfNone: Bool = false) async {
        do {
            let started = generation
            let s = try await Env.api.remoteStatus()
            guard started == generation else { return }
            apply(s)
            if newCodeIfNone, !codeOpen { await newCode() }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func apply(_ s: RemoteStatus) {
        let was = status?.enabled
        status = s
        error = nil
        if s.code == nil { code = nil; pairUrl = nil } // used, expired or used up by wrong guesses
        if was != s.enabled { onEnabled(s.enabled, s.port) }
    }

    func newCode() async {
        generation += 1
        do {
            let s = try await Env.api.newPairingCode()
            code = s.code?.code
            pairUrl = s.pairUrl
            apply(s)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func setEnabled(_ on: Bool) async {
        busy = true
        generation += 1
        defer { busy = false }
        do {
            apply(try await Env.api.setRemoteEnabled(on))
            // The QR code points at a Wi-Fi address: a fresh code so it carries one (or none, once off).
            await newCode()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func remove(_ id: String) async {
        generation += 1
        do { apply(try await Env.api.removeDevice(id)) } catch { self.error = error.localizedDescription }
    }
}

struct RemotesView: View {
    @ObservedObject var model: RemotesModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Toggle(isOn: Binding(get: { model.status?.enabled ?? false }, set: { on in Task { await model.setEnabled(on) } })) {
                    Text("Let phones and tablets on this Wi-Fi connect").font(.headline)
                }
                .toggleStyle(.switch)
                .disabled(model.status == nil || model.busy)
                .accessibilityIdentifier("wifi-toggle")
                Text(RemoteText.help).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if let error = model.error {
                Text(error).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
            }
            Divider()
            pairing
            Divider()
            devices
        }
        .padding(24)
        .frame(width: 560, alignment: .topLeading)
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder var pairing: some View {
        Text("Pair a phone or tablet").font(.headline)
        HStack(alignment: .top, spacing: 20) {
            if model.codeOpen, let link = model.pairUrl, model.status?.enabled == true, let qr = qrCode(link) {
                Image(decorative: qr, scale: 1)
                    .interpolation(.none)
                    .resizable()
                    .frame(width: 180, height: 180)
                    .padding(10)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .accessibilityLabel("QR code for pairing")
            }
            VStack(alignment: .leading, spacing: 8) {
                if model.codeOpen, let code = model.code, let expires = model.status?.code?.expiresAt {
                    if model.status?.enabled == true {
                        Text("Scan with the phone's camera, or open the address and enter the code.").foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    } else {
                        Text("Turn on Wi-Fi connections for a QR code, or enter this code on a device already connected.").foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    Text(RemoteText.code(code)).font(.system(size: 34, weight: .semibold, design: .monospaced)).textSelection(.enabled)
                    Text(RemoteText.expiry(expires, now: model.now)).foregroundStyle(.secondary).monospacedDigit()
                } else if model.status?.codeGuessed == true {
                    Text(RemoteText.guessed).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                } else {
                    Text("The code was used or has expired.").foregroundStyle(.secondary)
                }
                if model.status?.enabled == true {
                    ForEach(model.status?.urls.prefix(2).map { $0 } ?? [], id: \.self) { url in
                        Text(url).font(.callout.monospaced()).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Button("New Code") { Task { await model.newCode() } }.padding(.top, 4)
            }
        }
    }

    @ViewBuilder var devices: some View {
        Text("Paired devices").font(.headline)
        let list = model.status?.devices ?? []
        if list.isEmpty {
            Text("No devices paired yet.").foregroundStyle(.secondary)
        } else {
            VStack(spacing: 0) {
                ForEach(list) { d in
                    HStack {
                        Circle().fill(d.connected > 0 ? Color.green : Color.secondary.opacity(0.4)).frame(width: 8, height: 8)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(d.name)
                            Text(RemoteText.lastSeen(d, now: model.now)).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Remove") { Task { await model.remove(d.id) } }
                    }
                    .padding(.vertical, 8)
                    if d.id != list.last?.id { Divider() }
                }
            }
        }
    }
}

/// Phones and Tablets…: the Wi-Fi setting, a code with its QR code, and the paired devices.
@MainActor
final class RemotesWindow: NSObject, NSWindowDelegate {
    let window: NSWindow
    let model = RemotesModel()

    override init() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 560), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        super.init()
        window.title = "Phones and Tablets"
        window.isReleasedWhenClosed = false
        // A hosting controller sizes the window to the content (QR code or not, more devices).
        window.contentViewController = NSHostingController(rootView: RemotesView(model: model))
        window.delegate = self
        window.center()
    }

    func show() {
        model.start()
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    func windowWillClose(_ notification: Notification) { model.stop() }
}
