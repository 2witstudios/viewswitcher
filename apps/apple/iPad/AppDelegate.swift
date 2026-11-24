import UIKit

/// ViewSwitcher on the iPad (MAC-14). The bundled connector page finds the server on the Mac
/// (USB-C first, through UsbTunnel, then a saved network address) and opens the switcher it serves.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Start the USB-C tunnel before the web view loads the connector page.
        if UsbTunnel.enabled { UsbTunnel.shared.start() }
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration", sessionRole: session.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
