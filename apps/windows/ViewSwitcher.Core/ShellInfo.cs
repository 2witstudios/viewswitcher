using System.Text.Json;

namespace ViewSwitcher.Core;

/// <summary>
/// How the Windows window tells the switcher page where it is (Kit's ShellInfo): &lt;html data-shell="windows"&gt;
/// and a notice banner for what the app itself has to say (its server stopped and is coming back). The
/// Windows window keeps the system title bar, so it sets no insets. The page gets no way to talk back:
/// nothing is posted from the page to the app (scenes are untrusted, AGENTS.md).
/// </summary>
public sealed record ShellInfo(string? Notice = null)
{
    public const string Kind = "windows";
    public const string NoticeId = "viewswitcher-shell-notice";

    public string ToJson() => JsonSerializer.Serialize(new { kind = Kind, fullscreen = false, vars = new Dictionary<string, string>(), notice = Notice });

    /// <summary>Added to every document the main frame loads, before the page's own scripts.</summary>
    public string UserScript() => $$"""
        (() => {
          if (window.top !== window) return; // the main frame only, never a scene
          const notice = (text) => {
            let el = document.getElementById("{{NoticeId}}");
            if (!text) { if (el) el.remove(); return; }
            if (!document.body) return;
            if (!el) {
              el = document.createElement("div");
              el.id = "{{NoticeId}}";
              el.setAttribute("role", "status");
              Object.assign(el.style, {
                position: "fixed", top: "12px", left: "50%", transform: "translateX(-50%)",
                zIndex: "2147483647", maxWidth: "min(560px, 90vw)", padding: "10px 16px", borderRadius: "10px",
                background: "rgba(32, 32, 36, 0.96)", color: "#fff", border: "1px solid rgba(255, 255, 255, 0.16)",
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)", font: "500 13px/1.4 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
                textAlign: "center", pointerEvents: "none",
              });
              document.body.appendChild(el);
            }
            el.textContent = text;
          };
          const apply = (s) => {
            const r = document.documentElement;
            if (!r) return;
            r.dataset.shell = s.kind;
            r.classList.toggle("shell-fullscreen", !!s.fullscreen);
            for (const [k, v] of Object.entries(s.vars || {})) r.style.setProperty(k, v);
            notice(s.notice);
          };
          let current = {{ToJson()}};
          Object.defineProperty(window, "viewswitcherShell", { value: Object.freeze({ apply: (s) => { current = s; apply(s); } }) });
          apply(current);
          document.addEventListener("DOMContentLoaded", () => apply(current));
        })();
        """;

    /// <summary>Re-applies the info in a page that's already loaded.</summary>
    public string ApplyScript() => $"window.viewswitcherShell && window.viewswitcherShell.apply({ToJson()});";
}
