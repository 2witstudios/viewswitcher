import AppKit

// ViewSwitcher.app: runs the ViewSwitcher server (the bundled sidecar in Contents/Helpers),
// shows the switcher in a window, and keeps a menu-bar item with what's on air and whether OBS and
// the iPad are connected. Closing the window keeps the server running for OBS and the iPad; Quit
// stops it, unless the app attached to a server it didn't start (then that server is left alone). If
// its own server crashes, the app brings it back (ServerSupervisor in ViewSwitcherKit).
// AppKit rather than SwiftUI scenes: the window must hide on close, its title bar holds the traffic
// lights in the switcher's header row, and the menus are rebuilt from live state (see README.md).
MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    withExtendedLifetime(delegate) { app.run() }
}
