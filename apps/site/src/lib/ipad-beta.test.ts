import { describe, expect, test } from "bun:test";
import { BETA_MESSAGES, handleBeta, isEmail } from "./ipad-beta";

const ENV = { RESEND_API_KEY: "re_test", RESEND_AUDIENCE_ID: "seg_123" };
type Call = { url: string; init: RequestInit };

/** A fake fetch that answers each call in turn with the given statuses, and records what was sent. */
function fakeFetch(...statuses: number[]) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const status = statuses[calls.length - 1] ?? 500;
    return new Response(JSON.stringify(status < 300 ? { object: "contact", id: "c1" } : { name: "error", message: "nope" }), { status });
  }) as typeof fetch;
  return { fn, calls };
}

function post(fields: Record<string, string>, opts: { origin?: string | null; json?: boolean; host?: string; body?: string; type?: string } = {}) {
  const headers: Record<string, string> = { "content-type": opts.type ?? "application/x-www-form-urlencoded" };
  if (opts.origin !== null) headers.origin = opts.origin ?? "https://viewswitcher.com";
  if (opts.json) headers.accept = "application/json";
  headers.host = opts.host ?? "viewswitcher.com";
  return new Request(`https://${opts.host ?? "viewswitcher.com"}/api/ipad-beta`, { method: "POST", headers, body: opts.body ?? new URLSearchParams(fields).toString() });
}

const json = async (res: Response) => (await res.json()) as { ok: boolean; state: string; message: string };

describe("isEmail", () => {
  test("takes ordinary addresses and refuses the rest", () => {
    for (const ok of ["a@b.co", "jo.smith+beta@mail.example.org", "x_y@sub.domain.io"]) expect(isEmail(ok)).toBe(true);
    for (const bad of ["", "a", "a@b", "a@b.", "@b.co", "a b@c.co", "a@b c.co", "a@@b.co", "<a@b.co>", "a@b.co,c@d.co", "a@.b.co", "a@b..co", `${"a".repeat(250)}@b.co`]) expect(isEmail(bad)).toBe(false);
  });
});

describe("the iPad beta signup", () => {
  test("a valid email goes into the Resend segment, and the answer is generic", async () => {
    const f = fakeFetch(201);
    const res = await handleBeta(post({ email: "  Jo@Example.com " }, { json: true }), ENV, f.fn);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, state: "joined", message: BETA_MESSAGES.joined });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe("https://api.resend.com/contacts");
    expect(f.calls[0]!.init.method).toBe("POST");
    const h = new Headers(f.calls[0]!.init.headers);
    expect(h.get("authorization")).toBe("Bearer re_test");
    expect(h.get("content-type")).toBe("application/json");
    expect(h.get("user-agent")).toBeTruthy();
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ email: "Jo@Example.com", unsubscribed: false, segments: [{ id: "seg_123" }] });
  });

  test("an email Resend already has is added to the segment, with the same answer", async () => {
    const f = fakeFetch(409, 200);
    const res = await handleBeta(post({ email: "jo@example.com" }, { json: true }), ENV, f.fn);
    expect(await json(res)).toEqual({ ok: true, state: "joined", message: BETA_MESSAGES.joined });
    expect(f.calls[1]!.url).toBe("https://api.resend.com/contacts/jo%40example.com/segments/seg_123");
    expect(f.calls[1]!.init.method).toBe("POST");
  });

  test("without JavaScript, a plain POST is redirected back to the page", async () => {
    const f = fakeFetch(201);
    const res = await handleBeta(post({ email: "jo@example.com" }), ENV, f.fn);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/ai?beta=joined#beta-joined");
    const bad = await handleBeta(post({ email: "nope" }), ENV, f.fn);
    expect(bad.status).toBe(303);
    expect(bad.headers.get("location")).toBe("/ai?beta=invalid#beta-invalid");
  });

  test("a bad email is refused without calling Resend", async () => {
    const f = fakeFetch();
    for (const fields of [{ email: "not-an-email" }, {}] as Record<string, string>[]) {
      const res = await handleBeta(post(fields, { json: true }), ENV, f.fn);
      expect(res.status).toBe(400);
      expect(await json(res)).toEqual({ ok: false, state: "invalid", message: BETA_MESSAGES.invalid });
    }
    expect(f.calls).toHaveLength(0);
  });

  test("the honeypot: a filled hidden field looks like success and sends nothing", async () => {
    const f = fakeFetch();
    const res = await handleBeta(post({ email: "bot@example.com", website: "https://spam.example" }, { json: true }), ENV, f.fn);
    expect(res.status).toBe(200);
    expect((await json(res)).state).toBe("joined");
    expect(f.calls).toHaveLength(0);
  });

  test("anything but POST is refused", async () => {
    const f = fakeFetch();
    for (const method of ["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]) {
      const res = await handleBeta(new Request("https://viewswitcher.com/api/ipad-beta", { method }), ENV, f.fn);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
    expect(f.calls).toHaveLength(0);
  });

  test("a POST from another site, or with no Origin, is refused", async () => {
    const f = fakeFetch();
    for (const origin of ["https://evil.example", "null", "http://viewswitcher.com", "https://viewswitcher.com.evil.example", null]) {
      const res = await handleBeta(post({ email: "jo@example.com" }, { origin, json: true }), ENV, f.fn);
      expect(res.status).toBe(403);
    }
    expect(f.calls).toHaveLength(0);
  });

  test("a preview deployment accepts its own origin", async () => {
    const f = fakeFetch(201);
    const host = "viewswitcher-site-abc123.vercel.app";
    const res = await handleBeta(post({ email: "jo@example.com" }, { origin: `https://${host}`, host, json: true }), ENV, f.fn);
    expect(res.status).toBe(200);
  });

  test("missing env: 503, sign-ups aren't open yet", async () => {
    const f = fakeFetch();
    for (const env of [{}, { RESEND_API_KEY: "re_test" }, { RESEND_AUDIENCE_ID: "seg_123" }, { RESEND_API_KEY: " ", RESEND_AUDIENCE_ID: "seg_123" }]) {
      const res = await handleBeta(post({ email: "jo@example.com" }, { json: true }), env, f.fn);
      expect(res.status).toBe(503);
      expect(await json(res)).toEqual({ ok: false, state: "closed", message: BETA_MESSAGES.closed });
    }
    const plain = await handleBeta(post({ email: "jo@example.com" }), {}, f.fn);
    expect(plain.headers.get("location")).toBe("/ai?beta=closed#beta-closed");
    expect(f.calls).toHaveLength(0);
  });

  test("a Resend error is a generic failure, never Resend's own words", async () => {
    for (const statuses of [[500], [401], [429], [422, 404]]) {
      const f = fakeFetch(...statuses);
      const res = await handleBeta(post({ email: "jo@example.com" }, { json: true }), ENV, f.fn);
      expect(res.status).toBe(502);
      expect(await json(res)).toEqual({ ok: false, state: "error", message: BETA_MESSAGES.error });
    }
    const throws = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    const res = await handleBeta(post({ email: "jo@example.com" }, { json: true }), ENV, throws);
    expect((await json(res)).state).toBe("error");
  });

  test("the body is capped", async () => {
    const f = fakeFetch(201);
    const res = await handleBeta(post({}, { json: true, body: `email=jo%40example.com&pad=${"x".repeat(5000)}` }), ENV, f.fn);
    expect(res.status).toBe(413);
    expect(f.calls).toHaveLength(0);
  });

  test("only form posts are read", async () => {
    const f = fakeFetch(201);
    const res = await handleBeta(post({}, { json: true, type: "text/plain", body: "email=jo@example.com" }), ENV, f.fn);
    expect(res.status).toBe(415);
    expect(f.calls).toHaveLength(0);
  });

  test("answers are never cached", async () => {
    const res = await handleBeta(post({ email: "jo@example.com" }, { json: true }), ENV, fakeFetch(201).fn);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
