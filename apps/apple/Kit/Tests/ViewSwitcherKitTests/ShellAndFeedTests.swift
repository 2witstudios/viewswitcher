import XCTest
@testable import ViewSwitcherKit

final class ShellAndFeedTests: XCTestCase {
    /// MAC-15: Sparkle reads the appcast from the latest published release, next to the dmg the site links to.
    func testAppcastURL() {
        XCTAssertEqual(UpdateFeed.appcast.absoluteString, "https://github.com/2witstudios/viewswitcher/releases/latest/download/appcast.xml")
        XCTAssertEqual(UpdateFeed.dmg.absoluteString, "https://github.com/2witstudios/viewswitcher/releases/latest/download/ViewSwitcher.dmg")
        XCTAssertEqual(UpdateFeed.downloadPrefix(version: "0.2.0").absoluteString, "https://github.com/2witstudios/viewswitcher/releases/download/v0.2.0/")
    }

    /// The bundle's Info.plist must carry the same feed (checked by the e2e against the built app too).
    func testShellInsetsGoAwayInFullScreen() {
        let windowed = ShellInfo.mac(lightsInset: 84.4, headerRow: 64, dragStrip: 28, fullscreen: false)
        XCTAssertEqual(windowed.vars, ["--shell-lights": "84px", "--shell-header": "64px", "--shell-drag": "28px"])
        let full = ShellInfo.mac(lightsInset: 84, headerRow: 64, dragStrip: 28, fullscreen: true)
        XCTAssertEqual(full.vars, ["--shell-lights": "0px", "--shell-header": "0px", "--shell-drag": "0px"])
        XCTAssertTrue(ShellBridge.applyScript(full).contains(#""fullscreen":true"#))
    }

    func testShellScriptQuotesValues() {
        let info = ShellInfo(kind: .ipad, vars: ["--x": "a\"b</script>"])
        XCTAssertTrue(ShellBridge.userScript(info).contains(#""--x":"a\"b<\/script>""#) || ShellBridge.userScript(info).contains(#""--x":"a\"b</script>""#))
        XCTAssertTrue(ShellBridge.userScript(info).contains(#"{"kind":"ipad""#))
    }

    func testUndoScripts() {
        XCTAssertTrue(ShellBridge.forwardUndoScript(redo: false).contains("shiftKey: false"))
        XCTAssertTrue(ShellBridge.forwardUndoScript(redo: true).contains("shiftKey: true"))
    }
}
