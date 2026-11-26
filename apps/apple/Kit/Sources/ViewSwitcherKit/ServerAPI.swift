#if os(macOS)
import Foundation

/// What `GET /api/info` answers, only to this Mac itself (a mac route in apps/server/src/http/routes.ts; gate.ts isMac).
public struct ServerInfo: Decodable, Equatable, Sendable {
    /// The library folder, an absolute path.
    public var library: String
    public var port: Int?
    /// The Mac app started this server (it was given the app's pid to watch).
    public var sidecar: Bool?
    /// The app that started it, when `sidecar`.
    public var parentPid: Int32?
    /// The server's own process.
    public var pid: Int32?

    public init(library: String, port: Int? = nil, sidecar: Bool? = nil, parentPid: Int32? = nil, pid: Int32? = nil) {
        self.library = library
        self.port = port
        self.sidecar = sidecar
        self.parentPid = parentPid
        self.pid = pid
    }

    /// A server an earlier run of the app started and then lost (a crash or a force quit). It exits by
    /// itself within a couple of seconds; a relaunch in that window replaces it rather than attaching
    /// to a server that is about to go away.
    public func isOrphan(ownPid: Int32 = getpid(), isAlive: (Int32) -> Bool = processExists) -> Bool {
        guard sidecar == true, let parentPid, parentPid != ownPid, pid != nil else { return false }
        return !isAlive(parentPid)
    }
}

/// Whether a process with this pid exists (EPERM: it does, under another user).
public func processExists(_ pid: Int32) -> Bool {
    kill(pid, 0) == 0 || errno == EPERM
}

/// What `POST /api/obs/setup` answers.
public struct ObsSetupResult: Decodable, Equatable, Sendable {
    /// Device sources still to add to the ViewSwitcher scene in OBS.
    public var missing: [String]
    /// OBS was switched to the scene (never while it streams or records).
    public var switched: Bool

    public init(missing: [String], switched: Bool) {
        self.missing = missing
        self.switched = switched
    }
}

public enum ServerAPIError: LocalizedError, Equatable {
    /// The server answered with something other than 200; `message` is its `error`, or a fallback.
    case refused(status: Int, message: String)
    /// A 200 whose body wasn't what this call expects.
    case unreadable(String)

    public var errorDescription: String? {
        switch self {
        case .refused(_, let message): message
        case .unreadable(let what): "The server's answer didn't make sense (\(what))."
        }
    }
}

/// The server calls the Mac app makes, typed. Every call goes to `base` (this Mac's own server).
public struct ServerAPI: Sendable {
    public let base: URL
    /// Sent as x-viewswitcher-admin for the pairing endpoints only this app may call.
    public let adminToken: String?
    /// How long a call may take before it fails.
    public let timeout: TimeInterval
    private let session: URLSession

    public init(base: URL, adminToken: String? = nil, timeout: TimeInterval = 30, session: URLSession = .shared) {
        self.base = base
        self.adminToken = adminToken
        self.timeout = timeout
        self.session = session
    }

    public func info() async throws -> ServerInfo {
        try await decode(ServerInfo.self, from: call("api/info"))
    }

    public func setUpObs() async throws -> ObsSetupResult {
        try await decode(ObsSetupResult.self, from: call("api/obs/setup", body: Empty()))
    }

    /// The Claude Desktop extension made for this install.
    public func agentExtension() async throws -> Data {
        try await call("api/agent/viewswitcher.mcpb")
    }

    // ------------------------------------------------------------ phones and tablets

    public func remoteStatus() async throws -> RemoteStatus { try await remote("api/remote") }
    public func setRemoteEnabled(_ on: Bool) async throws -> RemoteStatus { try await remote("api/remote", body: Enabled(enabled: on)) }
    public func newPairingCode() async throws -> RemoteStatus { try await remote("api/remote/code", body: Empty()) }
    public func removeDevice(_ id: String) async throws -> RemoteStatus { try await remote("api/remote/remove", body: DeviceId(id: id)) }

    /// A server this app didn't start (bun run dev) has another secret and answers 404.
    public static let pairingNeedsOwnServer = "Pairing works with the server this app starts. Quit the other ViewSwitcher server (bun run dev), then choose Restart Server."

    private func remote(_ path: String, body: (any Encodable & Sendable)? = nil) async throws -> RemoteStatus {
        do {
            return try await decode(RemoteStatus.self, from: call(path, body: body, admin: true))
        } catch ServerAPIError.refused(404, _) {
            throw ServerAPIError.refused(status: 404, message: Self.pairingNeedsOwnServer)
        }
    }

    // ------------------------------------------------------------ plumbing

    private struct Empty: Encodable, Sendable {}
    private struct Enabled: Encodable, Sendable { var enabled: Bool }
    private struct DeviceId: Encodable, Sendable { var id: String }
    private struct ErrorBody: Decodable { var error: String }

    /// GET, or POST `body` as JSON; the body of a 200, else `.refused` with the server's own reason.
    private func call(_ path: String, body: (any Encodable & Sendable)? = nil, admin: Bool = false) async throws -> Data {
        var req = URLRequest(url: base.appendingPathComponent(path))
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.timeoutInterval = timeout
        if admin, let adminToken { req.setValue(adminToken, forHTTPHeaderField: "x-viewswitcher-admin") }
        if let body {
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await session.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else {
            let reason = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error
            throw ServerAPIError.refused(status: status, message: reason ?? "The server said no (\(status)).")
        }
        return data
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw ServerAPIError.unreadable(String(describing: type))
        }
    }
}
#endif
