// Just enough PNG to tell an empty OBS render from a real one, and to make test frames.
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A width×height PNG of one RGBA color. */
export function solidPng(width: number, height: number, [r, g, b, a]: [number, number, number, number]): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  const row = 1 + width * 4;
  const line = new Uint8Array(row);
  for (let x = 0; x < width; x++) line.set([r, g, b, a], 1 + x * 4);
  const raw = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) raw.set(line, y * row);
  const parts = [SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Whether every pixel is zero: what OBS's screenshot returns when the source drew nothing (it clears
 * to transparent black first). A scene with ?preview always paints its ground, so a real render never is.
 * Every PNG row filter predicts zero from zeros, so the image is all zero exactly when the filtered
 * bytes are, and nothing needs unfiltering. Anything unreadable counts as not blank.
 */
export function isBlankPng(png: Uint8Array): boolean {
  try {
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    if (!SIGNATURE.every((b, i) => png[i] === b)) return false;
    let width = 0, depth = 0, channels = 0, interlaced = false;
    const idat: Uint8Array[] = [];
    for (let at = 8; at + 8 <= png.length; ) {
      const length = view.getUint32(at);
      const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
      const data = png.subarray(at + 8, at + 8 + length);
      if (type === "IHDR") {
        width = view.getUint32(at + 8);
        depth = data[8]!;
        channels = CHANNELS[data[9]!] ?? 0;
        interlaced = data[12] !== 0;
        if (data[9] === 3) return false; // palette: zero is an index, not a color
      } else if (type === "IDAT") idat.push(data);
      else if (type === "IEND") break;
      at += 12 + length;
    }
    if (!width || !channels || interlaced || !idat.length) return false;
    const data = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
    idat.reduce((at, d) => (data.set(d, at), at + d.length), 0);
    const raw = inflateSync(data);
    const row = 1 + Math.ceil((width * channels * depth) / 8);
    for (let i = 0; i < raw.length; i++) if (i % row !== 0 && raw[i] !== 0) return false;
    return true;
  } catch {
    return false;
  }
}
