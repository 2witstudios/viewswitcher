import Foundation

/// How a shell tells the switcher page where it is (MAC-13a): `<html data-shell="mac|ipad">`,
/// `.shell-fullscreen`, and CSS variables for the space the native window keeps (apps/web/src/styles.css
/// reads them; in a browser none are set and the page lays out as usual). On the Mac it also turns a
/// mouse-down on a `[data-drag-region]` (not on a control in it) into a window drag, since WKWebView
/// has no -webkit-app-region.
public struct ShellInfo: Equatable, Sendable {
    public enum Kind: String, Sendable { case mac, ipad }
    public var kind: Kind
    public var fullscreen: Bool
    /// CSS custom properties, e.g. "--shell-lights": "84px".
    public var vars: [String: String]

    public init(kind: Kind, fullscreen: Bool = false, vars: [String: String] = [:]) {
        self.kind = kind
        self.fullscreen = fullscreen
        self.vars = vars
    }

    /// The Mac window with its title bar hidden: the traffic lights sit in the header row.
    /// - lightsInset: from the window's left edge to just past the zoom button.
    /// - headerRow: the height of the row the lights are centered in.
    /// - dragStrip: the top band the page keeps clear for dragging the window.
    /// Full screen hides the lights, so every inset goes to zero.
    public static func mac(lightsInset: Double, headerRow: Double, dragStrip: Double, fullscreen: Bool) -> ShellInfo {
        let px = { (v: Double) in "\(Int(v.rounded()))px" }
        return ShellInfo(kind: .mac, fullscreen: fullscreen, vars: [
            "--shell-lights": px(fullscreen ? 0 : lightsInset),
            "--shell-header": px(fullscreen ? 0 : headerRow),
            "--shell-drag": px(fullscreen ? 0 : dragStrip),
        ])
    }

    func json() -> String {
        let body = vars.keys.sorted().map { "\(ShellBridge.quote($0)):\(ShellBridge.quote(self.vars[$0]!))" }.joined(separator: ",")
        return "{\"kind\":\"\(kind.rawValue)\",\"fullscreen\":\(fullscreen),\"vars\":{\(body)}}"
    }
}

public enum ShellBridge {
    /// The WKScriptMessageHandler name the page posts to.
    public static let handler = "viewswitcherShell"

    static func quote(_ s: String) -> String {
        let data = try! JSONSerialization.data(withJSONObject: [s], options: [.fragmentsAllowed])
        let arr = String(data: data, encoding: .utf8)!
        return String(arr.dropFirst().dropLast())
    }

    /// Injected at document start in the main frame. Applies `info` and keeps `viewswitcherShell.apply`
    /// for later changes (full screen, resize).
    public static func userScript(_ info: ShellInfo) -> String {
        """
        (() => {
          const apply = (s) => {
            const r = document.documentElement;
            if (!r) return;
            r.dataset.shell = s.kind;
            r.classList.toggle("shell-fullscreen", !!s.fullscreen);
            for (const [k, v] of Object.entries(s.vars || {})) r.style.setProperty(k, v);
          };
          let current = \(info.json());
          window.viewswitcherShell = { apply: (s) => { current = s; apply(s); } };
          apply(current);
          document.addEventListener("DOMContentLoaded", () => apply(current));
          const post = (t) => { try { window.webkit.messageHandlers.\(handler).postMessage({ t }); } catch {} };
          const control = "a, button, input, select, textarea, label, summary, [role=button], [contenteditable=''], [contenteditable=true], [data-no-drag]";
          const region = (e) => e.button === 0 && e.target instanceof Element && e.target.closest("[data-drag-region]") && !e.target.closest(control);
          if (current.kind === "mac") {
            addEventListener("mousedown", (e) => { if (region(e) && e.detail === 1) post("drag"); }, true);
            addEventListener("dblclick", (e) => { if (region(e)) post("zoom"); }, true);
          }
        })();
        """
    }

    /// Re-applies `info` in a page that's already loaded.
    public static func applyScript(_ info: ShellInfo) -> String {
        "window.viewswitcherShell && window.viewswitcherShell.apply(\(info.json()));"
    }

    /// Edit → Undo / Redo clicked in the menu (not typed): a page in a browser would have had ⌘Z,
    /// so hand it one, unless focus is in editable text, where the native text undo runs instead.
    /// Returns "native" or "page". (A typed ⌘Z reaches the page by itself: WKWebView sends key
    /// equivalents to the page first and the menu only gets what it doesn't handle.) Port of apps/mac/src/undo.ts.
    public static func forwardUndoScript(redo: Bool) -> String {
        """
        (() => {
          let doc = document, el = doc.activeElement;
          while (el && el.tagName === "IFRAME") {
            try { doc = el.contentDocument; el = doc && doc.activeElement; } catch { break; }
          }
          if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return "native";
          const target = el && el !== doc.body ? el : doc;
          target.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", metaKey: true, shiftKey: \(redo), bubbles: true, cancelable: true }));
          return "page";
        })()
        """
    }

    /// Whether focus is in editable text (where a typed ⌘Z that reaches the menu means native undo).
    public static let focusEditableScript = """
    (() => {
      let doc = document, el = doc.activeElement;
      while (el && el.tagName === "IFRAME") {
        try { doc = el.contentDocument; el = doc && doc.activeElement; } catch { break; }
      }
      return !!(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
    })()
    """
}
