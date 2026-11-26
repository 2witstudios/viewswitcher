// The iPad beta signup: an email into a Resend segment, for TestFlight invites.
// api/ipad-beta.ts is the Vercel function; this is the whole of it, with fetch and the env passed
// in so the tests can fake Resend.
//
// The form posts here with or without JavaScript. With it, the page asks for JSON (Accept:
// application/json) and shows the message in place; without it, the answer is a 303 back to
// /ai#beta-<state>, where CSS (:target) shows the matching message.
//
// Abuse resistance with no new service: POST only, a same-origin Origin, a capped form body, and a
// hidden honeypot field ("website") that a person never fills in. Answers are generic: someone
// already on the list gets the same "You're on the list" as someone new.

export type BetaEnv = { RESEND_API_KEY?: string; RESEND_AUDIENCE_ID?: string };
export type BetaState = "joined" | "invalid" | "closed" | "error";

export const BETA_MESSAGES: Record<BetaState, string> = {
  joined: "You're on the list. We'll email your TestFlight invite when the beta opens.",
  invalid: "That doesn't look like an email.",
  closed: "Sign-ups aren't open yet.",
  error: "Something went wrong. Try again in a minute.",
};

const STATUS: Record<BetaState, number> = { joined: 200, invalid: 400, closed: 503, error: 502 };
/** A form with one email in it is well under this. */
export const MAX_BODY = 2048;
/** The page the form is on, where a plain POST lands again. */
const PAGE = "/ai";
const SITE_ORIGIN = "https://viewswitcher.com";
const RESEND = "https://api.resend.com";

/** An ordinary address: one @, no spaces or brackets, a dotted domain with no empty labels, at most 254 characters. */
export function isEmail(s: string): boolean {
  if (s.length > 254) return false;
  return /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:".]+(\.[^\s@<>()[\]\\,;:".]+)+$/.test(s);
}

const noStore = { "cache-control": "no-store" };

function plain(status: number, text: string, extra: Record<string, string> = {}) {
  return new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", ...noStore, ...extra } });
}

function answer(state: BetaState, wantsJson: boolean): Response {
  if (wantsJson) {
    return new Response(JSON.stringify({ ok: state === "joined", state, message: BETA_MESSAGES[state] }), {
      status: STATUS[state],
      headers: { "content-type": "application/json; charset=utf-8", ...noStore },
    });
  }
  return new Response(null, { status: 303, headers: { location: `${PAGE}?beta=${state}#beta-${state}`, ...noStore } });
}

/** This site's own origins: viewswitcher.com, and the host the request came in on (a preview, or local). */
function sameOrigin(req: Request, origin: string | null): boolean {
  if (!origin || origin === "null") return false;
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(/:$/, "");
  const allowed = new Set([SITE_ORIGIN, url.origin]);
  for (const host of [req.headers.get("x-forwarded-host"), req.headers.get("host")]) if (host) allowed.add(`${proto}://${host}`);
  return allowed.has(origin);
}

/** The body as text, or null once it passes `max` bytes (read in chunks, so a huge body is never held whole). */
async function readCapped(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (declared > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return new TextDecoder().decode(all);
}

/** Resend (resend.com/docs/api-reference/contacts): create the contact in the segment, or add one Resend already has. */
async function addToSegment(email: string, env: Required<BetaEnv>, fetcher: typeof fetch): Promise<boolean> {
  const headers = {
    authorization: `Bearer ${env.RESEND_API_KEY}`,
    "content-type": "application/json",
    // Resend refuses requests without one.
    "user-agent": "viewswitcher-site",
  };
  const signal = AbortSignal.timeout(8000);
  const created = await fetcher(`${RESEND}/contacts`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, unsubscribed: false, segments: [{ id: env.RESEND_AUDIENCE_ID }] }),
    signal,
  });
  if (created.ok) return true;
  // Contacts are global in Resend: an email it already has (from anywhere) can't be created again,
  // so put that contact in the segment instead. Either way the person hears the same thing.
  if (created.status !== 409 && created.status !== 422) return false;
  const added = await fetcher(`${RESEND}/contacts/${encodeURIComponent(email)}/segments/${encodeURIComponent(env.RESEND_AUDIENCE_ID)}`, { method: "POST", headers, signal });
  return added.ok;
}

export async function handleBeta(req: Request, env: BetaEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  if (req.method !== "POST") return plain(405, "Use the form on viewswitcher.com/ai.", { allow: "POST" });
  if (!sameOrigin(req, req.headers.get("origin"))) return plain(403, "Sign up from viewswitcher.com/ai.");
  const wantsJson = (req.headers.get("accept") ?? "").includes("application/json");
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) return plain(415, "Send the form.");
  const body = await readCapped(req, MAX_BODY);
  if (body === null) return plain(413, "That's too much.");
  const form = new URLSearchParams(body);
  // The honeypot: hidden from people, filled in by bots. Tell them it worked, and do nothing.
  if ((form.get("website") ?? "") !== "") return answer("joined", wantsJson);
  const email = (form.get("email") ?? "").trim();
  if (!isEmail(email)) return answer("invalid", wantsJson);
  const key = env.RESEND_API_KEY?.trim();
  const segment = env.RESEND_AUDIENCE_ID?.trim();
  if (!key || !segment) return answer("closed", wantsJson);
  try {
    const ok = await addToSegment(email, { RESEND_API_KEY: key, RESEND_AUDIENCE_ID: segment }, fetcher);
    if (!ok) console.error("[ipad-beta] Resend refused the contact");
    return answer(ok ? "joined" : "error", wantsJson);
  } catch (e) {
    console.error(`[ipad-beta] Resend failed: ${(e as Error).name}`);
    return answer("error", wantsJson);
  }
}
