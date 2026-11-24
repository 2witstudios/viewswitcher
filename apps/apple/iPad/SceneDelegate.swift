import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = SwitcherViewController()
        window.makeKeyAndVisible()
        self.window = window
        #if DEBUG
        debugGeometry(windowScene)
        #endif
    }

    #if DEBUG
    /// For screenshots in the simulator: VIEWSWITCHER_ORIENTATION=portrait|landscape.
    private func debugGeometry(_ scene: UIWindowScene) {
        let env = ProcessInfo.processInfo.environment
        if let o = env["VIEWSWITCHER_ORIENTATION"] {
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: o == "portrait" ? .portrait : .landscapeLeft))
        }
    }
    #endif

    private var wasInBackground = false

    func sceneDidEnterBackground(_ scene: UIScene) { wasInBackground = true }

    func sceneWillEnterForeground(_ scene: UIScene) {
        // iOS may have torn the tunnel's sockets down while the app was in the background. (UIKit
        // also calls this on the first launch, when the tunnel has only just started: leave it then.)
        guard wasInBackground else { return }
        wasInBackground = false
        if UsbTunnel.enabled { UsbTunnel.shared.restart() }
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        // Keep the iPad awake while it's driving the stream.
        UIApplication.shared.isIdleTimerDisabled = true
    }

    func sceneWillResignActive(_ scene: UIScene) {
        UIApplication.shared.isIdleTimerDisabled = false
    }
}
