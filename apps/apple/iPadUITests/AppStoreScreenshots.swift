import XCTest

/// The App Store screenshots (MAC-19): the real app on a real-looking show, OBS connected and live.
/// Not part of the regular test run: scripts/ipad-shots.sh seeds a scratch server (never the Mac's 7420)
/// with a fake OBS, runs this, and captures each screen with `simctl io screenshot` (with the clean
/// status bar) when this test says it's ready:
///   it writes `<dir>/.shot-<name>` holding the orientation, and waits until the script deletes it.
///   TEST_RUNNER_VIEWSWITCHER_SERVER=http://127.0.0.1:7445 TEST_RUNNER_VIEWSWITCHER_SHOTS=<dir>
///   TEST_RUNNER_VIEWSWITCHER_FULLCOUNT=/full-count/p/… TEST_RUNNER_VIEWSWITCHER_GRACE=/grace-community/p/…
final class AppStoreScreenshots: XCTestCase {
    private var env: [String: String] { ProcessInfo.processInfo.environment }
    private var app: XCUIApplication!

    override func setUp() { continueAfterFailure = false }
    override func tearDown() { app?.terminate() }

    /// Hands the screen to the script, which captures it, and waits until it has.
    private func shot(_ name: String, _ orientation: String) throws {
        let dir = try XCTUnwrap(env["VIEWSWITCHER_SHOTS"])
        sleep(2) // fonts, scene frames and the last tally settle
        let marker = URL(fileURLWithPath: dir).appendingPathComponent(".shot-\(name)")
        try orientation.write(to: marker, atomically: true, encoding: .utf8)
        let deadline = Date().addingTimeInterval(60)
        while FileManager.default.fileExists(atPath: marker.path) {
            XCTAssertLessThan(Date(), deadline, "the script captured \(name)")
            usleep(200_000)
        }
    }

    private func launch(_ orientation: UIDeviceOrientation, path: String) throws -> XCUIElement {
        let server = try XCTUnwrap(env["VIEWSWITCHER_SERVER"], "needs VIEWSWITCHER_SERVER")
        XCUIDevice.shared.orientation = orientation
        app = XCUIApplication()
        app.launchEnvironment["VIEWSWITCHER_SERVER"] = server + path
        // If the server drops, the connector probes this one, never the Mac's own 127.0.0.1:7420.
        app.launchEnvironment["VIEWSWITCHER_PROBE"] = server
        app.launch()
        return app.webViews.firstMatch
    }

    /// Tap a view's cover: it goes on air, and OBS switches.
    private func takeView(_ web: XCUIElement, _ label: String) {
        let cover = web.buttons["Put \(label) on air"].firstMatch
        XCTAssertTrue(cover.waitForExistence(timeout: 20), "the \(label) cover")
        let pill = web.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "On air: \(label)")).firstMatch
        if !pill.waitForExistence(timeout: 2) { cover.tap() }
        XCTAssertTrue(pill.waitForExistence(timeout: 10), "\(label) went on air")
    }

    func testShots() throws {
        guard env["VIEWSWITCHER_SHOTS"] != nil, let fullCount = env["VIEWSWITCHER_FULLCOUNT"], let grace = env["VIEWSWITCHER_GRACE"] else {
            throw XCTSkip("run by scripts/ipad-shots.sh")
        }

        // 1. The stream page in landscape, Both hosts on air.
        var web = try launch(.landscapeLeft, path: fullCount)
        takeView(web, "Both hosts")
        try shot("1-stream-landscape", "landscape")

        // 2. The editor on the view that's on air, retyping the episode title live.
        web.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND label ENDSWITH %@", "Edit Both hosts", "on air")).firstMatch.tap()
        let title = web.staticTexts["TRADE DEADLINE: WINNERS AND LOSERS"].firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 20), "the editor opened")
        sleep(1)
        // The scene sits under the editor's own layer, so tap where the title is: a double tap edits its
        // text in place (all of it selected), then type over it.
        title.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).doubleTap()
        sleep(1)
        app.typeText("TRADE DEADLINE: WHO WON?")
        XCTAssertTrue(web.staticTexts["TRADE DEADLINE: WHO WON?"].firstMatch.waitForExistence(timeout: 5), "the title was retyped")
        // Hide the keyboard so the whole view shows: the text stays in edit, with its Save bar.
        let hide = app.keyboards.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'hide keyboard' OR label CONTAINS[c] 'dismiss'")).firstMatch
        if hide.exists { hide.tap() }
        try shot("2-editor-landscape", "landscape")
        app.terminate()

        // 3. Template sets: the built-in ones under Add templates.
        web = try launch(.landscapeLeft, path: fullCount.components(separatedBy: "/p/")[0] + "/templates")
        let add = web.buttons["Add templates"].firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 20))
        let nova = web.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'NOVA_PLAYS'")).firstMatch
        for _ in 0..<3 where !nova.exists {
            sleep(2) // the page's library has loaded
            add.tap()
            _ = nova.waitForExistence(timeout: 8)
        }
        XCTAssertTrue(nova.exists, "the built-in sets")
        let loading = web.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Loading'")).firstMatch
        for _ in 0..<40 where loading.exists { usleep(250_000) } // every set staged, its cover drawn
        sleep(2)
        try shot("3-templates-landscape", "landscape")
        app.terminate()

        // 4. Portrait, another show: Grace Community with the sermon on air.
        web = try launch(.portrait, path: grace)
        takeView(web, "Sermon")
        try shot("4-stream-portrait", "portrait")
        app.terminate()

        // 5. The demo, as App Review sees it with no Mac: a view taken.
        XCUIDevice.shared.orientation = .landscapeLeft
        app = XCUIApplication()
        app.launchEnvironment["VIEWSWITCHER_START"] = "demo"
        app.launchEnvironment["VIEWSWITCHER_PROBE"] = "http://127.0.0.1:9"
        app.launch()
        web = app.webViews.firstMatch
        XCTAssertTrue(web.switches["Guest cook"].waitForExistence(timeout: 20), "the demo loaded")
        web.switches["Guest cook"].tap()
        try shot("5-demo-landscape", "landscape")
    }
}
