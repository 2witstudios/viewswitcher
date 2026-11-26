#if os(macOS)
import XCTest
@testable import ViewSwitcherKit

/// What the menu-bar menu lists in each state of the server.
final class StatusMenuTests: XCTestCase {
    let live = LiveState(obs: .init(connected: true), obsSetup: .init(scene: true, program: true, ground: true), usb: .init(enabled: true))

    func context(_ server: ServerState, live: LiveState? = nil, wifi: Bool = false) -> StatusMenu.Context {
        StatusMenu.Context(status: MenuStatus(server.running ? (live ?? self.live) : nil), server: server, obsConnected: server.running, wifi: wifi, updater: true, openAtLogin: false)
    }

    func titles(_ items: [StatusMenu.Item]) -> [String] { items.compactMap(\.title) }

    func enabled(_ items: [StatusMenu.Item]) -> [String] {
        items.compactMap { if case .action(let t, _, true, _, _) = $0 { t } else { nil } }
    }

    func testRunningItsOwnServer() {
        let items = StatusMenu.items(context(.owned, wifi: true))
        XCTAssertEqual(titles(items), [
            "Nothing on air", "OBS: connected", "iPhone or iPad: not plugged in",
            "Open ViewSwitcher", "Edit with AI…", "Open in Browser", "Open Library Folder", "Set Up OBS Again",
            StatusMenu.wifiTitle, "Phones and Tablets…",
            "Check for Updates…", "Open at Login", "Show Server Log",
            "Quit ViewSwitcher",
        ])
        XCTAssertTrue(enabled(items).contains(StatusMenu.wifiTitle))
        XCTAssertTrue(items.contains(.action(StatusMenu.wifiTitle, .toggleWifi, enabled: true, checked: true, toolTip: RemoteText.help)))
    }

    func testAttachedQuitLeavesItRunningAndPairingIsOff() {
        let items = StatusMenu.items(context(.attached))
        XCTAssertTrue(titles(items).contains("Quit ViewSwitcher (server keeps running)"))
        XCTAssertFalse(enabled(items).contains(StatusMenu.wifiTitle), "pairing needs the app's own server")
        XCTAssertFalse(enabled(items).contains("Phones and Tablets…"))
        XCTAssertFalse(titles(items).contains("Restart Server"))
    }

    func testRestartingSaysSoAndOffersNothingToClick() {
        let items = StatusMenu.items(context(.restarting(attempt: 1, exitCode: 9)))
        XCTAssertEqual(titles(items).first, "Server stopped: restarting…")
        XCTAssertTrue(titles(items).contains("Restarting Server…"))
        XCTAssertFalse(enabled(items).contains("Restarting Server…"))
        XCTAssertFalse(enabled(items).contains("Open in Browser"))
        XCTAssertTrue(enabled(items).contains("Open ViewSwitcher"))
        XCTAssertEqual(titles(StatusMenu.items(context(.restarting(attempt: 2, exitCode: 9)))).first, "Server stopped again: restarting…")
    }

    func testGivenUpOffersRestartServer() {
        for state in [ServerState.crashed(1), .lost, .failed(.startFailed("x"))] {
            let items = StatusMenu.items(context(state))
            XCTAssertTrue(enabled(items).contains("Restart Server"), "\(state)")
            XCTAssertNotNil(StatusMenu.serverLine(state))
            XCTAssertEqual(titles(items).first, StatusMenu.serverLine(state))
            XCTAssertEqual(titles(items).last, "Quit ViewSwitcher")
        }
    }

    func testStartingIsNotARestartButton() {
        let items = StatusMenu.items(context(.starting))
        XCTAssertTrue(titles(items).contains("Starting Server…"))
        XCTAssertFalse(enabled(items).contains("Starting Server…"))
        XCTAssertFalse(titles(items).contains("Restart Server"))
    }

    func testSetUpOBSWaitsForOBS() {
        var c = context(.owned)
        c.obsConnected = false
        XCTAssertFalse(enabled(StatusMenu.items(c)).contains("Set Up OBS Again"))
    }
}
#endif
