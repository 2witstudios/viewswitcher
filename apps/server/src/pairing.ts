// Pairing phones and tablets (MAC-24, MAC-26): one-time codes the Mac app shows, and the device tokens
// they are exchanged for.
//
// - A code is 8 characters from an alphabet without look-alikes (I, L, O, 0, 1), lives 5 minutes, and
//   works once. Only one is open at a time: asking for a new one ends the old one. A code is also used
//   up after MAX_CODE_FAILURES wrong guesses against it, and each address may guess only
//   MAX_PEER_FAILURES times per window, so a guesser gets a few dozen tries at ~8.5e11 codes.
// - A device token is 32 random bytes. The store keeps only its SHA3-256 hash, so devices.json can't
//   be turned back into a working token. Removing a device drops its hash: its token stops at once.
//
// Secrets are compared by hashing both sides with SHA3-256 and comparing the digests (the
// aidd-timing-safe-compare rule). Don't "fix" this to a raw === or crypto.timingSafeEqual: a digest
// has no prefix structure to guess one character at a time, and the raw secret never reaches a log.
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const CODE_LENGTH = 8;
export const CODE_TTL_MS = 5 * 60_000;
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const MAX_CODE_FAILURES = 10;
export const MAX_PEER_FAILURES = 5;
export const PEER_WINDOW_MS = 5 * 60_000;
/** Cookie that carries the device token. */
export const COOKIE = "vs_device";
/** Browsers keep a cookie at most 400 days; a device seen within that time stays paired. */
export const COOKIE_MAX_AGE_S = 400 * 24 * 3600;

/** SHA3-256 of a secret, hex. Every comparison of secrets goes through this (see above). */
export const sha3 = (s: string) => new Bun.CryptoHasher("sha3-256").update(s).digest("hex");

export type Device = { id: string; name: string; tokenHash: string; pairedAt: number; lastSeen: number };
/** A device as the Mac app sees it: never the hash. */
export type DeviceInfo = Omit<Device, "tokenHash">;

export type PairResult =
  | { ok: true; token: string; device: DeviceInfo }
  | { ok: false; reason: "wrong" | "expired" | "limited"; error: string };

const randomCode = () => {
  // Rejection sampling keeps every character equally likely (256 isn't a multiple of 31).
  let out = "";
  while (out.length < CODE_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < 256 - (256 % CODE_ALPHABET.length) && out.length < CODE_LENGTH) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return out;
};
const randomToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
const randomId = () => Buffer.from(crypto.getRandomValues(new Uint8Array(9))).toString("base64url");

/** What someone typed or scanned, as a code: case and separators ("abcd-efgh", "ABCD EFGH") don't matter. */
export const normalizeCode = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);

/** A device name from the pairing page: one line, printable, at most 40 characters. */
export function deviceName(raw: unknown, userAgent = ""): string {
  const name = String(raw ?? "").replace(/[\u0000-\u001f\u007f-\u009f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return name || guessName(userAgent);
}

/** "iPhone", "iPad", "Android phone"… from a User-Agent, for the name field's default. */
export function guessName(ua: string): string {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/CrOS/.test(ua)) return "Chromebook";
  return "Device";
}

type Options = {
  /** devices.json; null keeps everything in memory (tests). */
  file: string | null;
  now?: () => number;
  /** How long a code lives; at most CODE_TTL_MS (tests shorten it). */
  ttlMs?: number;
};

export class Pairing {
  private devices = new Map<string, Device>(); // by tokenHash
  private code: { hash: string; expiresAt: number; failures: number } | null = null;
  private peers = new Map<string, number[]>(); // failure times per address
  private readonly now: () => number;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private saving = Promise.resolve();
  /** Called after a device is removed (to close its sockets). */
  onRemoved: (id: string) => void = () => {};

  constructor(private readonly opts: Options) {
    this.now = opts.now ?? Date.now;
  }

  async load() {
    if (!this.opts.file) return this;
    const text = await readFile(this.opts.file, "utf8").catch(() => "");
    try {
      const list = text ? (JSON.parse(text).devices as Device[]) : [];
      for (const d of list) {
        if (typeof d?.tokenHash === "string" && /^[0-9a-f]{64}$/.test(d.tokenHash) && typeof d.id === "string") this.devices.set(d.tokenHash, d);
      }
    } catch {
      console.error("[pairing] devices.json is unreadable; starting with no paired devices");
    }
    return this;
  }

  // ------------------------------------------------------------ codes

  /** A new one-time code (the previous one stops working). The plain code is returned once and never stored. */
  newCode(): { code: string; expiresAt: number } {
    const code = randomCode();
    const expiresAt = this.now() + Math.min(this.opts.ttlMs ?? CODE_TTL_MS, CODE_TTL_MS);
    this.code = { hash: sha3(code), expiresAt, failures: 0 };
    return { code, expiresAt };
  }

  /** When the open code expires, or null (none, used, expired or burned). */
  codeExpiresAt(): number | null {
    return this.code && this.code.expiresAt > this.now() ? this.code.expiresAt : null;
  }

  /** Exchange a code for a device token. `peer` is the socket's address, for the rate limit. */
  pair(candidate: unknown, name: string, peer: string): PairResult {
    const t = this.now();
    const recent = (this.peers.get(peer) ?? []).filter((x) => t - x < PEER_WINDOW_MS);
    this.peers.set(peer, recent);
    if (recent.length >= MAX_PEER_FAILURES) {
      return { ok: false, reason: "limited", error: "Too many tries. Wait a few minutes, then ask the Mac for a new code." };
    }
    const fail = (reason: "wrong" | "expired", error: string): PairResult => {
      recent.push(t);
      if (this.code && ++this.code.failures >= MAX_CODE_FAILURES) this.code = null;
      return { ok: false, reason, error };
    };
    const code = this.code;
    if (!code || code.expiresAt <= t) {
      this.code = null;
      return fail("expired", "That code has expired. Ask the Mac for a new one (Phones and Tablets in its menu).");
    }
    // Hash both sides, compare digests (see the top of this file).
    if (sha3(normalizeCode(candidate)) !== code.hash) return fail("wrong", "That code isn't right. Check it on the Mac and try again.");
    this.code = null; // single use
    const token = randomToken();
    const device: Device = { id: randomId(), name, tokenHash: sha3(token), pairedAt: t, lastSeen: t };
    this.devices.set(device.tokenHash, device);
    this.save();
    return { ok: true, token, device: info(device) };
  }

  // ------------------------------------------------------------ devices

  /** The device a token belongs to (and it was just seen), or null. */
  check(token: string | null | undefined): DeviceInfo | null {
    if (!token) return null;
    const d = this.devices.get(sha3(token)); // a lookup by digest: hash first, never the raw token
    if (!d) return null;
    const t = this.now();
    if (t - d.lastSeen > 60_000) {
      d.lastSeen = t;
      this.save();
    } else d.lastSeen = t;
    return info(d);
  }

  list(): DeviceInfo[] {
    return [...this.devices.values()].map(info).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  remove(id: string): boolean {
    for (const [hash, d] of this.devices) {
      if (d.id !== id) continue;
      this.devices.delete(hash);
      this.save();
      this.onRemoved(id);
      return true;
    }
    return false;
  }

  /** Writes devices.json soon (0600, via a temp file); `flush` waits for it. */
  private save() {
    if (!this.opts.file) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), 200);
  }

  async flush() {
    const file = this.opts.file;
    if (!file) return;
    clearTimeout(this.saveTimer);
    const body = JSON.stringify({ devices: [...this.devices.values()] }, null, 2);
    this.saving = this.saving.then(async () => {
      try {
        await mkdir(dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        await writeFile(tmp, body, { mode: 0o600 });
        await chmod(tmp, 0o600);
        await rename(tmp, file);
      } catch (e) {
        console.error("[pairing] couldn't save devices:", (e as Error).message);
      }
    });
    await this.saving;
  }
}

const info = ({ tokenHash: _, ...d }: Device): DeviceInfo => ({ ...d });

/** The device token from a Cookie header. */
export function tokenFromCookie(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=") || null;
  }
  return null;
}

/** Set-Cookie for a new device token: HttpOnly (no script reads it), SameSite=Strict (no other site sends it). */
export const tokenCookie = (token: string, secure: boolean) =>
  `${COOKIE}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
