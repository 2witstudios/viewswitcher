// swift-tools-version:5.10
// ViewSwitcherKit: what the Mac and iPad apps share. The live-state model and menu text, the
// navigation policy, the server controller (macOS), the shell bridge script and the theme.
// Pure Foundation/WebKit, so `swift test` and `xcodebuild test` cover it without either app.
import PackageDescription

// Complete concurrency checking (what Swift 6 enforces), so a data race is a build warning here.
let strict: [SwiftSetting] = [.enableExperimentalFeature("StrictConcurrency")]

let package = Package(
    name: "ViewSwitcherKit",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "ViewSwitcherKit", targets: ["ViewSwitcherKit"])],
    targets: [
        .target(name: "ViewSwitcherKit", swiftSettings: strict),
        .testTarget(name: "ViewSwitcherKitTests", dependencies: ["ViewSwitcherKit"], swiftSettings: strict),
    ]
)
