import UserNotifications

/// Banners for things that happen while the window may be hidden (the server stopping, OBS set up).
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifier()

    func post(_ title: String, _ body: String) {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert]) { granted, _ in
            guard granted else { return }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
        }
    }

    // Show it even while the app is in front.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner]
    }
}
