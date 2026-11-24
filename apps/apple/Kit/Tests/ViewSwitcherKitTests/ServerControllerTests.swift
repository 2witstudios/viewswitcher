#if os(macOS)
import Network
import XCTest
@testable import ViewSwitcherKit

/// MAC-11: probe, attach or own, stop only what it started, crash notice, start failures, log cap.
/// The "server" is a stub: an in-process HTTP listener, or `bun stub.ts` when the controller starts it.
final class ServerControllerTests: XCTestCase {
    /// A tiny HTTP server in this process that answers every request with `body`.
    final class Stub {
        let listener: NWListener
        let port: UInt16
        init(body: String, status: String = "200 OK", silent: Bool = false) throws {
            listener = try NWListener(using: .tcp, on: .any)
            let ready = DispatchSemaphore(value: 0)
            listener.stateUpdateHandler = { if case .ready = $0 { ready.signal() } }
            listener.newConnectionHandler = { c in
                c.start(queue: .global())
                guard !silent else { return } // holds the connection and never answers
                c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { _, _, _, _ in
                    let resp = "HTTP/1.1 \(status)\r\ncontent-type: application/json\r\ncontent-length: \(body.utf8.count)\r\nconnection: close\r\n\r\n\(body)"
                    c.send(content: Data(resp.utf8), completion: .contentProcessed { _ in c.cancel() })
                }
            }
            listener.start(queue: .global())
            _ = ready.wait(timeout: .now() + 5)
            port = listener.port!.rawValue
        }
        var base: URL { URL(string: "http://127.0.0.1:\(port)")! }
        deinit { listener.cancel() }
    }

    static let state = #"{"onAir":null,"obs":{"connected":false,"recording":false,"streaming":false},"obsSetup":null,"usb":{"enabled":false,"attached":false,"connected":false},"warnings":[]}"#

    /// A port nothing listens on: bind 127.0.0.1:0, read the port, close.
    func freePort() throws -> UInt16 {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        defer { close(fd) }
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        addr.sin_port = 0
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        let ok = withUnsafeMutablePointer(to: &addr) { p in
            p.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, len) == 0 && Darwin.getsockname(fd, $0, &len) == 0 }
        }
        guard ok else { throw XCTSkip("no free port") }
        return UInt16(bigEndian: addr.sin_port)
    }

    var tmp: URL!
    override func setUp() {
        tmp = FileManager.default.temporaryDirectory.appendingPathComponent("vs-kit-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
    }
    override func tearDown() { try? FileManager.default.removeItem(at: tmp) }

    var bun: URL? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let paths = (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map(String.init) + ["\(home)/.bun/bin", "/opt/homebrew/bin", "/usr/local/bin"]
        return paths.map { URL(fileURLWithPath: $0).appendingPathComponent("bun") }.first { FileManager.default.isExecutableFile(atPath: $0.path) }
    }

    /// A launch that runs a Bun stub server on `port` (its behaviour set by `script`).
    func stubLaunch(port: UInt16, script: String) throws -> Launch {
        guard let bun else { throw XCTSkip("bun isn't installed") }
        let file = tmp.appendingPathComponent("stub.ts")
        try script.write(to: file, atomically: true, encoding: .utf8)
        return Launch(executable: bun, arguments: [file.path], environment: ["PORT": String(port), "HOME": NSHomeDirectory()], logFile: tmp.appendingPathComponent("logs/server.log"))
    }

    static let serving = "Bun.serve({ hostname: \"127.0.0.1\", port: Number(process.env.PORT), fetch: () => Response.json(\(state)) }); console.log(\"stub up\");"

    func testProbe() async throws {
        let ours = try Stub(body: Self.state)
        let that = await probe(ours.base)
        XCTAssertEqual(that, .viewswitcher)
        let other = try Stub(body: "<html>hi</html>")
        let r1 = await probe(other.base)
        XCTAssertEqual(r1, .other)
        let silent = try Stub(body: "", silent: true)
        let r2 = await probe(silent.base, timeout: 0.5)
        XCTAssertEqual(r2, .other, "a port that holds the connection but never answers isn't free")
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

    func testStartsOwnsAndStops() async throws {
        let port = try freePort()
        let base = URL(string: "http://127.0.0.1:\(port)")!
        let launch = try stubLaunch(port: port, script: Self.serving)
        let s = try await connectOrStart(base, launch: launch)
        XCTAssertTrue(s.owned)
        var crashed = false
        await MainActor.run { s.onExit = { _ in crashed = true } }
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
