import XCTest
@testable import ViewSwitcherKit

/// MAC-13 and MAC-14: where each web view may go.
final class NavigationPolicyTests: XCTestCase {
    let server = URL(string: "http://127.0.0.1:7435")!
    func u(_ s: String) -> URL { URL(string: s)! }

    func testMacMainFrameStaysOnTheServer() {
        XCTAssertEqual(NavigationPolicy.mac(u("http://127.0.0.1:7435/daisy/edit"), server: server, mainFrame: true), .allow)
        XCTAssertEqual(NavigationPolicy.mac(u("about:blank"), server: server, mainFrame: true), .allow)
        // Same host, another port, or localhost instead of 127.0.0.1: not the server.
        XCTAssertEqual(NavigationPolicy.mac(u("http://127.0.0.1:7420/"), server: server, mainFrame: true), .openInBrowser(u("http://127.0.0.1:7420/")))
        XCTAssertEqual(NavigationPolicy.mac(u("https://example.com/a"), server: server, mainFrame: true), .openInBrowser(u("https://example.com/a")))
    }

    func testMacRefusesOtherSchemes() {
        for s in ["file:///System/Applications/Calculator.app", "x-apple.systempreferences:com.apple.preference.security", "javascript:alert(1)", "ftp://example.com/", "viewswitcher://connector/"] {
            XCTAssertEqual(NavigationPolicy.mac(u(s), server: server, mainFrame: true), .deny, s)
            XCTAssertEqual(NavigationPolicy.mac(u(s), server: server, mainFrame: true, newWindow: true), .deny, s)
        }
    }

    func testMacNewWindowsGoToTheBrowser() {
        XCTAssertEqual(NavigationPolicy.mac(u("https://example.com/"), server: server, mainFrame: true, newWindow: true), .openInBrowser(u("https://example.com/")))
        // Even the server itself: the app has one window.
        XCTAssertEqual(NavigationPolicy.mac(u("http://127.0.0.1:7435/program"), server: server, mainFrame: true, newWindow: true), .openInBrowser(u("http://127.0.0.1:7435/program")))
    }

    /// MCP-10: Add to Cursor opens Cursor's install link, and no other cursor: URL or app scheme.
    func testMacOpensCursorsMcpInstallLinkOnly() {
        let install = u("cursor://anysphere.cursor-deeplink/mcp/install?name=viewswitcher&config=eyJ1cmwiOiJodHRwOi8vMTI3LjAuMC4xOjc0MjAvbWNwIn0%3D")
        XCTAssertTrue(NavigationPolicy.isCursorInstall(install))
        XCTAssertEqual(NavigationPolicy.mac(install, server: server, mainFrame: true, fromSwitcher: true), .openInBrowser(install))
        XCTAssertEqual(NavigationPolicy.mac(install, server: server, mainFrame: true, newWindow: true, fromSwitcher: true), .openInBrowser(install))
        XCTAssertEqual(NavigationPolicy.mac(install, server: server, mainFrame: false, fromSwitcher: true), .deny, "never into a frame")
        for s in ["cursor://anysphere.cursor-deeplink/prompt?text=x", "cursor://file/etc/passwd", "cursor://evil.example/mcp/install?config=x", "vscode:mcp/install?{}", "claude://x"] {
            XCTAssertEqual(NavigationPolicy.mac(u(s), server: server, mainFrame: true, fromSwitcher: true), .deny, s)
            XCTAssertEqual(NavigationPolicy.mac(u(s), server: server, mainFrame: true, newWindow: true, fromSwitcher: true), .deny, s)
        }
        XCTAssertEqual(NavigationPolicy.iPad(install, mainFrame: true), .deny, "the iPad has nothing to install")
    }

    /// /code-review #3: a scene can't open Cursor's install dialog, only the switcher's own page can.
    func testCursorInstallOnlyWhenTheSwitcherStartedIt() {
        let install = u("cursor://anysphere.cursor-deeplink/mcp/install?name=x&config=eyJjb21tYW5kIjoic2gifQ%3D%3D")
        // Not started by the switcher (the default): refused, in the window or as a new window.
        XCTAssertEqual(NavigationPolicy.mac(install, server: server, mainFrame: true), .deny)
        XCTAssertEqual(NavigationPolicy.mac(install, server: server, mainFrame: true, newWindow: true), .deny)
        // Web pages still open in the browser whoever starts them.
        XCTAssertEqual(NavigationPolicy.mac(u("https://example.com/"), server: server, mainFrame: true), .openInBrowser(u("https://example.com/")))

        let started = { (source: String?, main: Bool) in
            NavigationPolicy.startedBySwitcher(source: source.map(self.u), sourceMainFrame: main, server: self.server)
        }
        XCTAssertTrue(started("http://127.0.0.1:7435/my-channel/templates#ai", true), "Edit with AI's button")
        XCTAssertTrue(started("http://127.0.0.1:7435/", true))
        XCTAssertFalse(started("http://127.0.0.1:7435/library/my-channel/templates/x.html", false), "a scene frame (top.location = …)")
        XCTAssertFalse(started("http://127.0.0.1:7435/my-channel/templates", false), "any frame, even the server's")
        XCTAssertFalse(started("http://127.0.0.1:7435/library/my-channel/templates/x.html?preview", true), "a scene opened on its own in the window")
        XCTAssertFalse(started("http://127.0.0.1:7435/%6Cibrary/my-channel/x.html", true), "however it's spelled")
        XCTAssertFalse(started("http://127.0.0.1:7435/LIBRARY/my-channel/x.html", true))
        XCTAssertFalse(started("https://evil.example/", true), "another site")
        XCTAssertFalse(started("http://127.0.0.1:7420/", true), "another port")
        XCTAssertFalse(started(nil, true), "unknown source")
    }

    /// MCP-10: Add to Claude Desktop is the one download, from the server only.
    func testOnlyTheServersExtensionDownloads() {
        XCTAssertTrue(NavigationPolicy.isExtensionDownload(u("http://127.0.0.1:7435/api/agent/viewswitcher.mcpb"), server: server))
        XCTAssertFalse(NavigationPolicy.isExtensionDownload(u("http://127.0.0.1:7420/api/agent/viewswitcher.mcpb"), server: server))
        XCTAssertFalse(NavigationPolicy.isExtensionDownload(u("https://example.com/api/agent/viewswitcher.mcpb"), server: server))
        XCTAssertFalse(NavigationPolicy.isExtensionDownload(u("http://127.0.0.1:7435/library/my-channel/assets/a.zip"), server: server))
    }

    func testFramesLoadWebPagesOnly() {
        for s in ["https://youtube.com/embed/x", "http://127.0.0.1:7435/library/a.html", "about:srcdoc", "blob:http://127.0.0.1:7435/1", "data:text/html,hi"] {
            XCTAssertEqual(NavigationPolicy.mac(u(s), server: server, mainFrame: false), .allow, s)
            XCTAssertEqual(NavigationPolicy.iPad(u(s), mainFrame: false), .allow, s)
        }
        for s in ["file:///etc/passwd", "zoommtg://zoom.us/join", "viewswitcher://connector/"] {
            XCTAssertEqual(NavigationPolicy.mac(u(s), server: server, mainFrame: false), .deny, s)
            XCTAssertEqual(NavigationPolicy.iPad(u(s), mainFrame: false), .deny, s)
        }
    }

    func testIPadAllowedHosts() {
        for s in ["viewswitcher://connector/", "http://127.0.0.1:7420/", "https://mac.tail1.ts.net/", "http://studio-mac.local:7420/"] {
            XCTAssertEqual(NavigationPolicy.iPad(u(s), mainFrame: true), .allow, s)
        }
        XCTAssertEqual(NavigationPolicy.iPad(u("https://example.com/"), mainFrame: true), .openInBrowser(u("https://example.com/")))
        XCTAssertEqual(NavigationPolicy.iPad(u("https://ts.net.example.com/"), mainFrame: true), .openInBrowser(u("https://ts.net.example.com/")))
        XCTAssertEqual(NavigationPolicy.iPad(u("viewswitcher://elsewhere/"), mainFrame: true), .deny)
        XCTAssertEqual(NavigationPolicy.iPad(u("file:///"), mainFrame: true), .deny)
        XCTAssertEqual(NavigationPolicy.iPad(u("tel:123"), mainFrame: true), .deny)
        // Only the one-time hand-over page on the Capacitor build's origin.
        XCTAssertEqual(NavigationPolicy.iPad(u("capacitor://localhost/migrate"), mainFrame: true), .allow)
        XCTAssertEqual(NavigationPolicy.iPad(u("capacitor://localhost/"), mainFrame: true), .deny)
        XCTAssertEqual(NavigationPolicy.mac(u("capacitor://localhost/migrate"), server: server, mainFrame: true), .deny)
    }
}
