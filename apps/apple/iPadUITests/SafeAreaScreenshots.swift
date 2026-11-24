import XCTest

/// MAC-13a screenshots of the iPad app in each orientation, against a server you name. Not part of
/// the regular test run (it needs a server): run it from scripts/ipad-shots.sh, which starts one on 7435.
///   TEST_RUNNER_VIEWSWITCHER_SERVER=http://127.0.0.1:7435 TEST_RUNNER_VIEWSWITCHER_SHOTS=<dir> xcodebuild test …
final class SafeAreaScreenshots: XCTestCase {
    func testOrientations() throws {
        let env = ProcessInfo.processInfo.environment
        guard let server = env["VIEWSWITCHER_SERVER"], let dir = env["VIEWSWITCHER_SHOTS"] else { throw XCTSkip("needs VIEWSWITCHER_SERVER and VIEWSWITCHER_SHOTS") }
        let app = XCUIApplication()
        app.launchEnvironment["VIEWSWITCHER_SERVER"] = server
        if let w = env["VIEWSWITCHER_WEB_WIDTH"] { app.launchEnvironment["VIEWSWITCHER_WEB_WIDTH"] = w }
        let prefix = env["VIEWSWITCHER_SHOTS_PREFIX"] ?? "ipad"
        for (name, orientation) in [("landscape", UIDeviceOrientation.landscapeLeft), ("portrait", .portrait)] {
            XCUIDevice.shared.orientation = orientation
            app.launch()
            XCTAssertTrue(app.webViews.staticTexts["Templates"].firstMatch.waitForExistence(timeout: 20), "the switcher loaded")
            sleep(2)
            let png = XCUIScreen.main.screenshot().pngRepresentation
            try png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(prefix)-\(name).png"))
            app.terminate()
        }
    }
}
