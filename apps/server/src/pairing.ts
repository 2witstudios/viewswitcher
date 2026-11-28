// Pairing phones and tablets: one-time codes the Mac app shows, and the remotes' tokens
// they are exchanged for.
//
// - A code is 8 characters from an alphabet without look-alikes (I, L, O, 0, 1), lives 5 minutes, and
//   works once. Only one is open at a time: asking for a new one ends the old one. A code is also used
//   up after MAX_CODE_FAILURES wrong guesses against it, and each address may guess only
//   MAX_PEER_FAILURES times per window, so a guesser gets a few dozen tries at ~8.5e11 codes.
// - A device token is 32 random bytes. The store keeps only its SHA3-256 hash, so devices.json can't
//   be turned back into a working token. Removing a remote drops its hash: its token stops at once.
//
// Secrets are compared by hashing both sides with SHA3-256 and comparing the digests (the
// aidd-timing-safe-compare rule). Don't "fix" this to a raw === or crypto.timingSafeEqual: a digest
// has no prefix structure to guess one character at a time, and the raw secret never reaches a log.
import { COMPUTER } from "./platform-dirs";
import { readFile } from "node:fs/promises";
import { writeAtomic } from "./atomic";

export const CODE_LENGTH = 8;
export const CODE_TTL_MS = 5 * 60_000;
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const MAX_CODE_FAILURES = 10;
export const MAX_PEER_FAILURES = 5;
export const PEER_WINDOW_MS = 5 * 60_000;
/** Cookie that carries a remote's token. */
export const COOKIE = "vs_device";
/** Browsers keep a cookie at most 400 days. The cookie is sent again at most once a day while a remote is
 *  in use (`renew`), so a remote used within that time stays paired. */
export const COOKIE_MAX_AGE_S = 400 * 24 * 3600;
const RENEW_MS = 24 * 3600_000;

/** SHA3-256 of a secret, hex. Every comparison of secrets goes through this (see above). */
export const sha3 = (s: string) => new Bun.CryptoHasher("sha3-256").update(s).digest("hex");

export type Remote = { id: string; name: string; tokenHash: string; pairedAt: number; lastSeen: number };
/** A paired remote as the Mac app sees it: never the hash. */
export type RemoteInfo = Omit<Remote, "tokenHash">;

export type PairResult =
  | { ok: true; token: string; remote: RemoteInfo }
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

/** A paired remote's name from the pairing page: one line, printable, at most 40 characters. */
export function remoteName(raw: unknown, userAgent = ""): string {
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
  return "Phone or tablet";
}

type Options = {
  /** devices.json; null keeps everything in memory (tests). */
  file: string | null;
  now?: () => number;
  /** How long a code lives; at most CODE_TTL_MS (tests shorten it). */
  ttlMs?: number;
};

export class Pairing {
  private remotes = new Map<string, Remote>(); // by tokenHash
  private code: { hash: string; expiresAt: number; failures: number } | null = null;
  /** The last code was cancelled by wrong guesses (someone on the network is guessing); the Mac says so. */
  codeGuessed = false;
  private peers = new Map<string, number[]>(); // wrong-guess times per address (only addresses that guessed wrong)
  private renewed = new Map<string, number>(); // when each remote's cookie was last sent
  private lastSaved = 0; // when a lastSeen change was last scheduled for writing
  private readonly now: () => number;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private saving: Promise<void> = Promise.resolve();
  /** Called after a remote is removed (to close its sockets). */
  onRemoved: (id: string) => void = () => {};

  constructor(private readonly opts: Options) {
    this.now = opts.now ?? Date.now;
  }

  async load() {
    if (!this.opts.file) return this;
    const text = await readFile(this.opts.file, "utf8").catch(() => "");
    try {
      const list = text ? (JSON.parse(text).devices as Remote[]) : [];
      for (const d of list) {
        if (typeof d?.tokenHash === "string" && /^[0-9a-f]{64}$/.test(d.tokenHash) && typeof d.id === "string") this.remotes.set(d.tokenHash, d);
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
    this.codeGuessed = false;
    // Forget addresses whose wrong guesses are all older than the window.
    const t = this.now();
    for (const [peer, times] of this.peers) if (!times.some((x) => t - x < PEER_WINDOW_MS)) this.peers.delete(peer);
    return { code, expiresAt };
  }

  /** When the open code expires, or null (none, used, expired or burned). */
  codeExpiresAt(): number | null {
    return this.code && this.code.expiresAt > this.now() ? this.code.expiresAt : null;
  }

  /** Exchange a code for a remote's token. `peer` keys the rate limit: the socket's address, or the
   *  forwarded client's for a proxied request (a bucket key only, never trusted for anything else). */
  pair(candidate: unknown, name: string, peer: string): PairResult {
    const t = this.now();
    const recent = (this.peers.get(peer) ?? []).filter((x) => t - x < PEER_WINDOW_MS);
    if (recent.length) this.peers.set(peer, recent);
    else this.peers.delete(peer);
    if (recent.length >= MAX_PEER_FAILURES) {
      return { ok: false, reason: "limited", error: `Too many tries. Wait a few minutes, then ask the ${COMPUTER} for a new code.` };
    }
    const code = this.code;
    // An old code (a QR code scanned again) isn't a guess: it doesn't count against anyone.
    if (!code || code.expiresAt <= t) {
      this.code = null;
      return { ok: false, reason: "expired", error: `That code has expired. Ask the ${COMPUTER} for a new one (Phones and Tablets in ViewSwitcher).` };
    }
    // Hash both sides, compare digests (see the top of this file).
    if (sha3(normalizeCode(candidate)) !== code.hash) {
      this.peers.set(peer, [...recent, t]);
      if (++code.failures >= MAX_CODE_FAILURES) {
        this.code = null;
        this.codeGuessed = true;
      }
      return { ok: false, reason: "wrong", error: `That code isn't right. Check it on the ${COMPUTER} and try again.` };
    }
    this.code = null; // single use
    const token = randomToken();
    const remote: Remote = { id: randomId(), name, tokenHash: sha3(token), pairedAt: t, lastSeen: t };
    this.remotes.set(remote.tokenHash, remote);
    this.renewed.set(remote.id, t);
    this.save();
    return { ok: true, token, remote: info(remote) };
  }

  // ------------------------------------------------------------ devices

  /** The remote a token belongs to (and it was just seen), or null. */
  check(token: string | null | undefined): RemoteInfo | null {
    if (!token) return null;
    const d = this.remotes.get(sha3(token)); // a lookup by digest: hash first, never the raw token
    if (!d) return null;
    const t = this.now();
    d.lastSeen = t;
    // Written at most once a minute, however often devices ask (a write per request would be too many).
    if (t - this.lastSaved > 60_000) {
      this.lastSaved = t;
      this.save();
    }
    return info(d);
  }

  /** Whether to send this remote's cookie again (at most once a day), so it lasts 400 days from last use, not from pairing. */
  renew(id: string): boolean {
    const t = this.now();
    if (t - (this.renewed.get(id) ?? 0) < RENEW_MS) return false;
    this.renewed.set(id, t);
    return true;
  }

  /** How many addresses are being rate-limited or watched (for tests). */
  get trackedPeers() {
    return this.peers.size;
  }

  list(): RemoteInfo[] {
    return [...this.remotes.values()].map(info).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  /** Remove a remote: its token stops now, and devices.json is written before this returns, so a quit or a
   *  crash right after can't bring it back. Resolves false if there's no such remote; throws if the write failed. */
  async remove(id: string): Promise<boolean> {
    for (const [hash, d] of this.remotes) {
      if (d.id !== id) continue;
      this.remotes.delete(hash);
      this.renewed.delete(id);
      this.onRemoved(id);
      if (!(await this.flush())) throw new Error("The phone or tablet is disconnected, but ViewSwitcher couldn't save the change; it may come back after a restart.");
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

  /** Writes devices.json now; false if that failed. */
  async flush(): Promise<boolean> {
    const file = this.opts.file;
    if (!file) return true;
    clearTimeout(this.saveTimer);
    const body = JSON.stringify({ devices: [...this.remotes.values()] }, null, 2);
    let ok = true;
    this.saving = this.saving.then(async () => {
      try {
        await writeAtomic(file, body, { mode: 0o600, plainParent: true });
      } catch (e) {
        ok = false;
        console.error("[pairing] couldn't save devices:", (e as Error).message);
      }
    });
    await this.saving;
    // Keep trying: until devices.json matches, a restart would bring back what it still holds.
    if (!ok) this.retry();
    return ok;
  }

  private retry() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), 5000);
  }


}

const info = ({ tokenHash: _, ...d }: Remote): RemoteInfo => ({ ...d });

/** A remote's token from a Cookie header. */
export function tokenFromCookie(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=") || null;
  }
  return null;
}

/** Set-Cookie for a new remote's token: HttpOnly (no script reads it), SameSite=Strict (no other site sends it). */
export const tokenCookie = (token: string, secure: boolean) =>
  `${COOKIE}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
