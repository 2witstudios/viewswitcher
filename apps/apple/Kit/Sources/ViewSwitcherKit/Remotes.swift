import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation

// Phones and tablets on the Wi-Fi (MAC-23 … MAC-26): what the server's /api/remote says, and how the
// Mac app shows it. The server keeps the codes and tokens (apps/server/src/pairing.ts); the app only
// shows a code, its QR code, and the paired devices.

public struct RemoteDevice: Decodable, Equatable, Sendable, Identifiable {
    public var id: String
    public var name: String
    /// Milliseconds since 1970, as the server sends them.
    public var pairedAt: Double
    public var lastSeen: Double
    /// Live sockets from this device right now.
    public var connected: Int

    public init(id: String, name: String, pairedAt: Double, lastSeen: Double, connected: Int) {
        self.id = id
        self.name = name
        self.pairedAt = pairedAt
        self.lastSeen = lastSeen
        self.connected = connected
    }
}

public struct PairingCode: Decodable, Equatable, Sendable {
    /// Only in the answer that made it: the server never sends a code again.
    public var code: String?
    public var expiresAt: Double
}

public struct RemoteStatus: Decodable, Equatable, Sendable {
    /// The Wi-Fi listener is on.
    public var enabled: Bool
    public var port: Int
    /// "studio-mac.local"
    public var localName: String?
    /// Where phones reach the switcher, the .local name first.
    public var urls: [String]
    /// The open code, if there is one.
    public var code: PairingCode?
    /// The last code was cancelled after too many wrong tries: someone on the network may be guessing.
    public var codeGuessed: Bool?
    public var devices: [RemoteDevice]
    /// The link the QR code holds (with the code), from POST /api/remote/code.
    public var pairUrl: String?
}

public enum RemoteText {
    /// The setting's help text: plain HTTP on the Wi-Fi is the known limit (Decisions, MAC-23). Users
    /// never see a VPN named (Decisions): the caveat is the kind of network, not a product.
    public static let help = "Phones and tablets you pair can switch scenes from a browser. Wi-Fi traffic isn't encrypted, so use this on networks you trust, like home or church Wi-Fi."

    public static let guessed = "That code was cancelled after too many wrong tries. Someone on this network may be guessing; make a new code when your device is ready."

    /// "K7PQ2MXA" → "K7PQ-2MXA", easier to read out and type.
    public static func code(_ c: String) -> String {
        c.count == 8 ? "\(c.prefix(4))-\(c.suffix(4))" : c
    }

    /// "Expires in 4:59", "Expired".
    public static func expiry(_ expiresAt: Double, now: Date = Date()) -> String {
        // Never more than the 5 minutes a code lives (the Mac's clock and the server's round differently).
        let left = min(300, Int((expiresAt / 1000 - now.timeIntervalSince1970).rounded(.up)))
        guard left > 0 else { return "Expired" }
        return String(format: "Expires in %d:%02d", left / 60, left % 60)
    }

    /// "Connected now", "Seen 3 min ago", "Seen 2 days ago".
    public static func lastSeen(_ d: RemoteDevice, now: Date = Date()) -> String {
        if d.connected > 0 { return "Connected now" }
        let s = max(0, Int(now.timeIntervalSince1970 - d.lastSeen / 1000))
        switch s {
        case ..<60: return "Seen just now"
        case ..<3600: return "Seen \(s / 60) min ago"
        case ..<86400: return "Seen \(s / 3600) h ago"
        default:
            let days = s / 86400
            return "Seen \(days) day\(days == 1 ? "" : "s") ago"
        }
    }
}

/// A QR code for `text`, made on this Mac (CoreImage, no network service), as a crisp bitmap `scale`
/// pixels per module. Medium error correction, which phones read easily from a screen.
public func qrCode(_ text: String, scale: CGFloat = 10) -> CGImage? {
    let filter = CIFilter.qrCodeGenerator()
    filter.message = Data(text.utf8)
    filter.correctionLevel = "M"
    guard let out = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: scale, y: scale)) else { return nil }
    return CIContext(options: [.useSoftwareRenderer: true]).createCGImage(out, from: out.extent)
}
