#if os(macOS)
import XCTest
@testable import ViewSwitcherKit

/// The app's typed server calls against a stub that answers as the server would.
final class ServerAPITests: XCTestCase {
    func testInfoReadsWhatTheAppNeedsAndIgnoresTheRest() async throws {
        let stub = try TestServers.Stub(body: #"{"library":"/Users/me/ViewSwitcher Library","port":7420,"sidecar":true,"parentPid":501,"pid":777,"claudeCode":"cd x && claude","stdio":"y"}"#)
        let info = try await ServerAPI(base: stub.base).info()
        XCTAssertEqual(info, ServerInfo(library: "/Users/me/ViewSwitcher Library", port: 7420, sidecar: true, parentPid: 501, pid: 777))
        XCTAssertTrue(stub.requests.first?.hasPrefix("GET /api/info ") == true)
    }

    func testAnOlderServerWithoutTheSidecarFieldsStillReads() async throws {
        let stub = try TestServers.Stub(body: #"{"library":"/lib","port":7420}"#)
        let info = try await ServerAPI(base: stub.base).info()
        XCTAssertNil(info.sidecar)
        XCTAssertFalse(info.isOrphan())
    }

    func testSetUpObsPostsJSONAndReadsTheReport() async throws {
        let stub = try TestServers.Stub(body: #"{"log":["made the scene"],"missing":["Camera"],"switched":false,"warnings":[]}"#)
        let r = try await ServerAPI(base: stub.base).setUpObs()
        XCTAssertEqual(r, ObsSetupResult(missing: ["Camera"], switched: false))
        let req = try XCTUnwrap(stub.requests.first)
        XCTAssertTrue(req.hasPrefix("POST /api/obs/setup "), req)
        XCTAssertTrue(req.lowercased().contains("content-type: application/json"), "JSON, so no other site can send it without a preflight")
    }

    func testARefusalCarriesTheServersReason() async throws {
        let stub = try TestServers.Stub(body: #"{"error":"OBS isn't connected."}"#, status: "503 Service Unavailable")
        do {
            _ = try await ServerAPI(base: stub.base).setUpObs()
            XCTFail("should throw")
        } catch let e as ServerAPIError {
            XCTAssertEqual(e, .refused(status: 503, message: "OBS isn't connected."))
            XCTAssertEqual(e.localizedDescription, "OBS isn't connected.")
        }
    }

    func testARefusalWithoutAReason() async throws {
        let stub = try TestServers.Stub(body: "<html>oops</html>", status: "500 Internal Server Error")
        do {
            _ = try await ServerAPI(base: stub.base).info()
            XCTFail("should throw")
        } catch let e as ServerAPIError {
            XCTAssertEqual(e.localizedDescription, "The server said no (500).")
        }
    }

    func testAnAnswerThatDoesntFit() async throws {
        let stub = try TestServers.Stub(body: #"{"nothing":"useful"}"#)
        do {
            _ = try await ServerAPI(base: stub.base).info()
            XCTFail("should throw")
        } catch let e as ServerAPIError {
            XCTAssertEqual(e, .unreadable("ServerInfo"))
        }
    }

    func testPairingCallsSendTheAppsSecret() async throws {
        let stub = try TestServers.Stub(body: #"{"enabled":true,"port":7420,"urls":["http://mac.local:7420"],"devices":[]}"#)
        let api = ServerAPI(base: stub.base, adminToken: "s3cret")
        let s = try await api.setRemoteEnabled(true)
        XCTAssertTrue(s.enabled)
        let req = try XCTUnwrap(stub.requests.first)
        XCTAssertTrue(req.hasPrefix("POST /api/remote "), req)
        XCTAssertTrue(req.lowercased().contains("x-viewswitcher-admin: s3cret"))
        XCTAssertTrue(req.hasSuffix(#"{"enabled":true}"#), req)
        // Other calls never carry it.
        _ = try? await ServerAPI(base: stub.base, adminToken: "s3cret").info()
        XCTAssertFalse(stub.requests.last!.lowercased().contains("x-viewswitcher-admin"))
    }

    func testPairingWithAServerThisAppDidntStart() async throws {
        let stub = try TestServers.Stub(body: #"{"error":"Not found"}"#, status: "404 Not Found")
        do {
            _ = try await ServerAPI(base: stub.base, adminToken: "x").remoteStatus()
            XCTFail("should throw")
        } catch {
            XCTAssertEqual(error.localizedDescription, ServerAPI.pairingNeedsOwnServer)
        }
    }
}
#endif
