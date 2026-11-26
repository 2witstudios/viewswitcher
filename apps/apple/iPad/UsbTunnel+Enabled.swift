import Foundation
import ViewSwitcherKit

extension UsbTunnel {
    /// The web view connects to 127.0.0.1:7420; the Mac dials 7421 over usbmuxd (apps/server/src/usb-bridge.ts).
    static let shared = UsbTunnel(localPort: 7420, tunnelPort: 7421)

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
