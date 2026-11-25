// A small zip reader for template packs (EDIT-24): it lists entries from the central directory and
// inflates one entry at a time, never more bytes than the entry declares. No dependency.
//
// What it refuses, so the caller never has to think about it: encrypted entries, ZIP64, methods
// other than stored and deflate, and an entry that inflates to more (or less) than it says
// (a zip bomb lies about its sizes; inflating is capped at the declared size, which the pack
// validator has already held to its limits). Entry names are returned as written; the validator
// (planPack) decides which names are safe.
import { deflateRawSync, inflateRawSync } from "node:zlib";

export class ZipError extends Error {}

export type ZipEntry = {
  name: string;
  type: "file" | "dir" | "symlink" | "other";
  method: number;
  compressedSize: number;
  size: number;
  crc: number;
  offset: number;
};

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  // CP437 for the ASCII range; anything else becomes U+FFFD, which no pack name allows.
  return Array.from(bytes, (b) => (b < 0x80 ? String.fromCharCode(b) : "�")).join("");
}

/** The entries in `zip`'s central directory. */
export function listZip(zip: Uint8Array): ZipEntry[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // The end record is in the last 22 + 65535 bytes (it may be followed by a comment).
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("It isn't a zip file");
  const disk = v.getUint16(eocd + 4, true);
  const count = v.getUint16(eocd + 10, true);
  const cdSize = v.getUint32(eocd + 12, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  if (disk !== 0) throw new ZipError("Split zips can't be installed");
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError("This zip is too big (ZIP64)");
  if (cdOffset + cdSize > eocd) throw new ZipError("This zip is damaged");
  const out: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > eocd || v.getUint32(p, true) !== CENTRAL) throw new ZipError("This zip is damaged");
    const madeBy = v.getUint16(p + 4, true);
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const compressedSize = v.getUint32(p + 20, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const external = v.getUint32(p + 38, true);
    const offset = v.getUint32(p + 42, true);
    if (p + 46 + nameLen > eocd) throw new ZipError("This zip is damaged");
    const name = decodeName(zip.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0);
    if (flags & 0x1) throw new ZipError(`"${name}" is encrypted`);
    if (compressedSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new ZipError("This zip is too big (ZIP64)");
    // Unix file type, when the zip was made on a Unix (macOS included): links and devices are refused later.
    const mode = madeBy >> 8 === 3 ? external >>> 16 : 0;
    const kind = mode & 0o170000;
    const type: ZipEntry["type"] =
      kind === 0o120000 ? "symlink"
      : name.endsWith("/") || kind === 0o040000 || (madeBy >> 8 === 0 && (external & 0x10) !== 0) ? "dir"
      : kind === 0 || kind === 0o100000 ? "file"
      : "other";
    out.push({ name, type, method, compressedSize, size, crc, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** One entry's bytes: inflated, at most its declared size, and checked against its CRC. */
export function readZipEntry(zip: Uint8Array, e: ZipEntry): Uint8Array {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  if (e.offset + 30 > zip.length || v.getUint32(e.offset, true) !== LOCAL) throw new ZipError(`"${e.name}" is damaged`);
  const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
  const end = start + e.compressedSize;
  if (end > zip.length) throw new ZipError(`"${e.name}" is damaged`);
  const raw = zip.subarray(start, end);
  let data: Uint8Array;
  if (e.method === 0) {
    if (e.compressedSize !== e.size) throw new ZipError(`"${e.name}" is damaged`);
    data = raw;
  } else if (e.method === 8) {
    try {
      // maxOutputLength: a bomb that inflates past what it declared throws here, before it's in memory.
      data = e.size === 0 ? new Uint8Array(0) : new Uint8Array(inflateRawSync(raw, { maxOutputLength: e.size }));
    } catch {
      throw new ZipError(`"${e.name}" doesn't unpack to the size it says`);
    }
  } else throw new ZipError(`"${e.name}" uses a compression this can't read`);
  if (data.length !== e.size) throw new ZipError(`"${e.name}" doesn't unpack to the size it says`);
  if (Bun.hash.crc32(data) >>> 0 !== e.crc >>> 0) throw new ZipError(`"${e.name}" is damaged`);
  return data;
}

// ------------------------------------------------------------ writing (the pack exporter, and tests)

const crcOf = (b: Uint8Array) => Bun.hash.crc32(b) >>> 0;

/**
 * A zip of `files` (deflated). `link` makes a Unix symlink entry and `declaredSize` lies about the
 * size, so tests can build hostile zips; the exporter uses neither.
 */
export function writeZip(files: { name: string; data: Uint8Array | string; link?: boolean; declaredSize?: number }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const f of files) {
    const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const name = enc.encode(f.name);
    const comp = new Uint8Array(deflateRawSync(data));
    const crc = crcOf(data);
    const size = f.declaredSize ?? data.length;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x800, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, comp.length, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const c = new Uint8Array(46 + name.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, CENTRAL, true);
    cv.setUint16(4, (3 << 8) | 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, comp.length, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    const mode = f.link ? 0o120777 : f.name.endsWith("/") ? 0o040755 : 0o100644;
    cv.setUint32(38, (mode << 16) >>> 0, true);
    cv.setUint32(42, offset, true);
    c.set(name, 46);
    chunks.push(local, comp);
    central.push(c);
    offset += local.length + comp.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, EOCD, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const b of [...chunks, ...central, end]) {
    all.set(b, p);
    p += b.length;
  }
  return all;
}
