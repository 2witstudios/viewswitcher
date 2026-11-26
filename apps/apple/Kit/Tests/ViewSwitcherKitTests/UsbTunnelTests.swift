import CryptoKit
import Foundation
import Network
import XCTest
@testable import ViewSwitcherKit

/// The USB-C tunnel with its two listeners on loopback: `mac` connections stand in for the Mac's
/// server dialing in over usbmuxd, `page` connections for the web view.
final class UsbTunnelTests: XCTestCase {
    /// One end of a TCP connection, with what it has read so far.
    final class Peer: @unchecked Sendable {
        let conn: NWConnection
        private let lock = NSLock()
        private var buffer = Data()
        private var ended = false
        private var failed = false

        init(port: NWEndpoint.Port) async throws {
            conn = NWConnection(host: "127.0.0.1", port: port, using: .tcp)
            let ready = AsyncStream<Bool> { c in
                conn.stateUpdateHandler = { state in
                    switch state {
                    case .ready: c.yield(true)
                    case .failed, .cancelled: c.yield(false)
                    default: break
                    }
                }
            }
            conn.start(queue: .global())
            var it = ready.makeAsyncIterator()
            guard await it.next() == true else { throw XCTSkip("couldn't connect to \(port)") }
            conn.stateUpdateHandler = { [weak self] state in
                switch state {
                case .failed, .cancelled: self?.lock.withLock { self?.failed = true }
                default: break
                }
            }
            read()
        }

        private func read() {
            conn.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { [weak self] data, _, complete, error in
                guard let self else { return }
                self.lock.withLock {
                    if let data { self.buffer.append(data) }
                    if complete { self.ended = true }
                    if error != nil { self.failed = true }
                }
                if !complete, error == nil { self.read() }
            }
        }

        var received: Data { lock.withLock { buffer } }
        /// The other side finished sending (a half-close or a close).
        var sawEnd: Bool { lock.withLock { ended || failed } }

        func send(_ s: String) { send(Data(s.utf8)) }
        func send(_ d: Data) { conn.send(content: d, completion: .contentProcessed { _ in }) }
        /// Done sending; still reading.
        func finish() { conn.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in }) }
        func close() { conn.cancel() }

        func text() -> String { String(decoding: received, as: UTF8.self) }
    }

    var tunnel: UsbTunnel!
    var mac: NWEndpoint.Port!
    var page: NWEndpoint.Port!

    func startTunnel(waitForTunnel: TimeInterval = 4) async throws {
        tunnel = UsbTunnel(localPort: .any, tunnelPort: .any, waitForTunnel: waitForTunnel)
        tunnel.start()
        let ok = await until { self.tunnel.boundPorts() != nil }
        guard ok, let ports = tunnel.boundPorts() else { return XCTFail("listeners didn't start") }
        page = ports.local
        mac = ports.tunnel
    }

    override func tearDown() {
        tunnel?.stop()
    }

    func until(_ timeout: TimeInterval = 5, _ check: @escaping () -> Bool) async -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if check() { return true }
            try? await Task.sleep(for: .milliseconds(20))
        }
        return check()
    }

    /// A tunnel from the Mac, idle in the pool.
    func idleTunnel() async throws -> Peer {
        let before = tunnel.counts().idle
        let t = try await Peer(port: mac)
        let pooled = await until { self.tunnel.counts().idle == before + 1 }
        XCTAssertTrue(pooled, "the tunnel joins the idle pool")
        return t
    }

    func testPipesBothWays() async throws {
        try await startTunnel()
        let mac = try await idleTunnel()
        let page = try await Peer(port: page)
        page.send("GET / HTTP/1.1\r\n\r\n")
        let got = await until { mac.text() == "GET / HTTP/1.1\r\n\r\n" }
        XCTAssertTrue(got, "the page's request reaches the Mac (\(mac.text()))")
        mac.send("HTTP/1.1 200 OK\r\n\r\n")
        let back = await until { page.text() == "HTTP/1.1 200 OK\r\n\r\n" }
        XCTAssertTrue(back, "the answer reaches the page")
        XCTAssertEqual(tunnel.counts().idle, 0)
        XCTAssertEqual(tunnel.counts().paired, 1)
    }

    func testThePageFinishingSendingLeavesTheAnswerFlowing() async throws {
        try await startTunnel()
        let mac = try await idleTunnel()
        let page = try await Peer(port: page)
        page.send("request")
        page.finish()
        let ended = await until { mac.text() == "request" && mac.sawEnd }
        XCTAssertTrue(ended, "the Mac gets the request, then the end of it")
        mac.send("a late answer")
        let late = await until { page.text() == "a late answer" }
        XCTAssertTrue(late, "the other direction is still open (\(page.text()))")
        XCTAssertFalse(page.sawEnd)
        mac.finish()
        let closed = await until { page.sawEnd && self.tunnel.counts().paired == 0 }
        XCTAssertTrue(closed, "once both directions have ended, the pair closes")
    }

    func testTheMacFinishingSendingLeavesTheRequestFlowing() async throws {
        try await startTunnel()
        let mac = try await idleTunnel()
        let page = try await Peer(port: page)
        page.send("hello")
        _ = await until { mac.text() == "hello" }
        mac.send("bye")
        mac.finish()
        let ended = await until { page.text() == "bye" && page.sawEnd }
        XCTAssertTrue(ended, "the page gets the answer and its end")
        page.send(" and more")
        let more = await until { mac.text() == "hello and more" }
        XCTAssertTrue(more, "the page can still send (\(mac.text()))")
        XCTAssertEqual(tunnel.counts().paired, 1)
        page.finish()
        let closed = await until { self.tunnel.counts().paired == 0 }
        XCTAssertTrue(closed)
    }

    func testAPageThatComesFirstWaitsForATunnel() async throws {
        try await startTunnel()
        let page = try await Peer(port: page)
        page.send("early request")
        let waiting = await until { self.tunnel.counts().waiting == 1 }
        XCTAssertTrue(waiting)
        let mac = try await Peer(port: mac)
        let got = await until { mac.text() == "early request" }
        XCTAssertTrue(got, "paired with the next tunnel (\(mac.text()))")
        XCTAssertEqual(tunnel.counts().waiting, 0)
    }

    func testAPageWithNoTunnelIsClosedAfterTheWait() async throws {
        try await startTunnel(waitForTunnel: 0.3)
        let page = try await Peer(port: page)
        let closed = await until(3) { page.sawEnd && self.tunnel.counts().waiting == 0 }
        XCTAssertTrue(closed)
    }

    func testBytesTheMacSendsBeforePairingArriveFirst() async throws {
        try await startTunnel()
        let mac = try await idleTunnel()
        mac.send("hello first")
        try await Task.sleep(for: .milliseconds(100))
        let page = try await Peer(port: page)
        let got = await until { page.text() == "hello first" }
        XCTAssertTrue(got, "(\(page.text()))")
        page.send("then this")
        let back = await until { mac.text() == "then this" }
        XCTAssertTrue(back)
    }

    func testAnIdleTunnelTheMacClosesLeavesThePool() async throws {
        try await startTunnel()
        let mac = try await idleTunnel()
        mac.close()
        let gone = await until { self.tunnel.counts().idle == 0 }
        XCTAssertTrue(gone)
        // The next page waits for a real tunnel rather than getting a dead one.
        _ = try await Peer(port: page)
        let waiting = await until { self.tunnel.counts().waiting == 1 }
        XCTAssertTrue(waiting)
    }

    func testOneSideFailingClosesBoth() async throws {
        try await startTunnel()
        let mac = try await idleTunnel()
        let page = try await Peer(port: page)
        page.send("x")
        _ = await until { mac.text() == "x" }
        // A reset, not a half-close: the connection failed.
        mac.conn.forceCancel()
        let closed = await until { page.sawEnd && self.tunnel.counts().paired == 0 }
        XCTAssertTrue(closed)
    }

    func testLargeTransfersArriveWholeAndInOrder() async throws {
        try await startTunnel()
        let mac = try await idleTunnel()
        let page = try await Peer(port: page)
        // Bigger than the socket buffers and many reads, both ways at once.
        let down = Data((0..<(12 << 20)).map { UInt8(truncatingIfNeeded: $0 &* 31 &+ 7) })
        let up = Data((0..<(3 << 20)).map { UInt8(truncatingIfNeeded: $0 &* 17 &+ 3) })
        mac.send(down)
        page.send(up)
        mac.finish()
        page.finish()
        let done = await until(20) { page.received.count == down.count && mac.received.count == up.count }
        XCTAssertTrue(done, "\(page.received.count) of \(down.count) down, \(mac.received.count) of \(up.count) up, page ended \(page.sawEnd), mac ended \(mac.sawEnd), \(tunnel.counts())")
        XCTAssertEqual(SHA256.hash(data: page.received), SHA256.hash(data: down))
        XCTAssertEqual(SHA256.hash(data: mac.received), SHA256.hash(data: up))
        let closed = await until { self.tunnel.counts().paired == 0 }
        XCTAssertTrue(closed)
    }

    func testStopClosesEverything() async throws {
        try await startTunnel()
        let idle = try await idleTunnel()
        let mac = try await idleTunnel()
        let page = try await Peer(port: page)
        page.send("x")
        _ = await until { mac.text() == "x" || idle.text() == "x" }
        tunnel.stop()
        let closed = await until { page.sawEnd && mac.sawEnd && idle.sawEnd }
        XCTAssertTrue(closed)
        XCTAssertEqual(tunnel.counts().idle + tunnel.counts().paired + tunnel.counts().waiting, 0)
    }
}
