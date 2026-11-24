import Foundation

/// The switcher's graphite (apps/web/src/styles.css): the shells paint it before the page loads.
public enum Theme {
    /// --bg #0b0c0f
    public static let background: (r: Double, g: Double, b: Double) = (11 / 255, 12 / 255, 15 / 255)
    /// --side #101116, behind the Mac title bar area
    public static let side: (r: Double, g: Double, b: Double) = (16 / 255, 17 / 255, 22 / 255)
}
