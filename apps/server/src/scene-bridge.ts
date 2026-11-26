// The scene bridge (EDIT-26). Scenes run in sandboxed frames with an opaque origin, so the switcher's
// pages can't reach into their DOM, and a scene's own scripts can't reach the switcher (its /api,
// its socket, its pages). The program page still needs two things from the scene on air: where its
// device slots are, and the scene editor's live previews applied in place. This script, added to
// the scene as the server serves it for the program page (?bridge), does both over postMessage:
//
//   page → scene   { viewswitcher: "frame:hello", id }                 → frame:state
//                  { viewswitcher: "frame:liveEdit", id, hash, edit }   → frame:applied
//   scene → page   { viewswitcher: "frame:state", id, slots, version, hold }
//                  { viewswitcher: "frame:applied", id, applied, slotMoved, slots, version }
//
// A scene's scripts run in the same frame and can talk to the page too, but only about themselves:
// the page accepts a message only from the frame it's showing, and all it can learn is that frame's
// own slots, which the scene's markup decides anyway. Never written to files; plain ES5 so any
// browser source runs it.
export const SCENE_BRIDGE = `(function () {
  var doc = document;
  function slots() {
    var out = [];
    var els = doc.querySelectorAll("[data-slot]");
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      out.push({ source: String(els[i].getAttribute("data-slot")), x: r.left, y: r.top, w: r.width, h: r.height });
    }
    return out;
  }
  /* The version the frame shows: stamped on <html>, or on a bare fragment's first element. */
  function version() {
    var h = doc.documentElement.getAttribute("data-vs-hash");
    if (h) return h;
    var el = doc.querySelector("[data-vs-hash]");
    return el ? el.getAttribute("data-vs-hash") : null;
  }
  function hold() {
    var m = doc.querySelector('meta[name="viewswitcher:hold"]');
    return m ? m.getAttribute("content") : null;
  }
  /* A live edit from the scene editor, only if it was made against this version, and only what can
     change safely: text into an element with no child elements, a library picture into an <img>,
     a position or size. Adding and deleting reach the stream as the saved file. */
  function apply(hash, edit) {
    var shown = version();
    if (!shown || shown !== hash || !edit || typeof edit !== "object") return null;
    var id = Number(edit.id);
    if (!(id >= 0) || Math.floor(id) !== id) return null;
    var el = doc.querySelector('[data-vs="' + id + '"]');
    if (!el) return null;
    if ("insert" in edit || "remove" in edit) return null;
    if ("text" in edit) {
      if (el.childElementCount !== 0 || typeof edit.text !== "string") return null;
      el.textContent = edit.text;
      return { slotMoved: false };
    }
    if ("src" in edit) {
      if (String(el.tagName).toLowerCase() !== "img" || typeof edit.src !== "string" || edit.src.indexOf("/library/") !== 0) return null;
      el.setAttribute("src", edit.src);
      return { slotMoved: false };
    }
    var n = function (v) { return typeof v === "number" && isFinite(v) ? v : null; };
    if ("width" in edit) {
      if (n(edit.width) === null || n(edit.height) === null) return null;
      el.style.width = edit.width + "px";
      el.style.height = edit.height + "px";
    }
    if (n(edit.left) !== null) el.style.left = edit.left + "px";
    if (n(edit.top) !== null) el.style.top = edit.top + "px";
    return { slotMoved: el.matches("[data-slot]") || !!el.querySelector("[data-slot]") };
  }
  addEventListener("message", function (e) {
    if (e.source !== parent || parent === window) return;
    var d = e.data;
    if (!d || typeof d !== "object") return;
    if (d.viewswitcher === "frame:hello") {
      parent.postMessage({ viewswitcher: "frame:state", id: d.id, slots: slots(), version: version(), hold: hold() }, "*");
    } else if (d.viewswitcher === "frame:liveEdit") {
      var r = null;
      try { r = apply(d.hash, d.edit); } catch (err) { r = null; }
      parent.postMessage({ viewswitcher: "frame:applied", id: d.id, applied: !!r, slotMoved: !!(r && r.slotMoved), slots: r && r.slotMoved ? slots() : null, version: version() }, "*");
    }
  });
})();`;

/** `html` with the bridge added at its very end (after </html> is fine: the parser puts it in <body>). */
export const withBridge = (html: string) => `${html}${html.endsWith("\n") ? "" : "\n"}<script>${SCENE_BRIDGE}</script>\n`;
