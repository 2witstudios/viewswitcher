import XCTest

/// The demo on iPhone and iPad: with no Mac, a first launch opens the demo; tapping a view changes the program; the bar
/// leads back to the connector, which offers the demo again. Runs in the regular `xcodebuild test`:
/// VIEWSWITCHER_PROBE points the Mac probe at a closed port, since the simulator shares the Mac's
/// ports and 127.0.0.1:7420 there is the Mac's own switcher.
final class DemoTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func launch(_ env: [String: String] = [:]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["VIEWSWITCHER_RESET"] = "1"
        app.launchEnvironment["VIEWSWITCHER_PROBE"] = "http://127.0.0.1:9"
        for (k, v) in env { app.launchEnvironment[k] = v }
        app.launch()
        return app
    }

    func testFirstLaunchWithoutAMacOpensTheDemo() {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = launch()
        let web = app.webViews.firstMatch
        // (Guest cook's cover: on an iPhone held sideways the show's header is hidden.)
        XCTAssertTrue(web.switches["Guest cook"].waitForExistence(timeout: 20), "the demo opened by itself")
        XCTAssertTrue(web.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Demo'")).firstMatch.exists, "the demo bar says it's a demo")
        XCTAssertTrue(web.staticTexts.matching(NSPredicate(format: "label ==[c] 'On air'")).firstMatch.exists, "the tally (styled in capitals)")

        // Tap a view: the program now shows it (its name beside the tally; the covers are labelled buttons).
        // Tap a view: it goes on air (the cover is a toggle, aria-pressed) and the program shows its name.
        let cook = web.switches["Cook along"], guest = web.switches["Guest cook"]
        XCTAssertTrue(guest.waitForExistence(timeout: 5))
        XCTAssertEqual(cook.value as? String, "1", "the demo starts on Cook along")
        XCTAssertEqual(guest.value as? String, "0")
        XCTAssertTrue(web.staticTexts["Cook along"].waitForExistence(timeout: 5))
        guest.tap()
        XCTAssertTrue(web.staticTexts["Guest cook"].waitForExistence(timeout: 5), "the program cut to Guest cook")
        XCTAssertEqual(guest.value as? String, "1", "the tally moved to Guest cook")
        XCTAssertEqual(cook.value as? String, "0")

        // Leave for the connector; it offers the demo again, and doesn't bounce back by itself.
        web.buttons["Connect your Mac"].tap()
        let again = web.buttons["Try the demo"]
        XCTAssertTrue(again.waitForExistence(timeout: 10), "the connector offers the demo")
        sleep(3)
        XCTAssertTrue(again.exists, "the connector stays after leaving the demo")
        again.tap()
        XCTAssertTrue(web.switches["Guest cook"].waitForExistence(timeout: 10))
    }

    /// Connecting a Mac leaves the demo. Needs a server: scripts/ipad-shots.sh passes one on 7445
    /// (TEST_RUNNER_VIEWSWITCHER_MAC=http://127.0.0.1:7445); skipped otherwise.
    func testAMacAnsweringLeavesTheDemo() throws {
        guard let mac = ProcessInfo.processInfo.environment["VIEWSWITCHER_MAC"] else { throw XCTSkip("needs VIEWSWITCHER_MAC") }
        let app = launch(["VIEWSWITCHER_START": "demo", "VIEWSWITCHER_PROBE": mac])
        XCTAssertTrue(app.webViews.switches["REC"].firstMatch.waitForExistence(timeout: 20), "the real switcher opened")
    }
}
