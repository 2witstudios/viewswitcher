import Foundation

// The parts of the server's LiveState (packages/shared/src/types.ts) the shells read. Decoding is
// lenient: a field the server adds later never breaks the menu bar.

public struct LiveState: Decodable, Equatable, Sendable {
    public struct OnAir: Decodable, Equatable, Sendable {
        public var label: String
        public init(label: String) { self.label = label }
    }
    public struct Obs: Decodable, Equatable, Sendable {
        public var connected: Bool
        public var recording: Bool
        public var streaming: Bool
        public init(connected: Bool, recording: Bool = false, streaming: Bool = false) {
            self.connected = connected
            self.recording = recording
            self.streaming = streaming
        }
    }
    public struct ObsSetup: Decodable, Equatable, Sendable {
        public var scene: Bool
        public var program: Bool
        public var ground: Bool
        public var missingDevices: [String]
        public init(scene: Bool, program: Bool, ground: Bool, missingDevices: [String] = []) {
            self.scene = scene
            self.program = program
            self.ground = ground
            self.missingDevices = missingDevices
        }
        /// packages/shared obsReady: the scene and both of the switcher's own sources exist.
        public var ready: Bool { scene && program && ground }
    }
    public struct Usb: Decodable, Equatable, Sendable {
        public var enabled: Bool
        public var attached: Bool
        public var connected: Bool
        public init(enabled: Bool, attached: Bool = false, connected: Bool = false) {
            self.enabled = enabled
            self.attached = attached
            self.connected = connected
        }
    }

    public var onAir: OnAir?
    public var obs: Obs
    public var obsSetup: ObsSetup?
    public var usb: Usb?

    public init(onAir: OnAir? = nil, obs: Obs, obsSetup: ObsSetup? = nil, usb: Usb? = nil) {
        self.onAir = onAir
        self.obs = obs
        self.obsSetup = obsSetup
        self.usb = usb
    }

    /// OBS is streaming or recording: Set Up OBS asks first (MAC-12).
    public var obsLive: Bool { obs.streaming || obs.recording }
}

/// A `/ws` message: only `{"t":"state"}` matters to the shells.
public enum ServerMessage {
    public static func state(from data: Data) -> LiveState? {
        struct Envelope: Decodable {
            let t: String
            let state: LiveState?
        }
        guard let env = try? JSONDecoder().decode(Envelope.self, from: data), env.t == "state" else { return nil }
        return env.state
    }
}
