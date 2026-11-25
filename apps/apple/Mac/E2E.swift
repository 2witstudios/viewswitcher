import AppKit
import WebKit
import ServiceManagement
import SwiftUI
import ViewSwitcherKit

struct MenuRow: Identifiable {
    let id = UUID()
    let title: String?
    let on: Bool
    let enabled: Bool
}

/// A picture of the status menu for scripts/e2e.ts (menuPicture).
struct MenuPicture: View {
    let rows: [MenuRow]
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(rows) { r in
                if let t = r.title {
                    HStack(spacing: 6) {
                        Text(r.on ? "✓" : " ").frame(width: 14)
                        Text(t).foregroundStyle(r.enabled ? .primary : .secondary)
                    }
                    .font(.system(size: 13))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                } else {
                    Divider().padding(.vertical, 4).padding(.horizontal, 8)
                }
            }
        }
        .padding(.vertical, 6)
        .frame(width: 380, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color(white: 0.17)))
        .padding(1)
    }
}

/// The end-to-end check's handle on the app (scripts/e2e.ts). Only when VIEWSWITCHER_E2E_DIR is set:
/// the script drops `cmd-<n>.json` files there ({"op": …}) and reads back `res-<n>.json`. Setting an
/// environment variable already means running code as this user, so this opens nothing new.
@MainActor
final class E2E {
    let dir: URL
    unowned let app: AppDelegate
    private var timer: Timer?
    private var busy = Set<String>()

    init(dir: URL, app: AppDelegate) {
        self.dir = dir
        self.app = app
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll() }
        }
    }

    private func poll() {
        let files = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        for f in files.sorted() where f.hasPrefix("cmd-") && f.hasSuffix(".json") && !busy.contains(f) {
            busy.insert(f)
            let url = dir.appendingPathComponent(f)
            let id = String(f.dropFirst(4).dropLast(5))
            guard let data = try? Data(contentsOf: url), let cmd = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            try? FileManager.default.removeItem(at: url)
            Task {
                let result: Any
                do { result = try await self.run(cmd) } catch { result = ["error": error.localizedDescription] }
                let out = (try? JSONSerialization.data(withJSONObject: ["result": result], options: [.fragmentsAllowed])) ?? Data("{}".utf8)
                let tmp = self.dir.appendingPathComponent("tmp-\(id)")
                try? out.write(to: tmp)
                try? FileManager.default.moveItem(at: tmp, to: self.dir.appendingPathComponent("res-\(id).json"))
                self.busy.remove(f)
            }
        }
    }

    struct Failure: LocalizedError {
        let errorDescription: String?
        init(_ s: String) { errorDescription = s }
    }

    private func remotesState() -> Any {
        guard let r = app.remotes else { return NSNull() }
        let m = r.model
        var out: [String: Any] = [:]
        out["visible"] = r.window.isVisible
        out["enabled"] = m.status?.enabled ?? false
        out["code"] = m.codeOpen ? (m.code ?? "") : ""
        out["pairUrl"] = m.pairUrl ?? ""
        out["devices"] = (m.status?.devices ?? []).map(\.name)
        out["error"] = m.error ?? ""
        return out
    }

    private func run(_ cmd: [String: Any]) async throws -> Any {
        let w = app.switcher
        switch cmd["op"] as? String {
        case "state":
            return [
                "menu": app.statusMenu.items.map { $0.isSeparatorItem ? "" : $0.title },
                "menuEnabled": app.statusMenu.items.filter { $0.isEnabled && !$0.isSeparatorItem }.map(\.title),
                "statusTitle": app.status.title.isEmpty ? "" : " \(app.status.title)",
                "statusLive": app.status.live,
                "server": app.server.map { ["owned": $0.owned, "pid": Int($0.pid ?? 0)] } ?? NSNull(),
                "window": w.map { w in [
                    "visible": w.window.isVisible,
                    "number": w.window.windowNumber,
                    "fullscreen": w.window.styleMask.contains(.fullScreen),
                    "url": w.webView.url?.absoluteString ?? "",
                    "frame": [w.window.frame.width, w.window.frame.height],
                    "lights": [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].compactMap { t -> [Double]? in
                        // In page coordinates (top-left origin), so the script can compare with DOM rects.
                        guard let b = w.window.standardWindowButton(t), let sv = b.superview else { return nil }
                        let r = sv.convert(b.frame, to: nil)
                        return [r.minX, w.window.frame.height - r.maxY, r.width, r.height, b.isHidden ? 0 : 1]
                    },
                    "events": w.events,
                ] as [String: Any] } ?? NSNull(),
                "opened": Outside.opened,
                "alerts": Outside.alerts,
                "notices": Outside.notices,
                "loginItem": SMAppService.mainApp.status == .enabled,
                "updater": app.menuHasUpdater,
                "undoRoute": app.lastUndoRoute,
                "feed": Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") as? String ?? "",
                "wifi": Env.wifi,
                "remotes": remotesState(),
            ] as [String: Any]
        case "eval":
            guard let w, let js = cmd["js"] as? String else { throw Failure("no window") }
            let r = try await w.webView.callAsyncJavaScript(js, contentWorld: .page)
            return r ?? NSNull()
        case "menu":
            // {"menu": "status" | "Edit" | …, "item": title}
            let name = cmd["menu"] as? String ?? "status"
            let menu = name == "status" ? app.statusMenu : NSApp.mainMenu?.items.first { $0.title == name }?.submenu
            guard let menu, let title = cmd["item"] as? String, let i = menu.items.firstIndex(where: { $0.title == title }) else { throw Failure("no menu item") }
            menu.performActionForItem(at: i)
            return true
        case "key":
            // A typed key, through the normal event path: {"key": "z", "mods": ["cmd", "shift"]}
            guard let w, let key = cmd["key"] as? String else { throw Failure("no window") }
            NSApp.activate(ignoringOtherApps: true)
            w.window.makeKeyAndOrderFront(nil)
            try? await Task.sleep(for: .milliseconds(300))
            let names = cmd["mods"] as? [String] ?? []
            var mods: NSEvent.ModifierFlags = []
            if names.contains("cmd") { mods.insert(.command) }
            if names.contains("shift") { mods.insert(.shift) }
            let chars = names.contains("shift") ? key.uppercased() : key
            for type in [NSEvent.EventType.keyDown, .keyUp] {
                let e = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: mods, timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: w.window.windowNumber, context: nil, characters: chars, charactersIgnoringModifiers: key, isARepeat: false, keyCode: key == "z" ? 6 : 0)!
                NSApp.postEvent(e, atStart: false)
            }
            return true
        case "click":
            // A left click at page coordinates (top-left origin), through the window's hit-testing.
            guard let w, let x = cmd["x"] as? Double, let y = cmd["y"] as? Double else { throw Failure("no window") }
            NSApp.activate(ignoringOtherApps: true)
            w.window.makeKeyAndOrderFront(nil)
            try? await Task.sleep(for: .milliseconds(300))
            let p = NSPoint(x: x, y: w.window.frame.height - y)
            for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
                let e = NSEvent.mouseEvent(with: type, location: p, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: w.window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)!
                NSApp.postEvent(e, atStart: false)
            }
            return true
        case "snapshot":
            // The window as it looks, for the PR's screenshots when screencapture has no Screen
            // Recording permission: WebKit's snapshot of the page, with the title bar's own views (the
            // traffic lights) drawn over it where they really are.
            guard let w, let path = cmd["path"] as? String else { throw Failure("no window") }
            let page = try await w.webView.takeSnapshot(configuration: nil)
            let size = w.webView.bounds.size
            let scale = w.window.backingScaleFactor
            guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width * scale), pixelsHigh: Int(size.height * scale), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { throw Failure("no bitmap") }
            rep.size = size
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
            w.window.backgroundColor.setFill()
            NSRect(origin: .zero, size: size).fill()
            page.draw(in: NSRect(origin: .zero, size: size))
            if !w.window.styleMask.contains(.fullScreen), let close = w.window.standardWindowButton(.closeButton), let bar = close.superview {
                let r = bar.convert(bar.bounds, to: nil)
                if let barRep = bar.bitmapImageRepForCachingDisplay(in: bar.bounds) {
                    bar.cacheDisplay(in: bar.bounds, to: barRep)
                    barRep.draw(in: r, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
                }
            }
            NSGraphicsContext.restoreGraphicsState()
            try rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
            return [size.width, size.height]
        case "remotesSnapshot":
            // The Phones and Tablets window as drawn (no Screen Recording permission needed).
            guard let r = app.remotes, let path = cmd["path"] as? String, let view = r.window.contentView?.superview ?? r.window.contentView else { throw Failure("no remotes window") }
            guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { throw Failure("no bitmap") }
            view.cacheDisplay(in: view.bounds, to: rep)
            try rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
            return [view.bounds.width, view.bounds.height]
        case "menuItems":
            // The status menu as it lists (an open NSMenu can't be captured from here): checkmarks and disabled items marked.
            return app.statusMenu.items.map { i -> String in
                if i.isSeparatorItem { return "—" }
                return (i.state == .on ? "✓ " : "") + i.title + (i.isEnabled ? "" : " (disabled)")
            }
        case "menuPicture":
            // The status menu drawn from its real items (titles, checkmarks, enabled state), for the PR:
            // an open NSMenu can't be captured without Screen Recording permission.
            guard let path = cmd["path"] as? String else { throw Failure("no path") }
            let rows = app.statusMenu.items.map { i in MenuRow(title: i.isSeparatorItem ? nil : i.title, on: i.state == .on, enabled: i.isEnabled) }
            let view = NSHostingView(rootView: MenuPicture(rows: rows))
            view.frame = NSRect(origin: .zero, size: view.fittingSize)
            view.appearance = NSAppearance(named: .darkAqua)
            guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { throw Failure("no bitmap") }
            view.cacheDisplay(in: view.bounds, to: rep)
            try rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
            return true
        case "remotes": app.openRemotes(); return true
        case "remotesRemove":
            guard let r = app.remotes, let name = cmd["name"] as? String, let d = r.model.status?.devices.first(where: { $0.name == name }) else { throw Failure("no such device") }
            await r.model.remove(d.id)
            return true
        case "open": app.openWindow(); return true
        case "close": w?.window.performClose(nil); return true
        case "fullscreen": w?.window.toggleFullScreen(nil); return true
        case "resize":
            guard let w, let width = cmd["w"] as? Double, let height = cmd["h"] as? Double else { throw Failure("no window") }
            var f = w.window.frame
            f.origin.y += f.height - height
            f.size = NSSize(width: width, height: height)
            w.window.setFrame(f, display: true)
            return true
        case "quit":
            DispatchQueue.main.async { NSApp.terminate(nil) }
            return true
        default:
            throw Failure("unknown op")
        }
    }
}
