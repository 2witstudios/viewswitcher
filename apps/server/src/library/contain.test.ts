// The library's one real-path rule (contain.ts), on a real folder with real links.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plainStateFolder, realLibraryPath, resolveInLibrary } from "./contain";
import { fileLinks, posix } from "../../../../test-links";

const library = mkdtempSync(join(tmpdir(), "vs-contain-"));
const outside = mkdtempSync(join(tmpdir(), "vs-contain-out-"));
afterAll(() => {
  rmSync(library, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});
const put = (rel: string, text = "x") => {
  mkdirSync(join(library, rel, ".."), { recursive: true });
  writeFileSync(join(library, rel), text);
};
const real = (rel: string) => join(realpathSync.native(library), rel);
const TOKEN = "0123456789abcdef01234567";
put("daisy/templates/brb.html");
put("daisy/.git/config");
put("daisy/.env");
put(".viewswitcher/settings.json", "{}");
put(`daisy/.viewswitcher/staging/${TOKEN}/covers/brb.html`);
put(`daisy/.viewswitcher/staging/${TOKEN}/meta.json`, "{}");
writeFileSync(join(outside, "secret.txt"), "secret");
// Links to files need symlink rights on Windows (test-links.ts); the tests that use them skip without.
if (fileLinks) {
  symlinkSync(join(outside, "secret.txt"), join(library, "daisy/templates/away.html"));
  symlinkSync(join(library, "daisy/templates/brb.html"), join(library, "daisy/templates/alias.html"));
  symlinkSync(join(library, ".viewswitcher/settings.json"), join(library, "daisy/settings.json"));
}
symlinkSync(outside, join(library, "daisy/away"));
symlinkSync(join(outside, "nothing-yet.html"), join(library, "daisy/templates/dangling.html"));

const refused = (p: string, o?: { forWrite?: boolean }) => expect(resolveInLibrary(library, p, o)).rejects.toThrow();

describe("resolveInLibrary", () => {
  test("a plain path is its real file; a new one lands in its nearest real folder", async () => {
    expect(await resolveInLibrary(library, "daisy/templates/brb.html")).toBe(real("daisy/templates/brb.html"));
    expect(await resolveInLibrary(library, "daisy/projects/new/scenes/x.html", { forWrite: true })).toBe(real("daisy/projects/new/scenes/x.html"));
  });
  test.skipIf(!fileLinks)("a link that stays in the library is followed", async () => {
    expect(await resolveInLibrary(library, "daisy/templates/alias.html")).toBe(real("daisy/templates/brb.html"));
  });
  test.skipIf(!fileLinks)("a link out of the library, a folder linked out, and a link to nowhere are refused", async () => {
    await refused("daisy/templates/away.html");
    await refused("daisy/away/secret.txt");
    await refused("daisy/away/new.html", { forWrite: true });
    await refused("daisy/templates/dangling.html", { forWrite: true });
  });
  test.skipIf(!fileLinks)("dot-folders and dot-files are refused, also through a link", async () => {
    for (const p of ["daisy/.git/config", ".viewswitcher/settings.json", "daisy/.env", "daisy/settings.json", ".git", "daisy/templates/../.env", "daisy/./templates/brb.html"]) await refused(p);
  });
  test("bad shapes are refused", async () => {
    for (const p of ["", "/daisy/templates/brb.html", "daisy//templates/brb.html", "daisy/templates/", "daisy\\\\templates", "daisy/\\0"]) await refused(p);
  });
  test("a staged pack's covers may be read, never written, and nothing else in staging", async () => {
    expect(await resolveInLibrary(library, `daisy/.viewswitcher/staging/${TOKEN}/covers/brb.html`)).toBe(real(`daisy/.viewswitcher/staging/${TOKEN}/covers/brb.html`));
    await refused(`daisy/.viewswitcher/staging/${TOKEN}/covers/brb.html`, { forWrite: true });
    await refused(`daisy/.viewswitcher/staging/${TOKEN}/meta.json`);
    await refused(`daisy/.viewswitcher/staging/abc/covers/brb.html`);
    await refused(`daisy/.viewswitcher/staging/${TOKEN}/covers/.hidden`);
    await refused(`.git/.viewswitcher/staging/${TOKEN}/covers/brb.html`);
  });
});

describe("realLibraryPath", () => {
  test.skipIf(!fileLinks)("where a path really is, as a library path", () => {
    expect(realLibraryPath(library, "daisy/templates/alias.html")).toBe("daisy/templates/brb.html");
    expect(realLibraryPath(library, "daisy/templates/new.html")).toBe("daisy/templates/new.html");
    expect(realLibraryPath(library, "daisy/templates/away.html")).toBe("daisy/templates/away.html");
  });
});

describe("a path that can't be read", () => {
  test.skipIf(!posix)("a file or a folder with no permission is refused as that, not as a link", async () => {
    put("daisy/locked/x.css");
    put("daisy/assets/sealed.png");
    chmodSync(join(library, "daisy/assets/sealed.png"), 0o000);
    chmodSync(join(library, "daisy/locked"), 0o600);
    try {
      for (const p of ["daisy/assets/sealed.png", "daisy/locked/x.css"]) {
        await expect(resolveInLibrary(library, p)).rejects.toThrow("can't be read (no permission)");
      }
    } finally {
      chmodSync(join(library, "daisy/locked"), 0o755);
      chmodSync(join(library, "daisy/assets/sealed.png"), 0o644);
    }
  });
});

describe("plainStateFolder", () => {
  const lib = () => mkdtempSync(join(tmpdir(), "vs-state-"));
  const at = new Date("2026-11-26T08:00:00.000Z");

  test("a plain folder, or none yet, is left as it is", async () => {
    const empty = lib();
    expect(await plainStateFolder(empty, at)).toBeNull();
    expect(existsSync(join(empty, ".viewswitcher"))).toBe(false);
    const plain = lib();
    mkdirSync(join(plain, ".viewswitcher"));
    writeFileSync(join(plain, ".viewswitcher", "state.json"), "{}");
    expect(await plainStateFolder(plain, at)).toBeNull();
    expect(readFileSync(join(plain, ".viewswitcher", "state.json"), "utf8")).toBe("{}");
  });

  test("a link is moved aside, never followed: what it points at is untouched", async () => {
    const root = lib();
    const elsewhere = mkdtempSync(join(tmpdir(), "vs-elsewhere-"));
    writeFileSync(join(elsewhere, "keep.txt"), "mine");
    symlinkSync(elsewhere, join(root, ".viewswitcher"));
    const aside = await plainStateFolder(root, at);
    expect(aside).toStartWith(join(root, ".viewswitcher.moved-aside-2026-11-26T08-00-00-000Z-"));
    expect(lstatSync(aside!).isSymbolicLink()).toBe(true); // kept, as the link it was
    expect(existsSync(join(root, ".viewswitcher"))).toBe(false); // the next write makes a plain one
    expect(readFileSync(join(elsewhere, "keep.txt"), "utf8")).toBe("mine");
  });

  test("a file where the folder should be is moved aside too", async () => {
    const root = lib();
    writeFileSync(join(root, ".viewswitcher"), "not a folder");
    const aside = await plainStateFolder(root, at);
    expect(readFileSync(aside!, "utf8")).toBe("not a folder");
    expect(existsSync(join(root, ".viewswitcher"))).toBe(false);
  });
});

describe("the no-link read (withNoLinks)", () => {
  // macOS refuses a link anywhere in the path at the open (O_NOFOLLOW_ANY); Windows has no such open, so
  // contain.ts checks the path's real form first. Linux's O_NOFOLLOW checks only the last segment.
  test.skipIf(process.platform === "linux")("a file read through a folder that is a link (a junction on Windows) is refused", async () => {
    const { readNoFollow } = await import("./contain");
    symlinkSync(join(library, "daisy/templates"), join(library, "daisy/via-folder-link"));
    expect(await readNoFollow(real("daisy/templates/brb.html"))).toBe("x");
    await expect(readNoFollow(join(realpathSync.native(library), "daisy/via-folder-link/brb.html"))).rejects.toThrow("outside the library");
  });
});
