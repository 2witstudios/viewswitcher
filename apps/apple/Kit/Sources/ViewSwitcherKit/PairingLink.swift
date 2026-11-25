import Foundation

/// The Mac's pairing link (MAC-24), as its QR code carries it: http://<LAN address or name.local>:<port>/pair?code=…
/// The phone and iPad app read it with their own scanner (PHONE-4), so the device token lands in the
/// app's web view rather than in Safari, which is where the system Camera would open it. Pure, so
/// XCTest covers what's accepted.
public enum PairingLink {
    /// The link, if it's a ViewSwitcher pairing link on the local network; nil for anything else. A Mac whose
    /// only address is outside the local ranges (some campus and office networks) still advertises its
    /// .local name (`&mac=`): such a link becomes the same pairing on that name. Any other public host is refused.
    public static func parse(_ text: String) -> URL? {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host?.lowercased(),
              url.path == "/pair",
              let code = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "code" })?.value,
              !code.isEmpty
        else { return nil }
        if host.hasSuffix(".local") || isPrivateIPv4(host) { return url }
        return localAlternative(url)
    }

    /// The same pairing on the Mac's .local name, when the link names it (`&mac=<name>.local`, PHONE-4). A
    /// device paired on the name keeps finding the Mac when its LAN address changes; the connector uses it
    /// when the name answers, else the link as it is.
    public static func localAlternative(_ url: URL) -> URL? {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let name = parts.queryItems?.first(where: { $0.name == "mac" })?.value,
              let code = parts.queryItems?.first(where: { $0.name == "code" })?.value,
              let port = url.port, // the Mac's links always name it; no guessing 80 or 443
              let base = bonjourMac(host: name, port: port)
        else { return nil }
        var out = URLComponents(string: base)
        out?.path = "/pair"
        out?.queryItems = [URLQueryItem(name: "code", value: code)]
        return out?.url
    }

    /// The Mac's address the link points at (scheme, host, port): what the connector saves to come back to.
    public static func origin(_ url: URL) -> String {
        let host = url.host?.lowercased() ?? ""
        return "\(url.scheme?.lowercased() ?? "http")://\(host)\(url.port.map { ":\($0)" } ?? "")"
    }

    /// A Mac found by Bonjour (PHONE-5): its address, only for a `.local` name and a real port. Whoever
    /// answers on the Wi-Fi picks the name, so anything else (a *.ts.net or loopback name, an IP) is refused,
    /// as PairingLink refuses it from a QR code.
    public static func bonjourMac(host: String, port: Int) -> String? {
        var h = host.lowercased()
        if h.hasSuffix(".") { h.removeLast() }
        let labels = h.split(separator: ".", omittingEmptySubsequences: false)
        guard h.hasSuffix(".local"), labels.count >= 2, (1...65535).contains(port),
              labels.allSatisfy({ !$0.isEmpty && $0.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") } })
        else { return nil }
        return "http://\(h):\(port)"
    }

    /// 10/8, 172.16/12, 192.168/16, or 100.64/10 (carrier-grade NAT: a phone hotspot, some campus networks):
    /// an address the Mac can have on a local network, never a public one.
    public static func isPrivateIPv4(_ host: String) -> Bool {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }
        let n = parts.compactMap { p -> Int? in
            // No leading zeros: WebKit reads 010 as octal (8), so "010.1.2.3" would be the public 8.1.2.3.
            guard !p.isEmpty, p.count <= 3, p.allSatisfy(\.isASCII), p.allSatisfy(\.isNumber), p.count == 1 || p.first != "0",
                  let v = Int(p), v <= 255 else { return nil }
            return v
        }
        guard n.count == 4 else { return false }
        return n[0] == 10 || (n[0] == 172 && (16...31).contains(n[1])) || (n[0] == 192 && n[1] == 168) || (n[0] == 100 && (64...127).contains(n[1]))
    }
}
