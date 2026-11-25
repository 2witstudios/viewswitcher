import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, storedZip } from "./zip";

describe("storedZip", () => {
  test("crc32 matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  test("unzip reads it back, byte for byte", () => {
    const dir = mkdtempSync(join(tmpdir(), "vs-zip-"));
    try {
      const binary = new Uint8Array(300).map((_, i) => (i * 7) % 256);
      writeFileSync(join(dir, "a.zip"), storedZip([
        { name: "manifest.json", data: '{"name":"viewswitcher"}' },
        { name: "icons/ünï.bin", data: binary },
        { name: "empty.txt", data: "" },
        { name: "run", data: "#!/bin/sh\n", executable: true },
      ]));
      const test = Bun.spawnSync(["unzip", "-t", join(dir, "a.zip")]);
      expect(test.exitCode).toBe(0);
      expect(test.stdout.toString()).toContain("No errors detected");
      expect(Bun.spawnSync(["unzip", "-q", join(dir, "a.zip"), "-d", join(dir, "out")]).exitCode).toBe(0);
      expect(readFileSync(join(dir, "out/manifest.json"), "utf8")).toBe('{"name":"viewswitcher"}');
      expect(new Uint8Array(readFileSync(join(dir, "out/icons/ünï.bin")))).toEqual(binary);
      expect(readFileSync(join(dir, "out/empty.txt"), "utf8")).toBe("");
      expect(statSync(join(dir, "out/run")).mode & 0o777).toBe(0o755);
      expect(statSync(join(dir, "out/manifest.json")).mode & 0o111).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
