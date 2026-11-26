import Foundation

/// What the Mac menu-bar item shows: the on-air scene, OBS and the USB-C link, from the live state.
public struct MenuStatus: Equatable, Sendable {
    /// Text beside the icon: the on-air scene, or nothing.
    public var title: String
    /// Red icon: something is on air. Red is only ever for on air.
    public var live: Bool
    public var onAir: String
    public var obs: String
    public var ipad: String
    /// OBS is connected and has the scene and sources (devices aside).
    public var obsReady: Bool

    static let titleMax = 24

    static func short(_ s: String) -> String {
        guard s.count > titleMax else { return s }
        let cut = String(s.prefix(titleMax - 1))
        return cut.replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression) + "…"
    }

    /// `state` is nil while the server doesn't answer.
    public init(_ state: LiveState?) {
        guard let state else {
            self.init(title: "", live: false, onAir: "Server not responding", obs: "OBS: unknown", ipad: "iPad: unknown", obsReady: false)
            return
        }
        let label = state.onAir?.label ?? ""
        let setup = state.obsSetup
        let needsSetup = state.obs.connected && setup != nil && !(setup!.ready)

        var obs = state.obs.auth == "missing" ? "OBS: needs a password" : state.obs.auth == "wrong" ? "OBS: refused the password" : "OBS: not connected"
        if state.obs.connected {
            if needsSetup { obs = "OBS: needs setup" }
            else if let missing = setup?.missingDevices, !missing.isEmpty { obs = "OBS: connected · add \(missing.joined(separator: ", "))" }
            else { obs = "OBS: connected" }
            let outputs = [state.obs.streaming ? "live" : nil, state.obs.recording ? "recording" : nil].compactMap { $0 }
            if !outputs.isEmpty { obs += " · \(outputs.joined(separator: ", "))" }
        }

        let ipad: String
        if let usb = state.usb, usb.enabled {
            let device = usb.device ?? "iPad" // an iPhone is named as one
            ipad = usb.connected ? "\(device): connected over USB" : usb.attached ? "\(device): plugged in · open ViewSwitcher on it" : "iPhone or iPad: not plugged in"
        } else {
            ipad = "iPhone or iPad: USB link off"
        }

        self.init(
            title: label.isEmpty ? "" : Self.short(label),
            live: state.onAir != nil,
            onAir: label.isEmpty ? "Nothing on air" : "On air: \(label)",
            obs: obs,
            ipad: ipad,
            obsReady: state.obs.connected && setup != nil && !needsSetup
        )
    }

    public init(title: String, live: Bool, onAir: String, obs: String, ipad: String, obsReady: Bool) {
        self.title = title
        self.live = live
        self.onAir = onAir
        self.obs = obs
        self.ipad = ipad
        self.obsReady = obsReady
    }
}
