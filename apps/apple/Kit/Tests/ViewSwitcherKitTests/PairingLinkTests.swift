import XCTest
@testable import ViewSwitcherKit

/// PHONE-4: the app's own scanner pairs the app, so it accepts only a ViewSwitcher pairing link on the
/// local network: http(s), this Mac's .local name or a private LAN address, /pair, and a code.
final class PairingLinkTests: XCTestCase {
    func testAcceptsTheMacsPairingLinks() {
        for s in ["http://192.168.1.20:7420/pair?code=ABCD-EFGH", "http://10.0.0.5:7420/pair?code=abcd1234",
                  "http://172.20.1.2:7420/pair?code=X", "http://studio-mac.local:7420/pair?code=ABCD-EFGH"] {
            XCTAssertEqual(PairingLink.parse(s)?.absoluteString, s, s)
        }
    }

    func testTrimsWhatAScannerAddsAround() {
        XCTAssertEqual(PairingLink.parse("  http://192.168.1.20:7420/pair?code=AB\n")?.absoluteString, "http://192.168.1.20:7420/pair?code=AB")
    }

    func testRefusesAnythingElse() {
        for s in ["https://example.com/pair?code=AB", "http://192.168.1.20:7420/?code=AB", "http://192.168.1.20:7420/pair",
                  "http://192.168.1.20:7420/pair?code=", "http://8.8.8.8:7420/pair?code=AB", "http://172.32.0.1/pair?code=AB",
                  "http://127.0.0.1:7420/pair?code=AB", "http://mac.tail1.ts.net/pair?code=AB", "ftp://mac.local/pair?code=AB",
                  "viewswitcher://connector/pair?code=AB", "javascript:alert(1)", "ABCD-EFGH", ""] {
            XCTAssertNil(PairingLink.parse(s), s)
        }
    }

    func testThePairedMacsAddressIsTheLinksOrigin() {
        XCTAssertEqual(PairingLink.parse("http://192.168.1.20:7420/pair?code=AB").map(PairingLink.origin), "http://192.168.1.20:7420")
        XCTAssertEqual(PairingLink.parse("http://Studio-Mac.local/pair?code=AB").map(PairingLink.origin), "http://studio-mac.local")
    }

    func testPrivateAddresses() {
        for h in ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1"] { XCTAssertTrue(PairingLink.isPrivateIPv4(h), h) }
        for h in ["172.15.0.1", "172.32.0.1", "192.169.0.1", "8.8.8.8", "127.0.0.1", "169.254.1.1", "10.1.2", "10.1.2.300", "mac.local"] {
            XCTAssertFalse(PairingLink.isPrivateIPv4(h), h)
        }
    }

    func testBonjourAcceptsOnlyLocalNames() {
        XCTAssertEqual(PairingLink.bonjourMac(host: "Studio-Mac.local.", port: 7420), "http://studio-mac.local:7420")
        XCTAssertEqual(PairingLink.bonjourMac(host: "studio-mac.local", port: 7420), "http://studio-mac.local:7420")
        for (h, p) in [("evil.ts.net", 443), ("localhost", 7420), ("127.0.0.1", 7420), ("192.168.1.20", 7420), ("local", 7420),
                       (".local", 7420), ("mac.local", 0), ("mac.local", 70000), ("ma c.local", 7420), ("mac.local/x", 7420), ("evil.com", 80)] {
            XCTAssertNil(PairingLink.bonjourMac(host: h, port: p), "\(h):\(p)")
        }
    }
}
