#if os(macOS)
import Foundation
import Network
import XCTest
@testable import ViewSwitcherKit

/// Servers for the tests: an HTTP stub in this process, or a Bun stub script the controller starts.
enum TestServers {
    /// A tiny HTTP server in this process. It answers each request with `answer(request text)`, keeps
    /// what it was sent, and can hold connections without answering (always, or for a while at first).
    final class Stub: @unchecked Sendable {
        let listener: NWListener
        let port: UInt16
        private let log = Requests()
        /// Every request it was sent, as text.
        var requests: [String] { log.all }

        final class Requests: @unchecked Sendable {
            private let lock = NSLock()
            private var seen: [String] = []
            var all: [String] { lock.withLock { seen } }
            func add(_ r: String) { lock.withLock { seen.append(r) } }
        }

        convenience init(body: String, status: String = "200 OK", silent: Bool = false, silentFor: TimeInterval = 0) throws {
            try self.init(silent: silent, silentFor: silentFor) { _ in (status, body) }
        }

        init(silent: Bool = false, silentFor: TimeInterval = 0, answer: @escaping @Sendable (String) -> (status: String, body: String)) throws {
            listener = try NWListener(using: .tcp, on: .any)
            let ready = DispatchSemaphore(value: 0)
            let answersFrom = Date().addingTimeInterval(silentFor)
            listener.stateUpdateHandler = { if case .ready = $0 { ready.signal() } }
            let log = log
            listener.newConnectionHandler = { c in
                c.start(queue: .global())
                // Holds the connection and never answers.
                guard !silent, Date() >= answersFrom else { return }
                Self.readRequest(c) { request in
                    log.add(request)
                    let (status, body) = answer(request)
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

        /// The headers and, by content-length, the body (a client may send them separately).
        private static func readRequest(_ c: NWConnection, soFar: Data = Data(), done: @escaping @Sendable (String) -> Void) {
            c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, complete, error in
                let all = soFar + (data ?? Data())
                let text = String(decoding: all, as: UTF8.self)
                if let split = text.range(of: "\r\n\r\n") {
                    let length = text[..<split.lowerBound].split(separator: "\r\n")
                        .first { $0.lowercased().hasPrefix("content-length:") }
                        .flatMap { Int($0.split(separator: ":")[1].trimmingCharacters(in: .whitespaces)) } ?? 0
                    if text[split.upperBound...].utf8.count >= length { return done(text) }
                }
                if complete || error != nil { return done(text) }
                readRequest(c, soFar: all, done: done)
            }
        }
    }

    /// What /api/state answers, as far as `probe` looks.
    static let state = #"{"onAir":null,"obs":{"connected":false,"recording":false,"streaming":false},"obsSetup":null,"usb":{"enabled":false,"attached":false,"connected":false},"warnings":[]}"#

    /// A Bun stub that answers every request like a ViewSwitcher server's /api/state.
    static let serving = "Bun.serve({ hostname: \"127.0.0.1\", port: Number(process.env.PORT), fetch: () => Response.json(\(state)) }); console.log(\"stub up\");"

    /// A port nothing listens on: bind 127.0.0.1:0, read the port, close.
    static func freePort() throws -> UInt16 {
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

    static var bun: URL? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let paths = (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map(String.init) + ["\(home)/.bun/bin", "/opt/homebrew/bin", "/usr/local/bin"]
        return paths.map { URL(fileURLWithPath: $0).appendingPathComponent("bun") }.first { FileManager.default.isExecutableFile(atPath: $0.path) }
    }

    static func tempDir() -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("vs-kit-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// A launch that runs a Bun stub server on `port` (its behaviour set by `script`), logging in `dir`.
    static func launch(port: UInt16, script: String, in dir: URL, name: String = "stub.ts", env: [String: String] = [:]) throws -> Launch {
        guard let bun else { throw XCTSkip("bun isn't installed") }
        let file = dir.appendingPathComponent(name)
        try script.write(to: file, atomically: true, encoding: .utf8)
        return Launch(executable: bun, arguments: [file.path], environment: ["PORT": String(port), "HOME": NSHomeDirectory()].merging(env) { $1 }, logFile: dir.appendingPathComponent("logs/server.log"))
    }
}
#endif
