import Foundation
import Network

/// The iPhone or iPad end of the USB-C link to the ViewSwitcher server.
///
/// iOS gives apps no network over the cable. The only path is usbmuxd, and it only connects
/// Mac → device, so the Mac's server keeps a few idle tunnel connections open to this app's
/// `tunnelPort` (apps/server/src/usb-bridge.ts). The web view talks to `localPort` here; each of its
/// connections is paired with one idle tunnel and piped through to the Mac.
///
/// Each direction of a pair ends on its own: a side that finishes sending is passed on as a
/// half-close, and the pair closes once both have. Reading is paced by sending: the next read from
/// one side is asked for only once the last chunk was handed to the other, so a slow reader slows the
/// sender instead of filling memory.
///
/// All state lives on one serial queue.
public final class UsbTunnel: @unchecked Sendable {
    public let localPort: NWEndpoint.Port
    public let tunnelPort: NWEndpoint.Port
    /// How long a web view connection waits for a tunnel (cable just plugged in, or the Mac replenishing).
    private let waitForTunnel: TimeInterval
    private static let chunk = 256 * 1024

    private let queue = DispatchQueue(label: "viewswitcher.usbtunnel")
    private var localListener: NWListener?
    private var tunnelListener: NWListener?
    /// Tunnels from the Mac, waiting for a request.
    private var idle: [Link] = []
    /// Web view connections waiting for a tunnel.
    private var waiting: [NWConnection] = []
    private var paired: [ObjectIdentifier: Link] = [:]

    /// One tunnel from the Mac and, once paired, the web view connection it carries.
    /// Only touched on the tunnel's queue.
    private final class Link: @unchecked Sendable {
        let tunnel: NWConnection
        var local: NWConnection?
        /// A first read from the tunnel before it was paired, held until there's somewhere to send it.
        var early: (data: Data?, complete: Bool)?
        /// Directions whose sender hasn't finished yet.
        var open = 2
        var closed = false
        init(_ tunnel: NWConnection) { self.tunnel = tunnel }

        func close() {
            if closed { return }
            closed = true
            tunnel.cancel()
            local?.cancel()
        }
    }

    public init(localPort: NWEndpoint.Port, tunnelPort: NWEndpoint.Port, waitForTunnel: TimeInterval = 4) {
        self.localPort = localPort
        self.tunnelPort = tunnelPort
        self.waitForTunnel = waitForTunnel
    }

    public func start() {
        queue.async { self.startListeners() }
    }

    public func stop() {
        queue.async { self.stopNow() }
    }

    /// Restart after the app comes back to the foreground (iOS may have torn the sockets down).
    public func restart() {
        queue.async {
            self.stopNow()
            self.queue.asyncAfter(deadline: .now() + 0.2) { self.startListeners() }
        }
    }

    /// The ports the listeners have, once they're ready (they differ from the ones asked for when those are `.any`).
    public func boundPorts() -> (local: NWEndpoint.Port, tunnel: NWEndpoint.Port)? {
        queue.sync {
            guard let l = localListener?.port, let t = tunnelListener?.port, l != .any, t != .any else { return nil }
            return (l, t)
        }
    }

    /// Idle tunnels, web view connections waiting, and pairs open: what the tests watch.
    public func counts() -> (idle: Int, waiting: Int, paired: Int) {
        queue.sync { (idle.count, waiting.count, paired.count) }
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
            let tunnels = try NWListener(using: Self.parameters(port: tunnelPort))
            tunnels.newConnectionHandler = { [weak self] conn in self?.acceptTunnel(conn) }
            tunnels.stateUpdateHandler = { [weak self] state in self?.listenerState("tunnel", state) }
            tunnels.start(queue: queue)
            tunnelListener = tunnels

            let local = try NWListener(using: Self.parameters(port: localPort))
            local.newConnectionHandler = { [weak self] conn in self?.acceptLocal(conn) }
            local.stateUpdateHandler = { [weak self] state in self?.listenerState("local", state) }
            local.start(queue: queue)
            localListener = local
        } catch {
            NSLog("[usb] couldn't start listeners: \(error)")
            queue.asyncAfter(deadline: .now() + 1) {
                self.stopNow()
                self.startListeners()
            }
        }
    }

    private func stopNow() {
        localListener?.cancel()
        tunnelListener?.cancel()
        localListener = nil
        tunnelListener = nil
        idle.forEach { $0.close() }
        idle.removeAll()
        paired.values.forEach { $0.close() }
        paired.removeAll()
        waiting.forEach { $0.cancel() }
        waiting.removeAll()
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
            // Once paired, a read or a send failing ends the pair: the connection reports failed as soon
            // as both ends have finished sending, while there may still be data to read from it.
            case .failed where link.local == nil, .cancelled: self?.drop(link)
            default: break
            }
        }
        conn.start(queue: queue)
        // Reading while idle is how a tunnel the Mac closes leaves the pool.
        relayTunnel(link)
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
        waiting.append(conn)
        conn.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled: self?.waiting.removeAll { $0 === conn }
            default: break
            }
        }
        queue.asyncAfter(deadline: .now() + waitForTunnel) { [weak self] in
            guard let self, let i = self.waiting.firstIndex(where: { $0 === conn }) else { return }
            self.waiting.remove(at: i)
            conn.cancel()
        }
    }

    private func pair(_ link: Link, _ local: NWConnection) {
        link.local = local
        paired[ObjectIdentifier(link)] = link
        local.stateUpdateHandler = { [weak self] state in
            if case .cancelled = state { self?.drop(link) }
        }
        if let early = link.early {
            link.early = nil
            forward(early.data, complete: early.complete, to: local, link: link) { [weak self] in self?.relayTunnel(link) }
        }
        relayLocal(link)
    }

    private func drop(_ link: Link) {
        idle.removeAll { $0 === link }
        paired[ObjectIdentifier(link)] = nil
        link.close()
    }

    // MARK: - relaying

    /// Mac → web view. Before pairing, one read is held in `early` and reading waits for the pair.
    private func relayTunnel(_ link: Link) {
        link.tunnel.receive(minimumIncompleteLength: 1, maximumLength: Self.chunk) { [weak self] data, _, complete, error in
            guard let self, !link.closed else { return }
            if error != nil { return self.drop(link) }
            guard let local = link.local else {
                // The Mac closed an idle tunnel; or it sent first, which waits for the pair.
                if complete, data?.isEmpty ?? true { return self.drop(link) }
                link.early = (data, complete)
                return
            }
            self.forward(data, complete: complete, to: local, link: link) { [weak self] in self?.relayTunnel(link) }
        }
    }

    /// Web view → Mac.
    private func relayLocal(_ link: Link) {
        guard let local = link.local else { return }
        local.receive(minimumIncompleteLength: 1, maximumLength: Self.chunk) { [weak self] data, _, complete, error in
            guard let self, !link.closed else { return }
            if error != nil { return self.drop(link) }
            self.forward(data, complete: complete, to: link.tunnel, link: link) { [weak self] in self?.relayLocal(link) }
        }
    }

    /// Sends `data` on, then reads again (`next`) once it's sent; at the end of a direction, passes the
    /// half-close on instead, and closes the pair once both directions have ended.
    private func forward(_ data: Data?, complete: Bool, to dst: NWConnection, link: Link, next: @escaping @Sendable () -> Void) {
        let end: @Sendable () -> Void = {
            guard complete else { return next() }
            dst.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { [weak self] error in
                guard let self, !link.closed else { return }
                if error != nil { return self.drop(link) }
                link.open -= 1
                if link.open == 0 { self.drop(link) }
            })
        }
        guard let data, !data.isEmpty else { return end() }
        dst.send(content: data, completion: .contentProcessed { [weak self] error in
            guard let self, !link.closed else { return }
            if error != nil { return self.drop(link) }
            end()
        })
    }
}
