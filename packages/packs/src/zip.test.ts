import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, listZip, readZipEntry, readZipEntrySync, storedZip, writeZip, ZipError } from "./zip";

const WINDOWS = process.platform === "win32";

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
      if (WINDOWS) {
        // Windows has no unzip; its tar (bsdtar) reads zips. And no permission bits to check.
        mkdirSync(join(dir, "out"));
        // Windows' own tar.exe: a Git Bash GNU tar earlier on PATH can't read zips.
        const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
        const out = Bun.spawnSync([tar, "-xf", join(dir, "a.zip"), "-C", join(dir, "out")]);
        expect(out.stderr.toString()).toBe("");
        expect(out.exitCode).toBe(0);
      } else {
        const test = Bun.spawnSync(["unzip", "-t", join(dir, "a.zip")]);
        expect(test.exitCode).toBe(0);
        expect(test.stdout.toString()).toContain("No errors detected");
        expect(Bun.spawnSync(["unzip", "-q", join(dir, "a.zip"), "-d", join(dir, "out")]).exitCode).toBe(0);
      }
      expect(readFileSync(join(dir, "out/manifest.json"), "utf8")).toBe('{"name":"viewswitcher"}');
      expect(new Uint8Array(readFileSync(join(dir, "out/icons/ünï.bin")))).toEqual(binary);
      expect(readFileSync(join(dir, "out/empty.txt"), "utf8")).toBe("");
      if (!WINDOWS) {
        expect(statSync(join(dir, "out/run")).mode & 0o777).toBe(0o755);
        expect(statSync(join(dir, "out/manifest.json")).mode & 0o111).toBe(0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readZipEntry", () => {
  // Text-like data that takes a while to inflate: 16 MB of random words.
  const words = Array.from({ length: 2048 }, () => Math.random().toString(36).slice(2, 8));
  let text = "";
  while (text.length < 16 * 1024 * 1024) text += `${words[(Math.random() * words.length) | 0]} `;
  const data = new TextEncoder().encode(text);
  const zip = writeZip([{ name: "big.txt", data }, { name: "bomb.txt", data, declaredSize: 1024 }]);
  const [big, bomb] = listZip(zip);

  test("inflates off the event loop: timers keep firing while a big entry unpacks", async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    const out = await readZipEntry(zip, big!);
    clearInterval(timer);
    expect(out).toEqual(data);
    // Inflated in one go on the event loop, not one timer could fire before it's done.
    expect(ticks).toBeGreaterThan(0);
  });
  test("keeps the declared size cap and the CRC check", async () => {
    await expect(readZipEntry(zip, bomb!)).rejects.toThrow(ZipError);
    const damaged = { ...big!, crc: (big!.crc + 1) >>> 0 };
    await expect(readZipEntry(zip, damaged)).rejects.toThrow("is damaged");
  });
  test("the build scripts' sync copy reads the same and refuses the same", () => {
    expect(readZipEntrySync(zip, big!)).toEqual(data);
    expect(() => readZipEntrySync(zip, bomb!)).toThrow(ZipError);
  });
});
