import XCTest

/// Safe-area screenshots of the app on iPad or iPhone in each orientation. Not part of
/// the regular test run: scripts/ipad-shots.sh runs it with a scratch server on 7445 (never the Mac's 7420).
/// VIEWSWITCHER_SHOTS_PATH opens a page of that server (the iPhone shots use a stream: the deck).
///   TEST_RUNNER_VIEWSWITCHER_SERVER=http://127.0.0.1:7445 TEST_RUNNER_VIEWSWITCHER_SHOTS=<dir> xcodebuild test …
final class SafeAreaScreenshots: XCTestCase {
    private let orientations: [(String, UIDeviceOrientation)] = [("landscape", .landscapeLeft), ("portrait", .portrait)]

    /// Upright pixels: the raw screenshot is redrawn as the screen stands (2752×2064 on the 13-inch iPad sideways).
    private func save(_ dir: String, _ name: String) throws {
        let shot = XCUIScreen.main.screenshot().image
        let format = UIGraphicsImageRendererFormat()
        format.scale = shot.scale
        format.opaque = true
        let png = UIGraphicsImageRenderer(size: shot.size, format: format).pngData { _ in shot.draw(at: .zero) }
        try png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }

    /// The real switcher, against the server you name.
    func testOrientations() throws {
        let env = ProcessInfo.processInfo.environment
        guard let server = env["VIEWSWITCHER_SERVER"], let dir = env["VIEWSWITCHER_SHOTS"] else { throw XCTSkip("needs VIEWSWITCHER_SERVER and VIEWSWITCHER_SHOTS") }
        let app = XCUIApplication()
        app.launchEnvironment["VIEWSWITCHER_SERVER"] = server + (env["VIEWSWITCHER_SHOTS_PATH"] ?? "")
        // If the server drops, the connector probes this one, never the Mac's own 127.0.0.1:7420.
        app.launchEnvironment["VIEWSWITCHER_PROBE"] = server
        if let w = env["VIEWSWITCHER_WEB_WIDTH"] { app.launchEnvironment["VIEWSWITCHER_WEB_WIDTH"] = w }
        let prefix = env["VIEWSWITCHER_SHOTS_PREFIX"] ?? "ipad"
        for (name, orientation) in orientations {
            XCUIDevice.shared.orientation = orientation
            app.launch()
            // REC (a toggle, so a switch): in the live bar on every screen (on a phone the library, with Templates, is folded away).
            XCTAssertTrue(app.webViews.switches["REC"].firstMatch.waitForExistence(timeout: 20), "the switcher loaded")
            sleep(3)
            try save(dir, "\(prefix)-\(name)")
            app.terminate()
        }
    }

    /// The demo, with a view taken so the program and tally have moved.
    func testDemo() throws {
        let env = ProcessInfo.processInfo.environment
        guard let dir = env["VIEWSWITCHER_SHOTS"], env["VIEWSWITCHER_WEB_WIDTH"] == nil else { throw XCTSkip("needs VIEWSWITCHER_SHOTS, full width") }
        let app = XCUIApplication()
        app.launchEnvironment["VIEWSWITCHER_START"] = "demo"
        app.launchEnvironment["VIEWSWITCHER_PROBE"] = "http://127.0.0.1:9"
        for (name, orientation) in orientations {
            XCUIDevice.shared.orientation = orientation
            app.launch()
            let web = app.webViews.firstMatch
            XCTAssertTrue(web.switches["Guest cook"].waitForExistence(timeout: 20), "the demo loaded")
            web.switches["Guest cook"].tap()
            sleep(2)
            let prefix = env["VIEWSWITCHER_SHOTS_PREFIX"].flatMap { $0 == "ipad" ? nil : $0 }
            try save(dir, [prefix, "demo", name].compactMap { $0 }.joined(separator: "-"))
            app.terminate()
        }
    }
}
