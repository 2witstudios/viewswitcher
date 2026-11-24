import Foundation

extension UsbTunnel {
    /// On a device only. The simulator shares the Mac's network, so its listener on 127.0.0.1:7420
    /// would be the Mac's own port 7420, where the Mac's switcher already listens.
    static var enabled: Bool {
        #if targetEnvironment(simulator)
        false
        #else
        true
        #endif
    }
}
