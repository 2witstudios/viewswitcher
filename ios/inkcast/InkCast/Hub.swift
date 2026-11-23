import Foundation
import Network

struct ObsState {
    var connected = false
    var scenes: [String] = []
    var current: String?
    var recording = false
    var streaming = false
    var muted = false
    var mic = ""

    init() {}

    init(_ d: [String: Any]) {
        connected = d["connected"] as? Bool ?? false
        scenes = d["scenes"] as? [String] ?? []
        current = d["current"] as? String
        recording = d["recording"] as? Bool ?? false
        streaming = d["streaming"] as? Bool ?? false
        muted = d["muted"] as? Bool ?? false
        mic = d["mic"] as? String ?? ""
    }
}

/// WebSocket link to the InkCast hub on the Mac. Finds it via Bonjour unless a host is set manually.
/// Everything runs on the main queue; message volume is small.
final class Hub: ObservableObject {
    enum Status: Equatable {
        case idle, searching, connecting
        case connected(String)
        case retrying(String)

        var label: String {
            switch self {
            case .idle: return "Idle"
            case .searching: return "Looking for Mac…"
            case .connecting: return "Connecting…"
            case .connected(let name): return name
            case .retrying(let why): return "Retrying – \(why)"
            }
        }
    }

    @Published private(set) var status: Status = .idle
    @Published private(set) var obs = ObsState()
    @Published var manualHost: String {
        didSet { UserDefaults.standard.set(manualHost, forKey: "hubHost") }
    }

    var isConnected: Bool { if case .connected = status { return true } else { return false } }
    var onMessage: (([String: Any]) -> Void)?

    private var browser: NWBrowser?
    private var connection: NWConnection?
    /// Bumped on every reset so callbacks from stale connections are ignored.
    private var generation = 0

    init() {
        manualHost = UserDefaults.standard.string(forKey: "hubHost") ?? ""
    }

    func start() {
        let host = manualHost.trimmingCharacters(in: .whitespaces)
        if host.isEmpty {
            browse()
        } else {
            let hostPort = host.contains(":") ? host : "\(host):7420"
            guard let url = URL(string: "ws://\(hostPort)/") else { return status = .retrying("bad host") }
            connect(to: .url(url), label: hostPort)
        }
    }

    func restart() {
        reset()
        start()
    }

    func reconnectIfNeeded() {
        if !isConnected { restart() }
    }

    func send(_ msg: [String: Any]) {
        guard isConnected, let connection, let data = try? JSONSerialization.data(withJSONObject: msg) else { return }
        let meta = NWProtocolWebSocket.Metadata(opcode: .text)
        let context = NWConnection.ContentContext(identifier: "msg", metadata: [meta])
        connection.send(content: data, contentContext: context, isComplete: true, completion: .contentProcessed { _ in })
    }

    // MARK: Private

    private func reset() {
        generation += 1
        browser?.cancel(); browser = nil
        connection?.cancel(); connection = nil
        obs = ObsState()
    }

    private func browse() {
        status = .searching
        let gen = generation
        let b = NWBrowser(for: .bonjour(type: "_inkcast._tcp", domain: nil), using: .tcp)
        b.browseResultsChangedHandler = { [weak self] results, _ in
            guard let self, gen == self.generation, self.connection == nil, let result = results.first else { return }
            self.browser?.cancel(); self.browser = nil
            var label = "Mac"
            if case let .service(name, _, _, _) = result.endpoint { label = name }
            self.connect(to: result.endpoint, label: label)
        }
        b.stateUpdateHandler = { [weak self] state in
            guard let self, gen == self.generation else { return }
            if case .failed(let error) = state { self.retry(error.localizedDescription) }
        }
        browser = b
        b.start(queue: .main)
    }

    private func connect(to endpoint: NWEndpoint, label: String) {
        status = .connecting
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        (params.defaultProtocolStack.transportProtocol as? NWProtocolTCP.Options)?.noDelay = true
        let ws = NWProtocolWebSocket.Options()
        ws.autoReplyPing = true
        params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)

        let c = NWConnection(to: endpoint, using: params)
        let gen = generation
        c.stateUpdateHandler = { [weak self] state in
            guard let self, gen == self.generation else { return }
            switch state {
            case .ready:
                self.status = .connected(label)
                self.receive(on: c, gen: gen)
            case .failed(let error), .waiting(let error):
                self.retry(error.localizedDescription)
            default:
                break
            }
        }
        connection = c
        c.start(queue: .main)
    }

    private func receive(on c: NWConnection, gen: Int) {
        c.receiveMessage { [weak self] data, context, _, error in
            guard let self, gen == self.generation else { return }
            if let error { return self.retry(error.localizedDescription) }
            if let data, !data.isEmpty,
               let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                if msg["t"] as? String == "obs", let state = msg["state"] as? [String: Any] {
                    self.obs = ObsState(state)
                } else {
                    self.onMessage?(msg)
                }
            }
            if context?.isFinal == true { return self.retry("closed") }
            self.receive(on: c, gen: gen)
        }
    }

    private func retry(_ why: String) {
        reset()
        status = .retrying(why)
        let gen = generation
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self, gen == self.generation else { return }
            self.start()
        }
    }
}
