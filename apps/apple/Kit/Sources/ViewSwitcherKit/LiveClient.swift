import Foundation

/// Follows the server's live state over `/ws`, like any switcher page, and reconnects every 2 s
/// while it's gone. Callbacks arrive on the main actor; nil means the connection dropped.
@MainActor
public final class LiveClient {
    public var onState: ((LiveState?) -> Void)?
    /// The socket closed (before any reconnect attempt).
    public var onClose: (() -> Void)?

    private let url: URL
    private let session = URLSession(configuration: .ephemeral)
    private var task: URLSessionWebSocketTask?
    private var generation = 0
    private var stopped = false

    /// `base` is http://127.0.0.1:<port>.
    public init(base: URL) {
        var c = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        c.scheme = "ws"
        c.path = "/ws"
        url = c.url!
    }

    public func start() {
        stopped = false
        connect()
    }

    public func stop() {
        stopped = true
        generation += 1
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    /// Stop for good and release the session (the client isn't used again).
    public func close() {
        stop()
        session.invalidateAndCancel()
    }

    /// Drop the current socket and connect again now.
    public func restart() {
        stop()
        start()
    }

    private func connect() {
        generation += 1
        let gen = generation
        let t = session.webSocketTask(with: url)
        task = t
        t.resume()
        receive(t, gen)
    }

    private func receive(_ t: URLSessionWebSocketTask, _ gen: Int) {
        t.receive { [weak self] result in
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self, gen == self.generation else { return }
                    switch result {
                    case .success(let msg):
                        let data: Data? = switch msg {
                        case .string(let s): Data(s.utf8)
                        case .data(let d): d
                        @unknown default: nil
                        }
                        if let data, let state = ServerMessage.state(from: data) { self.onState?(state) }
                        self.receive(t, gen)
                    case .failure:
                        self.onState?(nil)
                        self.onClose?()
                        guard !self.stopped else { return }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                            MainActor.assumeIsolated {
                                if gen == self.generation, !self.stopped { self.connect() }
                            }
                        }
                    }
                }
            }
        }
    }
}
