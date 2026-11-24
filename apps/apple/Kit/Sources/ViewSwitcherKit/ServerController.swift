#if os(macOS)
import Foundation

// The ViewSwitcher server behind the Mac app (port of apps/mac/src/server.ts, MAC-11): attach to one
// that already answers on the port (e.g. `bun run dev`), otherwise start the bundled one and own it.
// Only a server this app started is ever stopped.

public enum Probe: Equatable, Sendable {
    /// A ViewSwitcher server answers.
    case viewswitcher
    /// Something else holds the port (or answers too slowly to be ours).
    case other
    /// Nothing listens.
    case none
}

/// What answers at `base`: a ViewSwitcher server, something else, or nothing.
public func probe(_ base: URL, timeout: TimeInterval = 1.5) async -> Probe {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = timeout
    config.timeoutIntervalForResource = timeout
    config.connectionProxyDictionary = [:]
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    let session = URLSession(configuration: config)
    defer { session.finishTasksAndInvalidate() }
    do {
        let (data, response) = try await session.data(from: base.appendingPathComponent("api/state"))
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              body.keys.contains("obs"), body.keys.contains("onAir")
        else { return .other }
        return .viewswitcher
    } catch let e as URLError where e.code == .timedOut {
        // Something holds the port but doesn't answer like us.
        return .other
    } catch {
        return .none
    }
}

public struct Launch: Sendable {
    /// The bundled sidecar, or `bun …/apps/server/src/index.ts` from a checkout.
    public var executable: URL
    public var arguments: [String]
    public var environment: [String: String]
    /// Server output is appended here (and the file restarts once it passes `logMaxBytes`).
    public var logFile: URL

    public init(executable: URL, arguments: [String] = [], environment: [String: String], logFile: URL) {
        self.executable = executable
        self.arguments = arguments
        self.environment = environment
        self.logFile = logFile
    }
}

public enum ServerError: LocalizedError, Equatable {
    case portTaken(String)
    case startFailed(String)

    public var errorDescription: String? {
        switch self {
        case .portTaken(let port):
            "Something else is using port \(port), so ViewSwitcher can't start its server there. Quit that app, or set PORT to another port."
        case .startFailed(let why): why
        }
    }
}

public let logMaxBytes = 5 * 1024 * 1024

/// Start a fresh log once it's past `max` bytes, so it never grows forever.
public func capLog(_ file: URL, max: Int = logMaxBytes) {
    try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    if let size = (try? FileManager.default.attributesOfItem(atPath: file.path))?[.size] as? Int, size > max {
        try? Data().write(to: file)
    }
}

/// A server the app is using.
public final class Server: @unchecked Sendable {
    public let base: URL
    /// False when attached to a server someone else started; stop() then does nothing.
    public let owned: Bool
    /// Called on the main queue if an owned server exits without stop() (a crash).
    public var onExit: (@MainActor (Int32) -> Void)?

    private let process: Process?
    private let lock = NSLock()
    private var exitCode: Int32?
    private var stopping = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private var log: FileHandle?
    private var tailText = ""

    /// A server someone else started.
    init(attachedTo base: URL) {
        self.base = base
        owned = false
        process = nil
    }

    init(base: URL, process: Process, log: FileHandle?) {
        self.base = base
        owned = true
        self.process = process
        self.log = log
    }

    public var pid: Int32? { process?.processIdentifier }

    var exited: Int32? { lock.withLock { exitCode } }
    var tail: String { lock.withLock { tailText } }

    func write(_ data: Data) {
        lock.withLock {
            try? log?.write(contentsOf: data)
            tailText = String((tailText + String(decoding: data, as: UTF8.self)).suffix(2000))
        }
    }

    func didExit(_ code: Int32) {
        let (wasStopping, pending) = lock.withLock { () -> (Bool, [CheckedContinuation<Void, Never>]) in
            exitCode = code
            try? log?.write(contentsOf: Data("--- server exited (\(code))\n".utf8))
            try? log?.close()
            log = nil
            // Break the handler cycles (process → handler → server → process) once it's gone.
            process?.terminationHandler = nil
            (process?.standardOutput as? Pipe)?.fileHandleForReading.readabilityHandler = nil
            let w = waiters
            waiters = []
            return (stopping, w)
        }
        pending.forEach { $0.resume() }
        if !wasStopping {
            DispatchQueue.main.async { MainActor.assumeIsolated { self.onExit?(code) } }
        }
    }

    func waitForExit() async {
        await withCheckedContinuation { c in
            let done = lock.withLock { () -> Bool in
                if exitCode != nil { return true }
                waiters.append(c)
                return false
            }
            if done { c.resume() }
        }
    }

    /// Stops the server if this app started it (SIGTERM, then SIGKILL after 3 s); returns once it has exited.
    public func stop() async {
        guard let process, owned else { return }
        let running = lock.withLock { () -> Bool in
            if exitCode != nil { return false }
            stopping = true
            return true
        }
        guard running else { return }
        process.terminate()
        // Not a task group: it couldn't return while its waitForExit child is still waiting.
        let pid = process.processIdentifier
        let killer = Task.detached {
            try? await Task.sleep(for: .seconds(3))
            if !Task.isCancelled, self.exited == nil { kill(pid, SIGKILL) }
        }
        await waitForExit()
        killer.cancel()
    }
}

/// Attach to a running ViewSwitcher server at `base`, or start one with `launch` and wait until it answers.
public func connectOrStart(_ base: URL, launch: Launch, readyTimeout: TimeInterval = 20) async throws -> Server {
    switch await probe(base) {
    case .viewswitcher: return Server(attachedTo: base)
    case .other: throw ServerError.portTaken(base.port.map(String.init) ?? "")
    case .none: return try await start(base, launch: launch, readyTimeout: readyTimeout)
    }
}

func start(_ base: URL, launch: Launch, readyTimeout: TimeInterval) async throws -> Server {
    capLog(launch.logFile)
    if !FileManager.default.fileExists(atPath: launch.logFile.path) { FileManager.default.createFile(atPath: launch.logFile.path, contents: nil) }
    let log = try? FileHandle(forWritingTo: launch.logFile)
    _ = try? log?.seekToEnd()
    let cmd = ([launch.executable.path] + launch.arguments).joined(separator: " ")
    try? log?.write(contentsOf: Data("\n--- \(ISO8601DateFormatter().string(from: Date())) starting \(cmd)\n".utf8))

    let process = Process()
    process.executableURL = launch.executable
    process.arguments = launch.arguments
    process.environment = launch.environment
    process.standardInput = FileHandle.nullDevice
    let out = Pipe()
    process.standardOutput = out
    process.standardError = out
    let server = Server(base: base, process: process, log: log)
    out.fileHandleForReading.readabilityHandler = { h in
        let data = h.availableData
        if data.isEmpty { h.readabilityHandler = nil } else { server.write(data) }
    }
    process.terminationHandler = { p in server.didExit(p.terminationStatus) }
    do {
        try process.run()
    } catch {
        server.write(Data("\(error.localizedDescription)\n".utf8))
        throw ServerError.startFailed("The ViewSwitcher server couldn't start.\n\n\(error.localizedDescription)")
    }

    let deadline = Date().addingTimeInterval(readyTimeout)
    while Date() < deadline {
        if server.exited != nil {
            try? await Task.sleep(for: .milliseconds(100)) // let the last output land in the tail
            throw ServerError.startFailed("The ViewSwitcher server stopped while starting.\n\n\(server.tail.trimmingCharacters(in: .whitespacesAndNewlines))")
        }
        if await probe(base, timeout: 0.5) == .viewswitcher { return server }
        try? await Task.sleep(for: .milliseconds(150))
    }
    await server.stop()
    throw ServerError.startFailed("The ViewSwitcher server didn't answer within \(Int(readyTimeout)) s.\n\n\(server.tail.trimmingCharacters(in: .whitespacesAndNewlines))")
}
#endif
