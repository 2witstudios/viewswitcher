import Foundation
import Network

/// The iPad end of the USB-C link to the Daisy server.
///
/// iOS gives apps no network over the cable. The only path is usbmuxd, and it only connects
/// Mac → iPad, so the Daisy server keeps a few idle "tunnel" connections open to this app on
/// 127.0.0.1:7421 (see apps/server/src/usb-bridge.ts). The WebView talks to 127.0.0.1:7420 here;
/// each of its connections is paired with one idle tunnel and piped through to the Mac.
final class UsbTunnel {
    static let shared = UsbTunnel()

    static let localPort: NWEndpoint.Port = 7420  // what the WebView connects to
    static let tunnelPort: NWEndpoint.Port = 7421 // what the Mac connects to over usbmuxd
    private static let waitForTunnel: TimeInterval = 4

    private let queue = DispatchQueue(label: "daisy.usbtunnel")
    private var localListener: NWListener?
    private var tunnelListener: NWListener?
    private var idle: [Link] = []          // tunnels from the Mac, waiting for a request
    private var waiting: [NWConnection] = [] // WebView connections waiting for a tunnel

    /// One tunnel from the Mac. Bytes it sends before it is paired are buffered.
    private final class Link {
        let tunnel: NWConnection
        var local: NWConnection?
        var early: [Data] = []
        var closed = false
        init(_ tunnel: NWConnection) { self.tunnel = tunnel }

        func close() {
            if closed { return }
            closed = true
            tunnel.cancel()
            local?.cancel()
        }
    }

    func start() {
        queue.async { self.startListeners() }
    }

    func stop() {
        queue.async {
            self.localListener?.cancel()
            self.tunnelListener?.cancel()
            self.localListener = nil
            self.tunnelListener = nil
            self.idle.forEach { $0.close() }
            self.idle.removeAll()
            self.waiting.forEach { $0.cancel() }
            self.waiting.removeAll()
        }
    }

    /// Restart after the app comes back to the foreground (iOS may have torn the sockets down).
    func restart() {
        stop()
        queue.asyncAfter(deadline: .now() + 0.2) { self.startListeners() }
    }

    // MARK: - listeners

    private static func parameters(port: NWEndpoint.Port) -> NWParameters {
        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true
        let params = NWParameters(tls: nil, tcp: tcp)
        params.allowLocalEndpointReuse = true
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: port)
        return params
    }

    private func startListeners() {
        guard localListener == nil, tunnelListener == nil else { return }
        do {
            let tunnels = try NWListener(using: Self.parameters(port: Self.tunnelPort))
            tunnels.newConnectionHandler = { [weak self] conn in self?.acceptTunnel(conn) }
            tunnels.stateUpdateHandler = { [weak self] state in self?.listenerState("tunnel", state) }
            tunnels.start(queue: queue)
            tunnelListener = tunnels

            let local = try NWListener(using: Self.parameters(port: Self.localPort))
            local.newConnectionHandler = { [weak self] conn in self?.acceptLocal(conn) }
            local.stateUpdateHandler = { [weak self] state in self?.listenerState("local", state) }
            local.start(queue: queue)
            localListener = local
        } catch {
            NSLog("[usb] couldn't start listeners: \(error)")
            queue.asyncAfter(deadline: .now() + 1) { self.stop(); self.start() }
        }
    }

    private func listenerState(_ name: String, _ state: NWListener.State) {
        if case .failed(let error) = state {
            NSLog("[usb] \(name) listener failed: \(error); restarting")
            restart()
        }
    }

    // MARK: - pairing

    private func acceptTunnel(_ conn: NWConnection) {
        let link = Link(conn)
        conn.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled: self?.drop(link)
            default: break
            }
        }
        conn.start(queue: queue)
        pump(from: conn, link: link) { [weak link] data in
            guard let link else { return }
            if let local = link.local { local.send(content: data, completion: .contentProcessed { _ in }) }
            else { link.early.append(data) }
        }
        if let local = waiting.first {
            waiting.removeFirst()
            pair(link, local)
        } else {
            idle.append(link)
        }
    }

    private func acceptLocal(_ conn: NWConnection) {
        conn.start(queue: queue)
        if let link = idle.first {
            idle.removeFirst()
            pair(link, conn)
            return
        }
        // No tunnel yet (cable just plugged in, or the server is replenishing): wait briefly.
        waiting.append(conn)
        queue.asyncAfter(deadline: .now() + Self.waitForTunnel) { [weak self] in
            guard let self, let i = self.waiting.firstIndex(where: { $0 === conn }) else { return }
            self.waiting.remove(at: i)
            conn.cancel()
        }
    }

    private func pair(_ link: Link, _ local: NWConnection) {
        link.local = local
        local.stateUpdateHandler = { state in
            switch state {
            case .failed, .cancelled: link.close()
            default: break
            }
        }
        for data in link.early { local.send(content: data, completion: .contentProcessed { _ in }) }
        link.early.removeAll()
        pump(from: local, link: link) { data in
            link.tunnel.send(content: data, completion: .contentProcessed { _ in })
        }
    }

    private func drop(_ link: Link) {
        idle.removeAll { $0 === link }
        link.close()
    }

    /// Reads from `conn` until it ends, handing each chunk to `forward`; closes the link at the end.
    private func pump(from conn: NWConnection, link: Link, forward: @escaping (Data) -> Void) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [weak self] data, _, isComplete, error in
            if let data, !data.isEmpty { forward(data) }
            if isComplete || error != nil {
                self?.drop(link)
                return
            }
            self?.pump(from: conn, link: link, forward: forward)
        }
    }
}
