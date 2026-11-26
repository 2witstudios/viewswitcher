#if os(macOS)
import Foundation

// The ViewSwitcher server behind the Mac app: attach to one that already answers on the port (e.g.
// `bun run dev`), otherwise start the bundled one and own it. Only a server this app started is ever
// stopped, and an orphan an earlier run left behind is replaced. ServerSupervisor keeps it running.

public enum Probe: Equatable, Sendable {
    /// A ViewSwitcher server answers.
    case viewswitcher
    /// Something else answers on the port.
    case other
    /// Something holds the port but didn't answer in time: a busy server, or not a server at all.
    case slow
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
        return .slow
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
    // fileSizeKey, not attributesOfItem: no file-timestamp API for the privacy manifest to declare.
    // (A URL caches resource values, so read it fresh.)
    var fresh = file
    fresh.removeAllCachedResourceValues()
    if let size = (try? fresh.resourceValues(forKeys: [.fileSizeKey]))?.fileSize, size > max {
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
    /// The leftover server this one replaced at launch, if any (set before the server is handed out).
    public internal(set) var replacedOrphan: Int32?

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

/// What answers at `base`, asking again for up to `slowFor` seconds while it's slow: a server busy
/// with a big library, or one still starting, isn't "something else" yet.
public func settledProbe(_ base: URL, slowFor: TimeInterval = 5, timeout: TimeInterval = 1.5) async -> Probe {
    let deadline = Date().addingTimeInterval(slowFor)
    while true {
        let p = await probe(base, timeout: timeout)
        if p != .slow || Date() >= deadline || Task.isCancelled { return p }
        try? await Task.sleep(for: .milliseconds(250))
    }
}

/// Attach to a running ViewSwitcher server at `base`, or start one with `launch` and wait until it
/// answers. An orphan sidecar (ServerInfo.isOrphan) is replaced rather than attached to.
public func connectOrStart(_ base: URL, launch: @autoclosure @Sendable () throws -> Launch, readyTimeout: TimeInterval = 20, slowFor: TimeInterval = 5) async throws -> Server {
    let taken = ServerError.portTaken(base.port.map(String.init) ?? "")
    switch await settledProbe(base, slowFor: slowFor) {
    case .other, .slow: throw taken
    case .none: return try await start(base, launch: launch(), readyTimeout: readyTimeout)
    case .viewswitcher: break
    }
    let info: ServerInfo
    do {
        info = try await ServerAPI(base: base, timeout: 2).info()
    } catch {
        // It answered a moment ago but not this (a server on its way out, or one too old or too far
        // away to say): ask again rather than attach to something that may be gone.
        switch await settledProbe(base, slowFor: slowFor) {
        case .viewswitcher: return Server(attachedTo: base)
        case .none: return try await start(base, launch: launch(), readyTimeout: readyTimeout)
        case .other, .slow: throw taken
        }
    }
    guard info.isOrphan(), let pid = info.pid else { return Server(attachedTo: base) }
    // The pid comes from whatever answers on the port, so it is only signalled once the system
    // confirms it's a leftover of this app's own server. One that can't be confirmed is left to go
    // by itself (its parent watch), and attached to only if it doesn't.
    if let l = try? launch(), isLeftoverSidecar(pid, executable: l.executable) {
        try await stopOrphan(pid, base: base)
        let s = try await start(base, launch: l, readyTimeout: readyTimeout)
        s.replacedOrphan = pid
        return s
    }
    guard await portFrees(base, within: 4) else { return Server(attachedTo: base) }
    return try await start(base, launch: launch(), readyTimeout: readyTimeout)
}

/// Whether nothing answers at `base` any more, within `seconds`.
func portFrees(_ base: URL, within seconds: TimeInterval) async -> Bool {
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline, !Task.isCancelled {
        if await probe(base, timeout: 0.5) == .none { return true }
        try? await Task.sleep(for: .milliseconds(150))
    }
    return false
}

/// What the system says about a running process.
struct ProcessFacts: Equatable {
    var path: String
    var uid: uid_t
    var ppid: UInt32
}

func processFacts(_ pid: Int32) -> ProcessFacts? {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else { return nil }
    var buf = [CChar](repeating: 0, count: Int(MAXPATHLEN) * 4)
    guard proc_pidpath(pid, &buf, UInt32(buf.count)) > 0 else { return nil }
    return ProcessFacts(path: String(cString: buf), uid: info.pbi_uid, ppid: info.pbi_ppid)
}

/// Whether `pid` is a leftover of the server this app launches: that same executable, run by this
/// user, and handed to launchd (ppid 1) because the app that started it is gone. Anything else that
/// names a pid in /api/info (another account's or a sandboxed app's listener) gets no signal sent.
func isLeftoverSidecar(_ pid: Int32, executable: URL) -> Bool {
    guard let f = processFacts(pid) else { return false }
    let same = URL(fileURLWithPath: f.path).resolvingSymlinksInPath().path == executable.resolvingSymlinksInPath().path
    return same && f.uid == getuid() && f.ppid == 1
}

/// SIGTERM (it saves paired devices on the way out), SIGKILL after 3 s; returns once the port is free.
func stopOrphan(_ pid: Int32, base: URL) async throws {
    kill(pid, SIGTERM)
    let started = Date()
    var killed = false
    while Date().timeIntervalSince(started) < 6, !Task.isCancelled {
        if !processExists(pid), await probe(base, timeout: 0.5) == .none { return }
        if !killed, Date().timeIntervalSince(started) > 3 {
            kill(pid, SIGKILL)
            killed = true
        }
        try? await Task.sleep(for: .milliseconds(100))
    }
    throw ServerError.startFailed("A ViewSwitcher server left over from before (process \(pid)) wouldn't stop. Quit it in Activity Monitor, then open ViewSwitcher again.")
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
        // Quit, or a restart called off: don't leave a server starting with nobody waiting for it.
        if Task.isCancelled {
            await server.stop()
            throw CancellationError()
        }
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
