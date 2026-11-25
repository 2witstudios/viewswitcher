#if os(macOS)
import Foundation

/// Where the Mac app's server is in its life. One value instead of flags, so the menu, the window and
/// Quit all read the same thing.
public enum ServerState: Equatable, Sendable {
    /// Launching, or Restart Server: finding a server to attach to, or starting the bundled one.
    case starting
    /// The app's own server is running.
    case owned
    /// A server someone else started (bun run dev) is running; the app never stops it.
    case attached
    /// The app's own server exited by itself; it is being brought back (`attempt` of the restart policy).
    case restarting(attempt: Int, exitCode: Int32)
    /// It kept exiting, so the app stopped bringing it back: Restart Server is up to the person.
    case crashed(Int32)
    /// The server the app attached to went away. Restart Server attaches again or starts the bundled one.
    case lost
    /// No server could be started (or the port is someone else's).
    case failed(ServerError)
    /// The app is quitting.
    case quitting

    /// A server answers.
    public var running: Bool { self == .owned || self == .attached }

    /// Nothing is running or on its way: Restart Server is what's left.
    public var stopped: Bool {
        switch self {
        case .crashed, .lost, .failed: true
        default: false
        }
    }
}

/// How the app brings its server back after it exits by itself: at once, then after 2 s, then 10 s,
/// and not a fourth time within a minute. A server that dies right after every start isn't helped by
/// more restarts, and the notice with Restart Server says what's wrong instead.
public struct RestartPolicy: Equatable, Sendable {
    /// The wait before the first, second and third restart.
    public var delays: [TimeInterval]
    /// Crashes this long ago no longer count.
    public var window: TimeInterval

    public static let standard = RestartPolicy(delays: [0, 2, 10], window: 60)

    public init(delays: [TimeInterval], window: TimeInterval) {
        self.delays = delays
        self.window = window
    }

    /// The crashes that still count at `now`.
    public func recent(_ crashes: [Date], now: Date) -> [Date] {
        crashes.filter { now.timeIntervalSince($0) < window }
    }

    /// The wait before restarting, given the crashes that count (the latest included); nil means stop.
    public func delay(crashes: Int) -> TimeInterval? {
        crashes >= 1 && crashes <= delays.count ? delays[crashes - 1] : nil
    }
}

/// Keeps the Mac app's server running: attaches or starts it, brings it back when it exits by itself
/// (RestartPolicy), notices when an attached one goes away, and stops it on Quit. Every change of
/// `state` is reported through `onChange`.
@MainActor
public final class ServerSupervisor {
    public private(set) var state: ServerState = .starting
    /// The server in use while `state.running`.
    public private(set) var server: Server?
    /// Called after every change of `state`, with the state before it.
    public var onChange: ((_ from: ServerState, _ to: ServerState) -> Void)?

    private let base: URL
    private let policy: RestartPolicy
    private let readyTimeout: TimeInterval
    private let slowFor: TimeInterval
    private let launch: @MainActor () throws -> Launch
    private var crashes: [Date] = []
    private var begun = false
    /// A restart waiting for its delay, or starting.
    private var restart: Task<Void, Never>?

    /// `launch` is asked each time a server has to be started, so it can carry current settings.
    public init(base: URL, policy: RestartPolicy = .standard, readyTimeout: TimeInterval = 20, slowFor: TimeInterval = 5, launch: @escaping @MainActor () throws -> Launch) {
        self.base = base
        self.policy = policy
        self.readyTimeout = readyTimeout
        self.slowFor = slowFor
        self.launch = launch
    }

    /// At launch, and Restart Server. Returns once a server runs or it's clear none will
    /// (`state` is then `.failed`). Does nothing while one runs or is on its way.
    public func start() async {
        guard !begun || state.stopped else { return }
        begun = true
        crashes = []
        await connect(as: .starting)
    }

    /// Quit: no more restarts. Returns the server to stop, if the app started it; the caller stops it
    /// (AppKit's terminate-later wait runs the main run loop in a mode where main-actor tasks don't run).
    public func quit() -> Server? {
        restart?.cancel()
        restart = nil
        let s = server
        server = nil
        set(.quitting)
        return s?.owned == true ? s : nil
    }

    /// The live connection to an attached server dropped: if nothing answers any more, it's gone.
    public func checkAttached() async {
        guard state == .attached, let s = server else { return }
        if await probe(base) == .none, server === s, state == .attached {
            server = nil
            set(.lost)
        }
    }

    // ------------------------------------------------------------ inside

    private func set(_ new: ServerState) {
        let old = state
        guard new != old else { return }
        state = new
        onChange?(old, new)
    }

    private func connect(as phase: ServerState) async {
        set(phase)
        let s: Server
        // Made here, on the main actor; only thrown if a server has to be started.
        let made = Result { try launch() }
        do {
            s = try await connectOrStart(base, launch: try made.get(), readyTimeout: readyTimeout, slowFor: slowFor)
        } catch {
            guard !Task.isCancelled, state != .quitting else { return }
            let failure = error as? ServerError ?? .startFailed(error.localizedDescription)
            // A restart that dies while starting is one more crash; a port someone else took isn't.
            if case .restarting(_, let code) = phase, case .startFailed = failure {
                crashed(code)
            } else {
                set(.failed(failure))
            }
            return
        }
        guard !Task.isCancelled, state != .quitting else {
            await s.stop() // Quit came while it was starting
            return
        }
        server = s
        s.onExit = { [weak self, weak s] code in
            guard let self, let s else { return }
            self.exited(s, code)
        }
        set(s.owned ? .owned : .attached)
        // It may have died before onExit was set.
        if let code = s.exited { exited(s, code) }
    }

    private func exited(_ s: Server, _ code: Int32) {
        guard server === s, state == .owned else { return }
        server = nil
        crashed(code)
    }

    private func crashed(_ code: Int32) {
        let now = Date()
        crashes = policy.recent(crashes, now: now) + [now]
        guard let delay = policy.delay(crashes: crashes.count) else {
            set(.crashed(code))
            return
        }
        let phase = ServerState.restarting(attempt: crashes.count, exitCode: code)
        set(phase)
        // Not awaited: whoever saw the crash carries on; the restart reports through onChange.
        restart = Task { [weak self] in
            if delay > 0 { try? await Task.sleep(for: .seconds(delay)) }
            guard let self, !Task.isCancelled, self.state == phase else { return }
            await self.connect(as: phase)
        }
    }
}
#endif
