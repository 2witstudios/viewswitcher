import Foundation

/// Where Sparkle finds updates: the appcast is an asset of the latest GitHub release, next
/// to ViewSwitcher.dmg (the site's download link). A draft release isn't "latest", so nobody sees
/// an update until a person publishes it.
public enum UpdateFeed {
    public static let owner = "2witstudios"
    public static let repo = "viewswitcher"
    public static let appcast = URL(string: "https://github.com/\(owner)/\(repo)/releases/latest/download/appcast.xml")!
    public static let dmg = URL(string: "https://github.com/\(owner)/\(repo)/releases/latest/download/ViewSwitcher.dmg")!

    /// Where a version's files live once its release is published (the appcast's enclosure URLs).
    public static func downloadPrefix(version: String) -> URL {
        URL(string: "https://github.com/\(owner)/\(repo)/releases/download/v\(version)/")!
    }
}
