import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAtomic } from "./atomic";
import { readSettings } from "./settings";

const scratch = (name: string) => mkdtempSync(join(tmpdir(), `vs-${name}-`));

describe("writeAtomic with plainParent", () => {
  test("a state folder that became a link (a git pull) is moved aside, and the write lands in a plain folder", async () => {
    const lib = scratch("lib");
    const elsewhere = scratch("elsewhere");
    mkdirSync(join(lib, ".viewswitcher"));
    await writeAtomic(join(lib, ".viewswitcher", "state.json"), "{}", { plainParent: true });
    // The swap happens while the server runs: the plain folder is replaced by a link to another place.
    const { rmSync } = await import("node:fs");
    rmSync(join(lib, ".viewswitcher"), { recursive: true });
    symlinkSync(elsewhere, join(lib, ".viewswitcher"));

    await writeAtomic(join(lib, ".viewswitcher", "devices.json"), "secret", { mode: 0o600, plainParent: true });
    expect(lstatSync(join(lib, ".viewswitcher")).isDirectory()).toBe(true);
    expect(readFileSync(join(lib, ".viewswitcher", "devices.json"), "utf8")).toBe("secret");
    expect(readdirSync(elsewhere)).toEqual([]); // nothing was written through the link
    expect(readdirSync(lib).some((n) => n.startsWith(".viewswitcher.moved-aside-"))).toBe(true);
  });

  test("without it, a plain write is unchanged", async () => {
    const dir = scratch("plain");
    await writeAtomic(join(dir, "sub", "x.json"), "1");
    expect(readFileSync(join(dir, "sub", "x.json"), "utf8")).toBe("1");
  });
});

describe("settings", () => {
  test("settings that came in through a linked state folder are never read: it's moved aside first", async () => {
    const lib = scratch("lib");
    const elsewhere = scratch("elsewhere");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(elsewhere, "settings.json"), JSON.stringify({ agentOnAir: "always" }));
    symlinkSync(elsewhere, join(lib, ".viewswitcher"));
    // The moved-aside folder's "always" never counts: the fresh folder has no settings yet, so the default.
    expect((await readSettings(lib)).agentOnAir).toBe("not-live");
    expect(existsSync(join(elsewhere, "settings.json"))).toBe(true); // left where it was
  });
});
