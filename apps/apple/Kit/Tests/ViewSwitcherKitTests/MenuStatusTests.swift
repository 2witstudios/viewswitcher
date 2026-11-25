import XCTest
@testable import ViewSwitcherKit

/// The menu-bar text (MAC-12), same cases as apps/mac/src/status.test.ts had.
final class MenuStatusTests: XCTestCase {
    let base = LiveState(obs: .init(connected: true), obsSetup: .init(scene: true, program: true, ground: true), usb: .init(enabled: true))

    func testNothingOnAir() {
        XCTAssertEqual(MenuStatus(base), MenuStatus(title: "", live: false, onAir: "Nothing on air", obs: "OBS: connected", ipad: "iPhone or iPad: not plugged in", obsReady: true))
    }

    func testOnAirShortensTheTitle() {
        var s = base
        s.onAir = .init(label: "Teaching with the whiteboard and camera")
        let m = MenuStatus(s)
        XCTAssertTrue(m.live)
        XCTAssertEqual(m.onAir, "On air: Teaching with the whiteboard and camera")
        XCTAssertEqual(m.title, "Teaching with the white…")
    }

    func testObsStates() {
        var off = base
        off.obs.connected = false
        off.obsSetup = nil
        XCTAssertEqual(MenuStatus(off).obs, "OBS: not connected")
        var unset = base
        unset.obsSetup = .init(scene: false, program: false, ground: false, missingDevices: ["Camera"])
        XCTAssertEqual(MenuStatus(unset).obs, "OBS: needs setup")
        XCTAssertFalse(MenuStatus(unset).obsReady)
        var devices = base
        devices.obsSetup?.missingDevices = ["iPad"]
        XCTAssertEqual(MenuStatus(devices).obs, "OBS: connected · add iPad")
        var live = base
        live.obs = .init(connected: true, recording: true, streaming: true)
        XCTAssertEqual(MenuStatus(live).obs, "OBS: connected · live, recording")
    }

    func testObsPasswordAndOrder() {
        var missing = base
        missing.obs = .init(connected: false, auth: "missing")
        XCTAssertEqual(MenuStatus(missing).obs, "OBS: needs a password")
        var wrong = base
        wrong.obs = .init(connected: false, auth: "wrong")
        XCTAssertEqual(MenuStatus(wrong).obs, "OBS: refused the password")
        // A source added above the program page covers every scene: setup is needed again.
        var covered = base
        covered.obsSetup?.ordered = false
        XCTAssertEqual(MenuStatus(covered).obs, "OBS: needs setup")
        XCTAssertFalse(MenuStatus(covered).obsReady)
    }

    func testDecodesWhatTheServerSendsNow() throws {
        let json = #"{"t":"state","state":{"onAir":{"path":"o/x.html","org":"o","label":"BRB","missing":true},"obs":{"connected":false,"recording":false,"streaming":false,"auth":"wrong"},"obsSetup":{"scene":true,"program":true,"ground":true,"ordered":false,"missingDevices":[]},"usb":{"enabled":false,"attached":false,"connected":false},"warnings":[],"agent":{"onAir":"never","lastSeen":null,"client":null}}}"#
        let state = try XCTUnwrap(ServerMessage.state(from: Data(json.utf8)))
        XCTAssertEqual(state.obs.auth, "wrong")
        XCTAssertEqual(state.obsSetup?.ordered, false)
        XCTAssertEqual(state.onAir?.label, "BRB")
        // And from a server from before these fields: still in order, no auth problem.
        let old = #"{"t":"state","state":{"onAir":null,"obs":{"connected":true,"recording":false,"streaming":false},"obsSetup":{"scene":true,"program":true,"ground":true,"missingDevices":[]}}}"#
        let before = try XCTUnwrap(ServerMessage.state(from: Data(old.utf8)))
        XCTAssertNil(before.obs.auth)
        XCTAssertTrue(before.obsSetup?.ready ?? false)
    }

    func testIPadStates() {
        var s = base
        s.usb = .init(enabled: true, attached: true, connected: true)
        XCTAssertEqual(MenuStatus(s).ipad, "iPad: connected over USB")
        s.usb = .init(enabled: true, attached: true, connected: false)
        XCTAssertEqual(MenuStatus(s).ipad, "iPad: plugged in · open ViewSwitcher on it")
        s.usb = .init(enabled: false)
        XCTAssertEqual(MenuStatus(s).ipad, "iPhone or iPad: USB link off")
        // PHONE-8: an iPhone plugged in is named as one.
        s.usb = .init(enabled: true, attached: true, connected: true, device: "iPhone")
        XCTAssertEqual(MenuStatus(s).ipad, "iPhone: connected over USB")
        s.usb = .init(enabled: true, attached: true, connected: false, device: "iPhone")
        XCTAssertEqual(MenuStatus(s).ipad, "iPhone: plugged in · open ViewSwitcher on it")
    }

    func testNoServer() {
        XCTAssertEqual(MenuStatus(nil).onAir, "Server not responding")
        XCTAssertFalse(MenuStatus(nil).live)
    }

    func testSetUpObsAsksWhileLive() {
        XCTAssertFalse(base.obsLive)
        var s = base
        s.obs.streaming = true
        XCTAssertTrue(s.obsLive)
        s.obs = .init(connected: true, recording: true)
        XCTAssertTrue(s.obsLive)
    }

    func testDecodesServerMessages() {
        let json = #"{"t":"state","state":{"onAir":{"path":"a/b.html","org":"a","label":"BRB"},"obs":{"connected":false,"recording":false,"streaming":false},"obsSetup":null,"usb":{"enabled":false,"attached":false,"connected":false},"warnings":[],"future":1}}"#
        let s = ServerMessage.state(from: Data(json.utf8))
        XCTAssertEqual(s?.onAir?.label, "BRB")
        XCTAssertNil(ServerMessage.state(from: Data(#"{"t":"build","build":"x"}"#.utf8)))
        XCTAssertNil(ServerMessage.state(from: Data("nonsense".utf8)))
    }
}
