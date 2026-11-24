// swift-tools-version:5.10
// ViewSwitcherKit: what the Mac and iPad apps share. The live-state model and menu text, the
// navigation policy, the server controller (macOS), the shell bridge script and the theme.
// Pure Foundation/WebKit, so `swift test` and `xcodebuild test` cover it without either app.
import PackageDescription

let package = Package(
    name: "ViewSwitcherKit",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "ViewSwitcherKit", targets: ["ViewSwitcherKit"])],
    targets: [
        .target(name: "ViewSwitcherKit"),
        .testTarget(name: "ViewSwitcherKitTests", dependencies: ["ViewSwitcherKit"]),
    ]
)
