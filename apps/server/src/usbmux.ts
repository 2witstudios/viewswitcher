// The usbmuxd wire protocol (macOS /var/run/usbmuxd): how the Mac opens TCP connections to an
// app on a USB-connected iPad. Pure encode/decode, no I/O. See usb-bridge.ts for the sockets.
//
// Each message is a 16-byte little-endian header {length, version=1, type=8 (plist), tag}
// followed by an XML property list.

export const USBMUXD_SOCKET = "/var/run/usbmuxd";

export type PlistValue = string | number | boolean | Uint8Array | PlistValue[] | { [key: string]: PlistValue };
export type PlistDict = { [key: string]: PlistValue };

const HEADER = 16;

// Bun's bundled Node typings disagree with TypeScript 7 about Buffer vs Uint8Array, so byte
// joins and socket writes go through these two zero-copy helpers.
/** A plain Uint8Array view of a Buffer (no copy). */
export const u8 = (b: Buffer): Uint8Array => new Uint8Array(b.buffer, b.byteOffset, b.length);
/** Joins byte chunks into one Buffer. */
export function concat(...parts: Buffer[]): Buffer {
  const out = Buffer.allocUnsafe(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) out.set(u8(p), off), (off += p.length);
  return out;
}
const VERSION_PLIST = 1;
const TYPE_PLIST = 8;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function encodeValue(v: PlistValue): string {
  if (typeof v === "string") return `<string>${esc(v)}</string>`;
  if (typeof v === "boolean") return v ? "<true/>" : "<false/>";
  if (typeof v === "number") return Number.isInteger(v) ? `<integer>${v}</integer>` : `<real>${v}</real>`;
  if (v instanceof Uint8Array) return `<data>${Buffer.from(v).toString("base64")}</data>`;
  if (Array.isArray(v)) return `<array>${v.map(encodeValue).join("")}</array>`;
  return `<dict>${Object.entries(v).map(([k, x]) => `<key>${esc(k)}</key>${encodeValue(x)}`).join("")}</dict>`;
}

export function encodePlist(dict: PlistDict): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${encodeValue(dict)}</plist>\n`;
}

/** Minimal XML plist parser: dict, array, key, string, integer, real, true, false, data, date. */
export function parsePlist(xml: string): PlistValue {
  // Skip the XML declaration and doctype.
  const start = xml.indexOf("<plist");
  const tokens = [...(start >= 0 ? xml.slice(start) : xml).matchAll(/<(\/?)([a-zA-Z]+)(\s*\/)?>|([^<]+)/g)];
  let i = 0;
  const skipText = () => {
    while (i < tokens.length && tokens[i]![4] !== undefined) i++;
  };
  const text = (tag: string) => {
    let out = "";
    while (i < tokens.length && !(tokens[i]![1] === "/" && tokens[i]![2] === tag)) out += tokens[i++]![4] ?? "";
    i++; // closing tag
    return unesc(out);
  };
  const value = (): PlistValue => {
    skipText();
    const t = tokens[i++];
    if (!t) throw new Error("plist: unexpected end");
    const [, close, tag, selfClose] = t;
    if (close) throw new Error(`plist: unexpected </${tag}>`);
    if (selfClose) {
      if (tag === "true") return true;
      if (tag === "false") return false;
      if (tag === "dict") return {};
      if (tag === "array") return [];
      if (tag === "string") return "";
      throw new Error(`plist: unexpected <${tag}/>`);
    }
    switch (tag) {
      case "string":
      case "date":
        return text(tag);
      case "integer":
      case "real":
        return Number(text(tag).trim());
      case "data":
        return new Uint8Array(Buffer.from(text(tag).replace(/\s+/g, ""), "base64"));
      case "array": {
        const out: PlistValue[] = [];
        for (;;) {
          skipText();
          if (tokens[i]?.[1] === "/" && tokens[i]?.[2] === "array") return i++, out;
          out.push(value());
        }
      }
      case "dict": {
        const out: PlistDict = {};
        for (;;) {
          skipText();
          const k = tokens[i];
          if (k?.[1] === "/" && k[2] === "dict") return i++, out;
          if (k?.[2] !== "key") throw new Error("plist: expected <key>");
          i++;
          const key = text("key");
          out[key] = value();
        }
      }
      case "plist":
        return value();
      default:
        throw new Error(`plist: unsupported <${tag}>`);
    }
  };
  return value();
}

export function encodeMessage(dict: PlistDict, tag = 1): Buffer {
  const payload = Buffer.from(encodePlist(dict), "utf8");
  const header = Buffer.alloc(HEADER);
  header.writeUInt32LE(HEADER + payload.length, 0);
  header.writeUInt32LE(VERSION_PLIST, 4);
  header.writeUInt32LE(TYPE_PLIST, 8);
  header.writeUInt32LE(tag, 12);
  return concat(header, payload);
}

/** Splits complete messages off the front of `buf`; returns them and the leftover bytes. */
export function decodeMessages(buf: Buffer): { messages: { tag: number; body: PlistDict }[]; rest: Buffer } {
  const messages: { tag: number; body: PlistDict }[] = [];
  let off = 0;
  while (buf.length - off >= HEADER) {
    const len = buf.readUInt32LE(off);
    if (len < HEADER) throw new Error(`usbmux: bad message length ${len}`);
    if (buf.length - off < len) break;
    const tag = buf.readUInt32LE(off + 12);
    const body = parsePlist(buf.subarray(off + HEADER, off + len).toString("utf8")) as PlistDict;
    messages.push({ tag, body });
    off += len;
  }
  return { messages, rest: buf.subarray(off) };
}

/** Reads one message from the front of `buf` (used for Connect, where raw bytes may follow). */
export function decodeOne(buf: Buffer): { message: { tag: number; body: PlistDict }; rest: Buffer } | null {
  if (buf.length < HEADER) return null;
  const len = buf.readUInt32LE(0);
  if (buf.length < len) return null;
  const body = parsePlist(buf.subarray(HEADER, len).toString("utf8")) as PlistDict;
  return { message: { tag: buf.readUInt32LE(12), body }, rest: buf.subarray(len) };
}

const client = { ClientVersionString: "viewswitcher", ProgName: "viewswitcher" };

export const listenMessage = () => encodeMessage({ MessageType: "Listen", ...client });

/** usbmuxd wants the port in network byte order, inside a little-endian integer. */
export const swapPort = (port: number) => ((port & 0xff) << 8) | ((port >> 8) & 0xff);

export const connectMessage = (deviceId: number, port: number) =>
  encodeMessage({ MessageType: "Connect", DeviceID: deviceId, PortNumber: swapPort(port), ...client });

/** Result codes: 0 ok, 2 bad device, 3 connection refused (app not listening), 6 bad version. */
export const resultNumber = (body: PlistDict) => (body.MessageType === "Result" ? Number(body.Number) : null);

/** Apple's usbmux product ids for the devices the app runs on (PHONE-8); anything else is unknown. */
const PRODUCTS: Record<number, "iPhone" | "iPad"> = { 0x12a8: "iPhone", 0x12ab: "iPad" };
export const deviceKind = (productId: unknown): "iPhone" | "iPad" | undefined => PRODUCTS[Number(productId)];
