#if os(macOS)
import Network
import XCTest
@testable import ViewSwitcherKit

/// Probe, attach or own, stop only what it started, replace an orphan, crash notice, start failures,
/// log cap. The "server" is a stub: an in-process HTTP listener, or `bun stub.ts` when the controller starts it.
final class ServerControllerTests: XCTestCase {
    typealias Stub = TestServers.Stub
    static let state = TestServers.state
    static let serving = TestServers.serving
    func freePort() throws -> UInt16 { try TestServers.freePort() }

    var tmp: URL!
    override func setUp() { tmp = TestServers.tempDir() }
    override func tearDown() {
        for pid in leftovers { kill(pid, SIGKILL) }
        try? FileManager.default.removeItem(at: tmp)
    }

    func stubLaunch(port: UInt16, script: String) throws -> Launch {
        try TestServers.launch(port: port, script: script, in: tmp)
    }

    func testProbe() async throws {
        let ours = try Stub(body: Self.state)
        let that = await probe(ours.base)
        XCTAssertEqual(that, .viewswitcher)
        let other = try Stub(body: "<html>hi</html>")
        let r1 = await probe(other.base)
        XCTAssertEqual(r1, .other)
        let silent = try Stub(body: "", silent: true)
        let r2 = await probe(silent.base, timeout: 0.5)
        XCTAssertEqual(r2, .slow, "a port that holds the connection but never answers isn't free")
        let r3 = await probe(URL(string: "http://127.0.0.1:\(try freePort())")!)
        XCTAssertEqual(r3, .none)
    }

    func testAttachesToARunningServerAndNeverStopsIt() async throws {
        let running = try Stub(body: Self.state)
        let launch = Launch(executable: URL(fileURLWithPath: "/nonexistent"), environment: [:], logFile: tmp.appendingPathComponent("log"))
        let s = try await connectOrStart(running.base, launch: launch)
        XCTAssertFalse(s.owned)
        await s.stop()
        let after = await probe(running.base)
        XCTAssertEqual(after, .viewswitcher, "stop() leaves a server it didn't start")
    }

    func testPortTakenBySomethingElse() async throws {
        let other = try Stub(body: "nope", status: "404 Not Found")
        let launch = Launch(executable: URL(fileURLWithPath: "/nonexistent"), environment: [:], logFile: tmp.appendingPathComponent("log"))
        do {
            _ = try await connectOrStart(other.base, launch: launch)
            XCTFail("should throw")
        } catch let e as ServerError {
            XCTAssertEqual(e, .portTaken(String(other.port)))
            XCTAssertTrue(e.localizedDescription.contains("Something else is using port \(other.port)"))
        }
    }

    @MainActor
    func testStartsOwnsAndStops() async throws {
        let port = try freePort()
        let base = URL(string: "http://127.0.0.1:\(port)")!
        let launch = try stubLaunch(port: port, script: Self.serving)
        let s = try await connectOrStart(base, launch: launch)
        XCTAssertTrue(s.owned)
        var crashed = false
        s.onExit = { _ in crashed = true }
        let up = await probe(base)
        XCTAssertEqual(up, .viewswitcher)
        await s.stop()
        let down = await probe(base)
        XCTAssertEqual(down, .none, "Quit frees the port")
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertFalse(crashed, "a requested stop isn't a crash")
        let log = try String(contentsOf: launch.logFile, encoding: .utf8)
        XCTAssertTrue(log.contains("starting") && log.contains("stub up") && log.contains("server exited"), log)
    }

    func testASlowAnswerIsAskedAgainBeforeThePortCountsAsTaken() async throws {
        // Busy for its first second (a big library loading), then answering like us.
        let late = try Stub(body: Self.state, silentFor: 1)
        let t0 = Date()
        let settled = await settledProbe(late.base, slowFor: 5, timeout: 0.4)
        XCTAssertEqual(settled, .viewswitcher)
        XCTAssertGreaterThan(Date().timeIntervalSince(t0), 0.9)
        let launch = Launch(executable: URL(fileURLWithPath: "/nonexistent"), environment: [:], logFile: tmp.appendingPathComponent("log"))
        let later = try Stub(body: Self.state, silentFor: 1)
        let s = try await connectOrStart(later.base, launch: launch, slowFor: 5)
        XCTAssertFalse(s.owned, "attached once it answered")
    }

    func testAPortThatStaysSilentIsInUse() async throws {
        let silent = try Stub(body: "", silent: true)
        let launch = Launch(executable: URL(fileURLWithPath: "/nonexistent"), environment: [:], logFile: tmp.appendingPathComponent("log"))
        let t0 = Date()
        do {
            _ = try await connectOrStart(silent.base, launch: launch, slowFor: 1)
            XCTFail("should throw")
        } catch let e as ServerError {
            XCTAssertEqual(e, .portTaken(String(silent.port)))
        }
        XCTAssertGreaterThan(Date().timeIntervalSince(t0), 1, "asked again for the whole wait first")
    }

    /// A Bun stub answering /api/info as a sidecar of `parent`, naming `reportPid` as its own pid (its
    /// real one unless told otherwise), ignoring SIGTERM if told to.
    func sidecarScript(parent: Int32, reportPid: Int32? = nil, ignoreTerm: Bool = false) -> String {
        """
        \(ignoreTerm ? "process.on(\"SIGTERM\", () => {});" : "")
        Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.PORT), fetch: (req) =>
          new URL(req.url).pathname === "/api/info"
            ? Response.json({ library: "/tmp/lib", sidecar: true, parentPid: \(parent), pid: \(reportPid.map(String.init) ?? "process.pid"), claudeCode: "x" })
            : Response.json(\(Self.state)) });
        """
    }

    /// Runs `script` with the same executable the controller would launch, detached the way an
    /// earlier run of the app leaves it: its parent (a shell here) gone, so launchd (pid 1) holds it.
    /// Returns its pid once it answers.
    func runLeftover(port: UInt16, script: String) async throws -> Int32 {
        let l = try TestServers.launch(port: port, script: script, in: tmp, name: "leftover.ts")
        let sh = Process()
        sh.executableURL = URL(fileURLWithPath: "/bin/sh")
        sh.arguments = ["-c", "\"$0\" \"$1\" >/dev/null 2>&1 & echo $!", l.executable.path] + l.arguments
        sh.environment = l.environment
        let out = Pipe()
        sh.standardOutput = out
        try sh.run()
        sh.waitUntilExit()
        let text = String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        let pid = try XCTUnwrap(Int32(text.trimmingCharacters(in: .whitespacesAndNewlines)))
        leftovers.append(pid)
        let base = URL(string: "http://127.0.0.1:\(port)")!
        for _ in 0..<100 where await probe(base) != .viewswitcher { try await Task.sleep(for: .milliseconds(50)) }
        return pid
    }

    /// Leftovers this test started, killed in tearDown whatever happened.
    var leftovers: [Int32] = []

    func deadPid() throws -> Int32 {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/true")
        try p.run()
        p.waitUntilExit()
        return p.processIdentifier
    }

    func until(_ timeout: TimeInterval = 5, _ check: @escaping () -> Bool) async -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end, !check() { try? await Task.sleep(for: .milliseconds(25)) }
        return check()
    }

    func testAnOrphanFromAnEarlierRunIsReplaced() async throws {
        let port = try freePort()
        let base = URL(string: "http://127.0.0.1:\(port)")!
        let orphan = try await runLeftover(port: port, script: sidecarScript(parent: try deadPid()))
        let launch = try stubLaunch(port: port, script: Self.serving)
        let s = try await connectOrStart(base, launch: launch)
        XCTAssertTrue(s.owned, "the app starts its own instead of attaching to a server about to go away")
        XCTAssertEqual(s.replacedOrphan, orphan)
        let gone = await until { !processExists(orphan) }
        XCTAssertTrue(gone, "the orphan was stopped")
        XCTAssertNotEqual(s.pid, orphan)
        await s.stop()
    }

    func testAnOrphanThatIgnoresSigtermIsKilled() async throws {
        let port = try freePort()
        let base = URL(string: "http://127.0.0.1:\(port)")!
        let orphan = try await runLeftover(port: port, script: sidecarScript(parent: try deadPid(), ignoreTerm: true))
        let launch = try stubLaunch(port: port, script: Self.serving)
        let s = try await connectOrStart(base, launch: launch)
        XCTAssertTrue(s.owned)
        XCTAssertEqual(s.replacedOrphan, orphan)
        let gone = await until { !processExists(orphan) }
        XCTAssertTrue(gone)
        await s.stop()
    }

    func testAPidThatIsntALeftoverServerIsNeverSignalled() async throws {
        // Whatever holds the port names another process of this user (here a sleep, still with its
        // parent) as its pid: the app must not kill it on that say-so.
        let port = try freePort()
        let base = URL(string: "http://127.0.0.1:\(port)")!
        let bystander = Process()
        bystander.executableURL = URL(fileURLWithPath: "/bin/sleep")
        bystander.arguments = ["30"]
        try bystander.run()
        defer { bystander.terminate() }
        _ = try await runLeftover(port: port, script: sidecarScript(parent: try deadPid(), reportPid: bystander.processIdentifier))
        let launch = try stubLaunch(port: port, script: Self.serving)
        let s = try await connectOrStart(base, launch: launch)
        XCTAssertFalse(s.owned, "not provably a leftover of ours: attach, as before")
        XCTAssertNil(s.replacedOrphan)
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertTrue(bystander.isRunning, "the bystander survives")
    }

    func testOnlyALeftoverOfThisAppsOwnServerQualifies() throws {
        let sleep = Process()
        sleep.executableURL = URL(fileURLWithPath: "/bin/sleep")
        sleep.arguments = ["30"]
        try sleep.run()
        defer { sleep.terminate() }
        let facts = try XCTUnwrap(processFacts(sleep.processIdentifier))
        XCTAssertEqual(facts.uid, getuid())
        XCTAssertEqual(facts.ppid, UInt32(getpid()))
        XCTAssertFalse(isLeftoverSidecar(sleep.processIdentifier, executable: URL(fileURLWithPath: "/bin/sleep")), "its parent is alive")
        XCTAssertFalse(isLeftoverSidecar(getpid(), executable: URL(fileURLWithPath: "/bin/sleep")), "another executable")
        XCTAssertNil(processFacts(try deadPid()))
    }

    func testASidecarWhoseAppIsAliveIsLeftAlone() async throws {
        let port = try freePort()
        let base = URL(string: "http://127.0.0.1:\(port)")!
        let app = Process()
        app.executableURL = URL(fileURLWithPath: "/bin/sleep")
        app.arguments = ["30"]
        try app.run()
        defer { app.terminate() }
        let other = try await runLeftover(port: port, script: sidecarScript(parent: app.processIdentifier))
        let launch = try stubLaunch(port: port, script: Self.serving)
        let s = try await connectOrStart(base, launch: launch)
        XCTAssertFalse(s.owned, "another running copy's server: attach, never stop it")
        XCTAssertTrue(processExists(other))
    }

    func testOrphanRules() {
        let dead: (Int32) -> Bool = { _ in false }
        let alive: (Int32) -> Bool = { _ in true }
        XCTAssertTrue(ServerInfo(library: "/l", sidecar: true, parentPid: 500, pid: 900).isOrphan(ownPid: 700, isAlive: dead))
        XCTAssertFalse(ServerInfo(library: "/l", sidecar: true, parentPid: 500, pid: 900).isOrphan(ownPid: 700, isAlive: alive), "its app still runs")
        XCTAssertFalse(ServerInfo(library: "/l", sidecar: true, parentPid: 700, pid: 900).isOrphan(ownPid: 700, isAlive: dead), "this app's own")
        XCTAssertFalse(ServerInfo(library: "/l", sidecar: false, parentPid: nil, pid: 900).isOrphan(ownPid: 700, isAlive: dead), "bun run dev")
        XCTAssertFalse(ServerInfo(library: "/l").isOrphan(ownPid: 700, isAlive: dead), "an older server that doesn't say")
        XCTAssertTrue(processExists(getpid()))
    }

    func testStopKillsAServerThatIgnoresSigterm() async throws {
        let port = try freePort()
        let base = URL(string: "http://127.0.0.1:\(port)")!
        let launch = try stubLaunch(port: port, script: "process.on(\"SIGTERM\", () => {}); " + Self.serving)
        let s = try await connectOrStart(base, launch: launch)
        let t0 = Date()
        await s.stop()
        XCTAssertGreaterThan(Date().timeIntervalSince(t0), 2.5)
        let down = await probe(base)
        XCTAssertEqual(down, .none)
    }

    func testCrashNotice() async throws {
        let port = try freePort()
        let base = URL(string: "http://127.0.0.1:\(port)")!
        let launch = try stubLaunch(port: port, script: Self.serving)
        let s = try await connectOrStart(base, launch: launch)
        let crashed = expectation(description: "onExit")
        await MainActor.run { s.onExit = { _ in crashed.fulfill() } }
        kill(s.pid!, SIGKILL)
        await fulfillment(of: [crashed], timeout: 5)
    }

    func testServerThatDiesWhileStarting() async throws {
        let port = try freePort()
        let launch = try stubLaunch(port: port, script: "console.error(\"no library folder\"); process.exit(3);")
        do {
            _ = try await connectOrStart(URL(string: "http://127.0.0.1:\(port)")!, launch: launch)
            XCTFail("should throw")
        } catch let e as ServerError {
            XCTAssertTrue(e.localizedDescription.contains("stopped while starting"), e.localizedDescription)
            XCTAssertTrue(e.localizedDescription.contains("no library folder"), e.localizedDescription)
        }
    }

    func testServerThatNeverAnswers() async throws {
        let port = try freePort()
        let launch = try stubLaunch(port: port, script: "setInterval(() => {}, 1000);")
        do {
            _ = try await connectOrStart(URL(string: "http://127.0.0.1:\(port)")!, launch: launch, readyTimeout: 1.5)
            XCTFail("should throw")
        } catch let e as ServerError {
            XCTAssertTrue(e.localizedDescription.contains("didn't answer within"), e.localizedDescription)
        }
    }

    func testMissingExecutable() async throws {
        let port = try freePort()
        let launch = Launch(executable: tmp.appendingPathComponent("nope"), environment: [:], logFile: tmp.appendingPathComponent("log"))
        do {
            _ = try await connectOrStart(URL(string: "http://127.0.0.1:\(port)")!, launch: launch)
            XCTFail("should throw")
        } catch let e as ServerError {
            XCTAssertTrue(e.localizedDescription.contains("couldn't start"), e.localizedDescription)
        }
    }

    func testLogCap() throws {
        let log = tmp.appendingPathComponent("logs/server.log")
        capLog(log)
        try Data(count: 100).write(to: log)
        capLog(log, max: 1000)
        XCTAssertEqual(try Data(contentsOf: log).count, 100, "a small log is kept")
        try Data(count: 2000).write(to: log)
        capLog(log, max: 1000)
        XCTAssertEqual(try Data(contentsOf: log).count, 0, "a big log starts over")
    }
}
#endif
