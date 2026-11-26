import UserNotifications

/// Banners for things that happen while the window may be hidden (the server stopping, OBS set up).
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifier()

    private var center: UNUserNotificationCenter {
        let c = UNUserNotificationCenter.current()
        c.delegate = self
        return c
    }

    /// At launch, so permission is settled before anything needs saying.
    func requestPermission() {
        center.requestAuthorization(options: [.alert]) { _, _ in }
    }

    /// A banner with `id` replaces the last one with that id (the server stopped, then restarted).
    func post(_ title: String, _ body: String, id: String) {
        let center = center
        let add = {
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
        }
        center.getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional: add()
            // Not answered yet (the question asked at launch may still be up): ask, and post if allowed.
            case .notDetermined: center.requestAuthorization(options: [.alert]) { granted, _ in if granted { add() } }
            default: break
            }
        }
    }

    // Show it even while the app is in front.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner]
    }
}
