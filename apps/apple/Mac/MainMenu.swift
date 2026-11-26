import AppKit

/// The app's menu bar: the standard Mac menus, with Undo and Redo going to AppDelegate (forwardUndo)
/// so the page gets them first, and Reload and the window item acting on the switcher's window.
@MainActor
enum MainMenu {
    static func build(app: AppDelegate) -> NSMenu {
        let main = NSMenu()
        func sub(_ title: String, _ items: [NSMenuItem]) {
            let top = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            let m = NSMenu(title: title)
            items.forEach(m.addItem)
            top.submenu = m
            main.addItem(top)
        }
        func i(_ title: String, _ action: Selector, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
            let it = NSMenuItem(title: title, action: action, keyEquivalent: key)
            it.keyEquivalentModifierMask = mods
            it.target = target
            return it
        }
        sub("ViewSwitcher", [
            i("About ViewSwitcher", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            i("Check for Updates…", #selector(AppDelegate.checkForUpdates), target: app),
            .separator(),
            i("Hide ViewSwitcher", #selector(NSApplication.hide(_:)), "h"),
            i("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            i("Show All", #selector(NSApplication.unhideAllApplications(_:))),
            .separator(),
            i("Quit ViewSwitcher", #selector(AppDelegate.quit), "q", target: app),
        ])
        sub("File", [i("Close Window", #selector(NSWindow.performClose(_:)), "w")])
        // Undo/Redo forward to the page: see forwardUndo.
        sub("Edit", [
            i("Undo", #selector(AppDelegate.forwardUndo(_:)), "z", target: app),
            i("Redo", #selector(AppDelegate.forwardRedo(_:)), "z", [.command, .shift], target: app),
            .separator(),
            i("Cut", #selector(NSText.cut(_:)), "x"),
            i("Copy", #selector(NSText.copy(_:)), "c"),
            i("Paste", #selector(NSText.paste(_:)), "v"),
            i("Paste and Match Style", #selector(NSTextView.pasteAsPlainText(_:)), "v", [.command, .option, .shift]),
            i("Delete", #selector(NSText.delete(_:))),
            i("Select All", #selector(NSText.selectAll(_:)), "a"),
        ])
        sub("View", [
            i("Reload", #selector(AppDelegate.reload), "r", target: app),
            .separator(),
            i("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])
        let window: [NSMenuItem] = [
            i("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
            i("Zoom", #selector(NSWindow.performZoom(_:))),
            .separator(),
            i("ViewSwitcher", #selector(AppDelegate.openWindow), "0", target: app),
            i("Bring All to Front", #selector(NSApplication.arrangeInFront(_:))),
        ]
        sub("Window", window)
        NSApp.windowsMenu = main.items.last?.submenu
        return main
    }
}
