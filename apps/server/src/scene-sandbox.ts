// How library files are served (EDIT-26). Scenes are HTML that anyone may have written: an agent, a
// style pack from a stranger. Served plainly from /library/, a scene would be same-origin with the
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
// Pictures, media, documents and JSON never are: any website open on this Mac could read them then.
// The CSP goes on every /library/ response, whatever its name: what a browser renders comes from the
// file's type, not the request path ("x.html/", ".shtml", ".xsl" are documents too), and a CSP on an
// image or a stylesheet does nothing.
/** Library files a scene loads in CORS mode (module scripts, @font-face): code and styles, never an org's pictures, media, documents or JSON. */
const CORS_OK = /\.(woff2?|ttf|otf|js|mjs|css)$/i;

export const SCENE_CSP = "sandbox allow-scripts; connect-src https: wss:; object-src 'none'; base-uri 'none'; form-action 'none'";
export const INERT_CSP = "sandbox allow-same-origin allow-scripts; script-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'";

/** Headers for a /library/ response: `rel` is its library path. */
export function libraryHeaders(rel: string, inert = false): Record<string, string> {
  const h: Record<string, string> = { "x-content-type-options": "nosniff", "content-security-policy": inert ? INERT_CSP : SCENE_CSP };
  if (CORS_OK.test(rel)) h["access-control-allow-origin"] = "*";
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
