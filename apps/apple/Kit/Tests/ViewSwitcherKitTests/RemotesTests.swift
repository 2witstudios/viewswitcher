import CoreImage
import XCTest
@testable import ViewSwitcherKit

/// Phones and tablets: the server's /api/remote, the code and device text, the QR code.
final class RemotesTests: XCTestCase {
    func testDecodesTheServersStatus() throws {
        let json = """
        {"enabled":true,"port":7420,"localName":"studio-mac.local","urls":["http://studio-mac.local:7420/","http://192.168.1.68:7420/"],
         "code":{"code":"K7PQ2MXA","expiresAt":1700000300000},"pairUrl":"http://192.168.1.68:7420/pair?code=K7PQ2MXA",
         "devices":[{"id":"a1","name":"Jono's iPhone","pairedAt":1700000000000,"lastSeen":1700000100000,"connected":1}]}
        """
        let s = try JSONDecoder().decode(RemoteStatus.self, from: Data(json.utf8))
        XCTAssertTrue(s.enabled)
        XCTAssertEqual(s.code?.code, "K7PQ2MXA")
        XCTAssertEqual(s.devices.first?.name, "Jono's iPhone")
        XCTAssertEqual(s.pairUrl, "http://192.168.1.68:7420/pair?code=K7PQ2MXA")
        let off = try JSONDecoder().decode(RemoteStatus.self, from: Data(#"{"enabled":false,"port":7420,"localName":null,"urls":[],"code":null,"devices":[]}"#.utf8))
        XCTAssertFalse(off.enabled)
        XCTAssertNil(off.code)
        XCTAssertNil(off.codeGuessed)
        let guessed = try JSONDecoder().decode(RemoteStatus.self, from: Data(#"{"enabled":true,"port":7420,"localName":null,"urls":[],"code":null,"codeGuessed":true,"devices":[]}"#.utf8))
        XCTAssertEqual(guessed.codeGuessed, true)
    }

    func testCodeAndTimes() {
        XCTAssertEqual(RemoteText.code("K7PQ2MXA"), "K7PQ-2MXA")
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        XCTAssertEqual(RemoteText.expiry(1_700_000_300_000, now: now), "Expires in 5:00")
        XCTAssertEqual(RemoteText.expiry(1_700_000_300_400, now: now), "Expires in 5:00")
        XCTAssertEqual(RemoteText.expiry(1_700_000_059_500, now: now), "Expires in 1:00")
        XCTAssertEqual(RemoteText.expiry(1_700_000_000_000, now: now), "Expired")
        let d = RemoteDevice(id: "a", name: "iPad", pairedAt: 0, lastSeen: 1_699_999_820_000, connected: 0)
        XCTAssertEqual(RemoteText.lastSeen(d, now: now), "Seen 3 min ago")
        XCTAssertEqual(RemoteText.lastSeen(.init(id: "a", name: "", pairedAt: 0, lastSeen: 1_699_827_200_000, connected: 0), now: now), "Seen 2 days ago")
        XCTAssertEqual(RemoteText.lastSeen(.init(id: "a", name: "", pairedAt: 0, lastSeen: 0, connected: 2), now: now), "Connected now")
        XCTAssertTrue(RemoteText.help.contains("networks you trust, like home or church Wi-Fi"))
        XCTAssertFalse(RemoteText.help.contains("Tailscale"))
    }

    /// Made on the Mac, and a phone camera would read back the same link.
    func testQRCodeReadsBack() throws {
        let link = "http://192.168.1.68:7420/pair?code=K7PQ2MXA"
        let image = try XCTUnwrap(qrCode(link))
        XCTAssertGreaterThan(image.width, 200)
        let detector = try XCTUnwrap(CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]))
        let found = detector.features(in: CIImage(cgImage: image)).compactMap { ($0 as? CIQRCodeFeature)?.messageString }
        XCTAssertEqual(found, [link])
    }
}
