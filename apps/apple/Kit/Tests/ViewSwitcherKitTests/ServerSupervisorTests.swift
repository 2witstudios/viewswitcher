#if os(macOS)
import XCTest
@testable import ViewSwitcherKit

/// The server's life in the Mac app: attach or own, bring a crashed server back on the restart policy,
/// give up after too many crashes, notice an attached server going away, and stop on Quit. The servers
/// are the same Bun stubs as ServerControllerTests', started and killed for real.
@MainActor
final class ServerSupervisorTests: XCTestCase {
    var tmp: URL!
    /// Fast enough for a test, in the same shape as the real one.
    let quick = RestartPolicy(delays: [0, 0.3, 0.6], window: 60)
    var supervisors: [ServerSupervisor] = []

    override func setUp() async throws {
        tmp = TestServers.tempDir()
    }

    override func tearDown() async throws {
        for s in supervisors { await s.quit()?.stop() }
        try? FileManager.default.removeItem(at: tmp)
    }

    /// A supervisor on a free port whose launch runs `script` (the serving stub unless said otherwise).
    func make(policy: RestartPolicy? = nil, script: String = TestServers.serving) throws -> (ServerSupervisor, URL) {
        let port = try TestServers.freePort()
        let base = URL(string: "http://127.0.0.1:\(port)")!
        let launch = try TestServers.launch(port: port, script: script, in: tmp)
        let s = ServerSupervisor(base: base, policy: policy ?? quick, readyTimeout: 10, slowFor: 0.5) { launch }
        supervisors.append(s)
        return (s, base)
    }

    func until(_ timeout: TimeInterval = 10, _ check: @escaping () -> Bool) async -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if check() { return true }
            try? await Task.sleep(for: .milliseconds(25))
        }
        return check()
    }

    /// Kill the running server as a crash would, and wait until the supervisor has it back.
    func crash(_ s: ServerSupervisor) async -> Int32? {
        guard let old = s.server?.pid else { return nil }
        kill(old, SIGKILL)
        _ = await until { s.server?.pid != old }
        _ = await until { s.state == .owned || s.state.stopped }
        return s.server?.pid
    }

    func testStartsItsOwnServerAndStopsItOnQuit() async throws {
        let (s, base) = try make()
        var seen: [ServerState] = []
        s.onChange = { _, new in seen.append(new) }
        await s.start()
        XCTAssertEqual(s.state, .owned)
        XCTAssertEqual(seen, [.owned], "starting is the state it begins in")
        XCTAssertEqual(s.server?.owned, true)
        let p = await probe(base)
        XCTAssertEqual(p, .viewswitcher)
        let own = s.quit()
        XCTAssertEqual(s.state, .quitting)
        XCTAssertNotNil(own, "Quit hands back the server to stop")
        await own?.stop()
        let after = await probe(base)
        XCTAssertEqual(after, .none)
    }

    func testAttachesAndNeverStopsWhatItDidntStart() async throws {
        let running = try TestServers.Stub(body: TestServers.state)
        let s = ServerSupervisor(base: running.base, policy: quick) { throw ServerError.startFailed("must not start one") }
        supervisors.append(s)
        await s.start()
        XCTAssertEqual(s.state, .attached)
        XCTAssertNil(s.quit(), "nothing to stop on Quit")
    }

    func testBringsACrashedServerBack() async throws {
        let (s, base) = try make()
        var seen: [ServerState] = []
        s.onChange = { _, new in seen.append(new) }
        await s.start()
        let first = s.server?.pid
        let second = await crash(s)
        XCTAssertEqual(s.state, .owned)
        XCTAssertNotNil(second)
        XCTAssertNotEqual(first, second, "a new server")
        XCTAssertEqual(seen, [.owned, .restarting(attempt: 1, exitCode: SIGKILL), .owned])
        let p = await probe(base)
        XCTAssertEqual(p, .viewswitcher)
    }

    func testWaitsLongerEachTimeThenGivesUp() async throws {
        let (s, _) = try make()
        var restarts: [(attempt: Int, at: Date)] = []
        var back: [Date] = []
        s.onChange = { _, new in
            if case .restarting(let n, _) = new { restarts.append((n, Date())) }
            if new == .owned { back.append(Date()) }
        }
        await s.start()
        for _ in 0..<3 { _ = await crash(s) }
        XCTAssertEqual(s.state, .owned, "three crashes in a minute are each restarted")
        XCTAssertEqual(restarts.map(\.attempt), [1, 2, 3])
        // back[0] is the first start; back[n] follows restart n.
        XCTAssertGreaterThanOrEqual(back[2].timeIntervalSince(restarts[1].at), 0.3)
        XCTAssertGreaterThanOrEqual(back[3].timeIntervalSince(restarts[2].at), 0.6)
        kill(s.server!.pid!, SIGKILL)
        let gaveUp = await until { s.state == .crashed(SIGKILL) }
        XCTAssertTrue(gaveUp, "the fourth crash within the window stops the restarts (\(s.state))")
        XCTAssertNil(s.server)
        // Restart Server starts afresh, with the crash count reset.
        await s.start()
        XCTAssertEqual(s.state, .owned)
        _ = await crash(s)
        XCTAssertEqual(restarts.last?.attempt, 1)
        XCTAssertEqual(s.state, .owned)
    }

    func testCrashesLongAgoDontCount() async throws {
        let (s, _) = try make(policy: RestartPolicy(delays: [0], window: 0.3))
        var attempts: [Int] = []
        s.onChange = { _, new in if case .restarting(let n, _) = new { attempts.append(n) } }
        await s.start()
        for _ in 0..<3 {
            _ = await crash(s)
            try await Task.sleep(for: .milliseconds(400))
        }
        XCTAssertEqual(attempts, [1, 1, 1])
        XCTAssertEqual(s.state, .owned)
    }

    func testARestartThatDiesWhileStartingIsAnotherCrash() async throws {
        let marker = tmp.appendingPathComponent("broken")
        // Serves until the marker exists; from then on it dies at once, as a broken install would.
        let script = "import { existsSync } from \"node:fs\"; if (existsSync(\(String(reflecting: marker.path)))) { console.error(\"broken\"); process.exit(4); } " + TestServers.serving
        let (s, _) = try make(script: script)
        await s.start()
        XCTAssertEqual(s.state, .owned)
        try Data().write(to: marker)
        kill(s.server!.pid!, SIGKILL)
        let gaveUp = await until { if case .crashed = s.state { true } else { false } }
        XCTAssertTrue(gaveUp, "\(s.state)")
    }

    func testQuitWhileWaitingToRestartRestartsNothing() async throws {
        let (s, base) = try make(policy: RestartPolicy(delays: [0.5], window: 60))
        await s.start()
        kill(s.server!.pid!, SIGKILL)
        let waiting = await until { if case .restarting = s.state { true } else { false } }
        XCTAssertTrue(waiting)
        XCTAssertNil(s.quit(), "nothing is running to stop")
        try await Task.sleep(for: .seconds(1.5))
        XCTAssertEqual(s.state, .quitting)
        let p = await probe(base)
        XCTAssertEqual(p, .none, "no server came back after Quit")
    }

    func testQuitWhileARestartIsStartingLeavesNothingRunning() async throws {
        let marker = tmp.appendingPathComponent("slow")
        // Answers at once the first time; once the marker exists, takes 3 s to answer.
        let script = "import { existsSync } from \"node:fs\"; setTimeout(() => { " + TestServers.serving + " }, existsSync(\(String(reflecting: marker.path))) ? 3000 : 0);"
        let (s, base) = try make(script: script)
        await s.start()
        XCTAssertEqual(s.state, .owned)
        try Data().write(to: marker)
        kill(s.server!.pid!, SIGKILL)
        let restarting = await until { if case .restarting = s.state { true } else { false } }
        XCTAssertTrue(restarting)
        try await Task.sleep(for: .milliseconds(500)) // the new server is starting, not answering yet
        XCTAssertNil(s.quit())
        try await Task.sleep(for: .seconds(4))
        let p = await probe(base)
        XCTAssertEqual(p, .none, "the half-started server was stopped, not left to answer after Quit")
        let log = try String(contentsOf: tmp.appendingPathComponent("logs/server.log"), encoding: .utf8)
        XCTAssertEqual(log.components(separatedBy: "server exited").count - 1, 2, "both servers exited: \(log)")
    }

    func testAnAttachedServerGoingAwayIsLost() async throws {
        var running: TestServers.Stub? = try TestServers.Stub(body: TestServers.state)
        let s = ServerSupervisor(base: running!.base, policy: quick) { throw ServerError.startFailed("no server here") }
        supervisors.append(s)
        await s.start()
        XCTAssertEqual(s.state, .attached)
        await s.checkAttached()
        XCTAssertEqual(s.state, .attached, "still answering")
        running = nil
        try await Task.sleep(for: .milliseconds(200))
        await s.checkAttached()
        XCTAssertEqual(s.state, .lost)
        XCTAssertTrue(s.state.stopped)
        // Restart Server: nothing answers now, and this one has no server of its own to start.
        await s.start()
        XCTAssertEqual(s.state, .failed(.startFailed("no server here")))
    }

    func testAPortSomeoneElseHoldsFails() async throws {
        let other = try TestServers.Stub(body: "<html>not us</html>")
        let s = ServerSupervisor(base: other.base, policy: quick) { throw ServerError.startFailed("must not start one") }
        supervisors.append(s)
        await s.start()
        XCTAssertEqual(s.state, .failed(.portTaken(String(other.port))))
        XCTAssertTrue(s.state.stopped)
    }

    func testStartDoesNothingWhileRunning() async throws {
        let (s, _) = try make()
        await s.start()
        let pid = s.server?.pid
        await s.start()
        XCTAssertEqual(s.server?.pid, pid)
        XCTAssertEqual(s.state, .owned)
    }
}

final class RestartPolicyTests: XCTestCase {
    func testStandardPolicy() {
        let p = RestartPolicy.standard
        XCTAssertEqual(p.delay(crashes: 1), 0)
        XCTAssertEqual(p.delay(crashes: 2), 2)
        XCTAssertEqual(p.delay(crashes: 3), 10)
        XCTAssertNil(p.delay(crashes: 4), "a fourth crash within the minute stops it")
    }

    func testOnlyRecentCrashesCount() {
        let now = Date()
        let p = RestartPolicy.standard
        let crashes = [now.addingTimeInterval(-90), now.addingTimeInterval(-59), now.addingTimeInterval(-1)]
        XCTAssertEqual(p.recent(crashes, now: now), Array(crashes.dropFirst()))
    }
}
#endif
