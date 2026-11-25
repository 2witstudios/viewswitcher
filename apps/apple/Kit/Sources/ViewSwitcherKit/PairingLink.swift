import Foundation

/// The Mac's pairing link (MAC-24), as its QR code carries it: http://<LAN address or name.local>:<port>/pair?code=…
/// The phone and iPad app read it with their own scanner (PHONE-4), so the device token lands in the
/// app's web view rather than in Safari, which is where the system Camera would open it. Pure, so
/// XCTest covers what's accepted.
public enum PairingLink {
    /// The link, if it's a ViewSwitcher pairing link on the local network; nil for anything else.
    public static func parse(_ text: String) -> URL? {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host?.lowercased(), host.hasSuffix(".local") || isPrivateIPv4(host),
              url.path == "/pair",
              let code = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "code" })?.value,
              !code.isEmpty
        else { return nil }
        return url
    }

    /// The Mac's address the link points at (scheme, host, port): what the connector saves to come back to.
    public static func origin(_ url: URL) -> String {
        let host = url.host?.lowercased() ?? ""
        return "\(url.scheme?.lowercased() ?? "http")://\(host)\(url.port.map { ":\($0)" } ?? "")"
    }

    /// 10/8, 172.16/12 or 192.168/16: an address on a home or office network, never the internet.
    public static func isPrivateIPv4(_ host: String) -> Bool {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }
        let n = parts.compactMap { p -> Int? in
            guard !p.isEmpty, p.count <= 3, p.allSatisfy(\.isASCII), p.allSatisfy(\.isNumber), let v = Int(p), v <= 255 else { return nil }
            return v
        }
        guard n.count == 4 else { return false }
        return n[0] == 10 || (n[0] == 172 && (16...31).contains(n[1])) || (n[0] == 192 && n[1] == 168)
    }
}
