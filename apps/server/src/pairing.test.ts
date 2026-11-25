import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODE_ALPHABET, CODE_LENGTH, CODE_TTL_MS, COOKIE, deviceName, guessName, MAX_CODE_FAILURES, MAX_PEER_FAILURES, normalizeCode, Pairing, PEER_WINDOW_MS, sha3, tokenCookie, tokenFromCookie } from "./pairing";

const clock = () => {
  let t = 1_000_000;
  return { now: () => t, tick: (ms: number) => (t += ms) };
};
const dir = mkdtempSync(join(tmpdir(), "vs-pairing-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("one-time codes", () => {
  test("8 characters from an alphabet without look-alikes", () => {
    const p = new Pairing({ file: null });
    for (let i = 0; i < 50; i++) {
      const { code } = p.newCode();
      expect(code).toHaveLength(CODE_LENGTH);
      for (const c of code) expect(CODE_ALPHABET).toContain(c);
    }
    expect(CODE_ALPHABET).not.toMatch(/[ILO01]/);
  });
  test("work once", () => {
    const p = new Pairing({ file: null });
    const { code } = p.newCode();
    const first = p.pair(code, "iPhone", "192.168.1.20");
    expect(first.ok).toBe(true);
    expect(p.pair(code, "iPhone", "192.168.1.21")).toMatchObject({ ok: false, reason: "expired" });
    expect(p.codeExpiresAt()).toBeNull();
  });
  test("expire after 5 minutes", () => {
    const c = clock();
    const p = new Pairing({ file: null, now: c.now });
    const { code, expiresAt } = p.newCode();
    expect(expiresAt - c.now()).toBe(CODE_TTL_MS);
    c.tick(CODE_TTL_MS - 1);
    expect(p.codeExpiresAt()).toBe(expiresAt);
    c.tick(1);
    expect(p.codeExpiresAt()).toBeNull();
    expect(p.pair(code, "iPhone", "192.168.1.20")).toMatchObject({ ok: false, reason: "expired" });
  });
  test("a new code ends the old one", () => {
    const p = new Pairing({ file: null });
    const old = p.newCode().code;
    const next = p.newCode().code;
    expect(p.pair(old, "a", "192.168.1.20").ok).toBe(old === next);
    expect(p.pair(next, "a", "192.168.1.21").ok).toBe(old !== next);
  });
  test("accept what people type: lower case, a dash or spaces", () => {
    const p = new Pairing({ file: null });
    const { code } = p.newCode();
    expect(normalizeCode(` ${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `)).toBe(code);
    expect(p.pair(`${code.slice(0, 4).toLowerCase()} ${code.slice(4)}`, "a", "192.168.1.20").ok).toBe(true);
  });
  test("only a hash of the code is kept", () => {
    const p = new Pairing({ file: null });
    const { code } = p.newCode();
    expect(JSON.stringify((p as any).code)).not.toContain(code);
    expect((p as any).code.hash).toBe(sha3(code));
  });
});

describe("rate limits", () => {
  test(`${MAX_PEER_FAILURES} wrong guesses from one address, then it waits (even with the right code)`, () => {
    const c = clock();
    const p = new Pairing({ file: null, now: c.now });
    const { code } = p.newCode();
    for (let i = 0; i < MAX_PEER_FAILURES; i++) expect(p.pair("WRONGXYZ", "a", "192.168.1.66")).toMatchObject({ ok: false, reason: "wrong" });
    expect(p.pair(code, "a", "192.168.1.66")).toMatchObject({ ok: false, reason: "limited" });
    expect(p.pair(code, "a", "192.168.1.67").ok).toBe(true); // another device isn't held up
    c.tick(PEER_WINDOW_MS);
    expect(p.pair(p.newCode().code, "a", "192.168.1.66").ok).toBe(true);
  });
  test(`a code is used up after ${MAX_CODE_FAILURES} wrong guesses from anywhere`, () => {
    const p = new Pairing({ file: null });
    const { code } = p.newCode();
    for (let i = 0; i < MAX_CODE_FAILURES; i++) p.pair("WRONGXYZ", "a", `192.168.1.${i}`);
    expect(p.codeExpiresAt()).toBeNull();
    expect(p.pair(code, "a", "192.168.1.200")).toMatchObject({ ok: false, reason: "expired" });
  });
});

describe("device tokens", () => {
  test("32 random bytes; only the hash is stored; it lets the device in", () => {
    const p = new Pairing({ file: null });
    const r = p.pair(p.newCode().code, "Jono's iPhone", "192.168.1.20");
    if (!r.ok) throw new Error("pairing failed");
    expect(Buffer.from(r.token, "base64url")).toHaveLength(32);
    expect(JSON.stringify([...(p as any).devices.values()])).not.toContain(r.token);
    expect(p.check(r.token)).toMatchObject({ id: r.device.id, name: "Jono's iPhone" });
    expect(p.list()[0]).not.toHaveProperty("tokenHash");
  });
  test("a missing, wrong or almost-right token is refused", () => {
    const p = new Pairing({ file: null });
    const r = p.pair(p.newCode().code, "a", "192.168.1.20");
    if (!r.ok) throw new Error("pairing failed");
    for (const t of [null, undefined, "", "nope", r.token.slice(0, -1), r.token + "A", sha3(r.token)]) expect(p.check(t)).toBeNull();
  });
  test("removing a device stops its token at once, and says so", () => {
    const p = new Pairing({ file: null });
    const removed: string[] = [];
    p.onRemoved = (id) => removed.push(id);
    const a = p.pair(p.newCode().code, "a", "192.168.1.20");
    const b = p.pair(p.newCode().code, "b", "192.168.1.21");
    if (!a.ok || !b.ok) throw new Error("pairing failed");
    expect(p.remove(a.device.id)).toBe(true);
    expect(p.check(a.token)).toBeNull();
    expect(p.check(b.token)).not.toBeNull();
    expect(removed).toEqual([a.device.id]);
    expect(p.remove("no-such-id")).toBe(false);
  });
  test("last seen follows the device", () => {
    const c = clock();
    const p = new Pairing({ file: null, now: c.now });
    const r = p.pair(p.newCode().code, "a", "192.168.1.20");
    if (!r.ok) throw new Error("pairing failed");
    c.tick(90_000);
    expect(p.check(r.token)?.lastSeen).toBe(c.now());
  });
  test("devices.json keeps hashes only (0600) and survives a restart", async () => {
    const file = join(dir, "devices.json");
    const p = await new Pairing({ file }).load();
    const r = p.pair(p.newCode().code, "iPad", "192.168.1.20");
    if (!r.ok) throw new Error("pairing failed");
    await p.flush();
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain(r.token);
    expect(text).toContain(sha3(r.token));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const again = await new Pairing({ file }).load();
    expect(again.check(r.token)?.name).toBe("iPad");
    again.remove(r.device.id);
    await again.flush();
    expect((await new Pairing({ file }).load()).check(r.token)).toBeNull();
  });
});

describe("cookie and names", () => {
  test("the cookie is HttpOnly and SameSite=Strict, and parses back", () => {
    const c = tokenCookie("abc", false);
    expect(c).toMatch(/^vs_device=abc; /);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Strict");
    expect(c).not.toContain("Secure");
    expect(tokenCookie("abc", true)).toContain("; Secure");
    expect(tokenFromCookie(`a=1; ${COOKIE}=tok-en_x; b=2`)).toBe("tok-en_x");
    expect(tokenFromCookie("a=1")).toBeNull();
    expect(tokenFromCookie(null)).toBeNull();
    expect(tokenFromCookie(`x${COOKIE}=nope`)).toBeNull();
  });
  test("device names: one clean line, or a guess from the browser", () => {
    expect(deviceName("  Jono's\n iPhone  ")).toBe("Jono's iPhone");
    expect(deviceName("<script>x</script>")).toBe("scriptx/script");
    expect(deviceName("x".repeat(80))).toHaveLength(40);
    expect(deviceName("", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iPhone");
    expect(guessName("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari")).toBe("Android phone");
    expect(guessName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Version/18.0 Mobile/15E148 Safari")).toBe("iPad");
    expect(guessName("curl/8")).toBe("Device");
  });
});
