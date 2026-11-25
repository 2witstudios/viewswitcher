import AppKit
import ViewSwitcherKit

/// Turns StatusMenu's items into the menu-bar item's NSMenu. Each clickable item carries its action,
/// so scripts/e2e.ts can choose one with performActionForItem and the app does what a click does.
@MainActor
final class StatusMenuBuilder: NSObject {
    private let perform: (StatusMenu.Action) -> Void

    init(perform: @escaping (StatusMenu.Action) -> Void) {
        self.perform = perform
    }

    func fill(_ menu: NSMenu, with items: [StatusMenu.Item]) {
        menu.autoenablesItems = false
        menu.removeAllItems()
        for item in items {
            switch item {
            case .separator:
                menu.addItem(.separator())
            case .info(let title):
                let i = NSMenuItem(title: title, action: nil, keyEquivalent: "")
                i.isEnabled = false
                menu.addItem(i)
            case .action(let title, let action, let enabled, let checked, let toolTip):
                let i = NSMenuItem(title: title, action: enabled ? #selector(chosen(_:)) : nil, keyEquivalent: "")
                i.target = self
                i.isEnabled = enabled
                i.state = checked ? .on : .off
                i.toolTip = toolTip
                i.representedObject = action
                menu.addItem(i)
            }
        }
    }

    @objc private func chosen(_ sender: NSMenuItem) {
        guard let action = sender.representedObject as? StatusMenu.Action else { return }
        perform(action)
    }
}
