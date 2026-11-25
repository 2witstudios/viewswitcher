import XCTest

/// MAC-13a screenshots of the iPad app in each orientation (Split View widths). Not part of the regular test run:
/// scripts/ipad-shots.sh runs it with a scratch server on 7445 (never the Mac's 7420).
///   TEST_RUNNER_VIEWSWITCHER_SERVER=http://127.0.0.1:7445 TEST_RUNNER_VIEWSWITCHER_SHOTS=<dir> xcodebuild test …
final class SafeAreaScreenshots: XCTestCase {
    private let orientations: [(String, UIDeviceOrientation)] = [("landscape", .landscapeLeft), ("portrait", .portrait)]

    /// Upright pixels: the raw screenshot is always portrait, so landscape is redrawn to 2752×2064.
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
        app.launchEnvironment["VIEWSWITCHER_SERVER"] = server
        // If the server drops, the connector probes this one, never the Mac's own 127.0.0.1:7420.
        app.launchEnvironment["VIEWSWITCHER_PROBE"] = server
        if let w = env["VIEWSWITCHER_WEB_WIDTH"] { app.launchEnvironment["VIEWSWITCHER_WEB_WIDTH"] = w }
        let prefix = env["VIEWSWITCHER_SHOTS_PREFIX"] ?? "ipad"
        for (name, orientation) in orientations {
            XCUIDevice.shared.orientation = orientation
            app.launch()
            // The sidebar's Templates, or at a narrow width the Library button that opens it.
            let loaded = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label IN {'Templates', 'Library'}")).firstMatch
            XCTAssertTrue(loaded.waitForExistence(timeout: 20), "the switcher loaded")
            sleep(2)
            try save(dir, "\(prefix)-\(name)")
            app.terminate()
        }
    }

    /// The demo (MAC-18), with a view taken so the program and tally have moved.
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
            try save(dir, "demo-\(name)")
            app.terminate()
        }
    }
}
