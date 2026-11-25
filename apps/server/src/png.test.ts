import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { isBlankPng, solidPng } from "./png";

describe("isBlankPng (MCP-1)", () => {
  test("an all-zero frame is blank; anything painted isn't", () => {
    expect(isBlankPng(solidPng(960, 540, [0, 0, 0, 0]))).toBe(true);
    expect(isBlankPng(solidPng(960, 540, [14, 15, 19, 255]))).toBe(false);
    expect(isBlankPng(solidPng(4, 4, [0, 0, 0, 1]))).toBe(false);
  });

  test("filter bytes don't count, and a single painted pixel does", () => {
    // A 3×2 RGBA image whose rows use the Sub filter (1), built around solidPng's IHDR.
    const ihdr = solidPng(3, 2, [0, 0, 0, 0]).subarray(0, 33);
    const withRows = (raw: number[]) => {
      const idat = deflateSync(Uint8Array.from(raw));
      const head = new Uint8Array(8);
      new DataView(head.buffer).setUint32(0, idat.length);
      head.set([0x49, 0x44, 0x41, 0x54], 4); // "IDAT"
      return Uint8Array.from([...ihdr, ...head, ...idat, 0, 0, 0, 0]);
    };
    const zeros = (n: number) => new Array(n).fill(0);
    expect(isBlankPng(withRows([1, ...zeros(12), 1, ...zeros(12)]))).toBe(true);
    expect(isBlankPng(withRows([1, ...zeros(12), 1, ...zeros(11), 9]))).toBe(false);
  });

  test("anything that isn't a readable PNG isn't blank", () => {
    expect(isBlankPng(new Uint8Array())).toBe(false);
    expect(isBlankPng(new TextEncoder().encode("not a png"))).toBe(false);
  });
});
