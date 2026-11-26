// The library's one real-path rule (contain.ts), on a real folder with real links.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realLibraryPath, resolveInLibrary } from "./contain";

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
const real = (rel: string) => join(realpathSync(library), rel);
const TOKEN = "0123456789abcdef01234567";
put("daisy/templates/brb.html");
put("daisy/.git/config");
put("daisy/.env");
put(".viewswitcher/settings.json", "{}");
put(`daisy/.viewswitcher/staging/${TOKEN}/preview/brb.html`);
put(`daisy/.viewswitcher/staging/${TOKEN}/meta.json`, "{}");
writeFileSync(join(outside, "secret.txt"), "secret");
symlinkSync(join(outside, "secret.txt"), join(library, "daisy/templates/away.html"));
symlinkSync(outside, join(library, "daisy/away"));
symlinkSync(join(library, "daisy/templates/brb.html"), join(library, "daisy/templates/alias.html"));
symlinkSync(join(library, ".viewswitcher/settings.json"), join(library, "daisy/settings.json"));
symlinkSync(join(outside, "nothing-yet.html"), join(library, "daisy/templates/dangling.html"));

const refused = (p: string, o?: { forWrite?: boolean }) => expect(resolveInLibrary(library, p, o)).rejects.toThrow();

describe("resolveInLibrary", () => {
  test("a plain path is its real file; a new one lands in its nearest real folder", async () => {
    expect(await resolveInLibrary(library, "daisy/templates/brb.html")).toBe(real("daisy/templates/brb.html"));
    expect(await resolveInLibrary(library, "daisy/projects/new/scenes/x.html", { forWrite: true })).toBe(real("daisy/projects/new/scenes/x.html"));
  });
  test("a link that stays in the library is followed", async () => {
    expect(await resolveInLibrary(library, "daisy/templates/alias.html")).toBe(real("daisy/templates/brb.html"));
  });
  test("a link out of the library, a folder linked out, and a link to nowhere are refused", async () => {
    await refused("daisy/templates/away.html");
    await refused("daisy/away/secret.txt");
    await refused("daisy/away/new.html", { forWrite: true });
    await refused("daisy/templates/dangling.html", { forWrite: true });
  });
  test("dot-folders and dot-files are refused, also through a link", async () => {
    for (const p of ["daisy/.git/config", ".viewswitcher/settings.json", "daisy/.env", "daisy/settings.json", ".git", "daisy/templates/../.env", "daisy/./templates/brb.html"]) await refused(p);
  });
  test("bad shapes are refused", async () => {
    for (const p of ["", "/daisy/templates/brb.html", "daisy//templates/brb.html", "daisy/templates/", "daisy\\\\templates", "daisy/\\0"]) await refused(p);
  });
  test("a staged pack's preview may be read, never written, and nothing else in staging", async () => {
    expect(await resolveInLibrary(library, `daisy/.viewswitcher/staging/${TOKEN}/preview/brb.html`)).toBe(real(`daisy/.viewswitcher/staging/${TOKEN}/preview/brb.html`));
    await refused(`daisy/.viewswitcher/staging/${TOKEN}/preview/brb.html`, { forWrite: true });
    await refused(`daisy/.viewswitcher/staging/${TOKEN}/meta.json`);
    await refused(`daisy/.viewswitcher/staging/abc/preview/brb.html`);
    await refused(`daisy/.viewswitcher/staging/${TOKEN}/preview/.hidden`);
  });
});

describe("realLibraryPath", () => {
  test("where a path really is, as a library path", () => {
    expect(realLibraryPath(library, "daisy/templates/alias.html")).toBe("daisy/templates/brb.html");
    expect(realLibraryPath(library, "daisy/templates/new.html")).toBe("daisy/templates/new.html");
    expect(realLibraryPath(library, "daisy/templates/away.html")).toBe("daisy/templates/away.html");
  });
});
