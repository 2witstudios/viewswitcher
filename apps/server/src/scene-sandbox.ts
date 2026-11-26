import { posix } from "node:path";
// How library files are served. Scenes are HTML that anyone may have written: an agent, a
// template pack from a stranger. Served plainly from /library/, a scene would be same-origin with the
// switcher, so its scripts could call /api (go on air, edit files, upload), open the live socket,
// or reach into the page that frames it.
//
// So every library document is served with a CSP sandbox, which gives it an opaque origin however
// it's opened (in a frame or on its own):
//
// - Normally `sandbox allow-scripts`: its scripts run (countdowns, transitions, a pack's effects),
//   but as no site at all. Its requests carry `Origin: null`, which the API and the socket refuse
//   (origin.ts), and it can't read anything back from this server (no CORS). It can't reach into
//   the switcher's pages either, nor navigate them, open windows or submit forms.
//   `connect-src https: wss:` also keeps its scripts off plain-http and ws: addresses, which is
//   where this Mac's and the LAN's unauthenticated services are (OBS's websocket on :4455 among
//   them), while a scene that shows a feed from an https service still can.
// - `?inert` (the scene editor's frame): same-origin, because the editor reads and changes the scene's
//   DOM in place, but none of the scene's own code runs: `script-src 'none'` blocks its scripts,
//   inline handlers and javascript: links, and it may hold no frames, objects or workers. (The
//   sandbox keeps allow-scripts here only because WebKit, on the iPad and in the Mac app, won't run
//   even the editor's own listeners inside a frame without it; the CSP is what keeps the scene's
//   code from running.) Every <meta> is defused too, so a refresh can't take the frame elsewhere, and
//   only a body that went through that gets this CSP: any other ?inert request gets the normal one.
//
// The switcher's own frames carry the same sandbox attribute, so this holds twice. Scripts, styles
// and fonts are sent with CORS (an opaque-origin page's @font-face and module scripts need it).
// So are the pictures and media of templates (theme, brand marks, a template set's own pictures):
// a CSS mask is always fetched in CORS mode (Daisy's chapter card masks its petals), and so is a
// crossorigin <img>. An opaque-origin scene sends no Referer, so the server can't tell a scene from
// another website: these are design files, so that's fine. An org's own media (assets/, projects/:
// uploads, dropped photos) is never sent with CORS, so other websites on this Mac can't read it.
// Documents and JSON never are.
// The CSP goes on every /library/ response, whatever its name: what a browser renders comes from the
// file's type, not the request path ("x.html/", ".shtml", ".xsl" are documents too), and a CSP on an
// image or a stylesheet does nothing.
/** Library files a scene loads in CORS mode (module scripts, @font-face): code, styles and fonts. Never documents or JSON. */
const CORS_OK = /\.(woff2?|ttf|otf|js|mjs|css)$/i;
/** Pictures and media of templates (`<org>/templates/…`, and a staged pack's preview copy): design files, sent with CORS. */
const TEMPLATE_MEDIA = /^[^/]+\/(templates|\.viewswitcher\/staging\/[0-9a-f]+\/preview)\/.+\.(png|jpe?g|gif|webp|avif|svg|mp4|webm|mov|m4v|mp3|wav|m4a|aac|ogg)$/i;

export const SCENE_CSP = "sandbox allow-scripts; connect-src https: wss:; object-src 'none'; base-uri 'none'; form-action 'none'";
export const INERT_CSP = "sandbox allow-same-origin allow-scripts; script-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'";

/** Headers for a /library/ response: `rel` is its library path. */
export function libraryHeaders(rel: string, inert = false): Record<string, string> {
  const h: Record<string, string> = { "x-content-type-options": "nosniff", "content-security-policy": inert ? INERT_CSP : SCENE_CSP };
  // Matched on the path the file is really served from: "templates/../assets/x.jpg" is the org's own media.
  if (CORS_OK.test(rel) || TEMPLATE_MEDIA.test(posix.normalize(rel))) h["access-control-allow-origin"] = "*";
  return h;
}

/**
 * The editor's copy of a scene, with no <meta> left that could act: a refresh would navigate the
 * same-origin frame. Fail closed rather than parse: every literal `<meta` start tag, in any context
 * (comments, CDATA, SVG, attribute tricks), becomes `<link data-vs-meta`. A meta element can only
 * come from that text (no script runs under INERT_CSP to make one), `link` is void and allowed in
 * head (and stays a plain element inside SVG), so the page keeps its shape; renaming one too many
 * (a charset meta: the response says utf-8) does no harm.
 */
export const defuseMeta = (html: string): string => html.replace(/<meta(?=[\s/>])/gi, "<link data-vs-meta");
