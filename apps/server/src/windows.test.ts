// The server's Windows paths, tested on every platform where the platform is a parameter, and for real
// on Windows where it can't be (renames).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimRename, renameOver } from "./fsx";
import { editorCommand } from "./open-file";
import { pathScrub } from "./scrub";
import { windowsAppFor } from "./mcp/stdio";
import { parentGone, stopsOnStdinEnd } from "./parent-watch";

const root = mkdtempSync(join(tmpdir(), "vs-windows-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("claimRename: a staged folder takes a name nobody has", () => {
  for (const win of [false, true]) {
    if (win !== (process.platform === "win32")) continue; // each platform's own rename rules, only there
    test(`${win ? "Windows" : "POSIX"}: moves it, and refuses a name that's taken, whatever is there`, async () => {
      const dir = mkdtempSync(join(root, "claim-"));
      const staged = join(dir, "staged");
      mkdirSync(staged);
      writeFileSync(join(staged, "org.json"), "{}");
      await claimRename(staged, join(dir, "show"), win);
      expect(readdirSync(join(dir, "show"))).toEqual(["org.json"]);
      const again = join(dir, "again");
      mkdirSync(again);
      mkdirSync(join(dir, "empty-taken"));
      await expect(claimRename(again, join(dir, "empty-taken"), win)).rejects.toMatchObject({ code: "EEXIST" });
      await expect(claimRename(again, join(dir, "show"), win)).rejects.toMatchObject({ code: "EEXIST" });
      expect(readdirSync(join(dir, "show"))).toEqual(["org.json"]); // never replaced
    });
  }
  test("renameOver replaces a file", async () => {
    writeFileSync(join(root, "a.tmp"), "new");
    writeFileSync(join(root, "a.json"), "old");
    await renameOver(join(root, "a.tmp"), join(root, "a.json"));
    expect(await Bun.file(join(root, "a.json")).text()).toBe("new");
  });
});

describe("errors name library paths, not Windows folders", () => {
  test("a path inside the library, any case, with backslashes, becomes the library path", () => {
    const scrub = pathScrub("C:\\Users\\Sam\\ViewSwitcher Library", true);
    expect(scrub("ENOENT: no such file or directory, lstat 'C:\\Users\\Sam\\ViewSwitcher Library\\my-show\\templates\\gone.html'")).toBe("ENOENT: no such file or directory, lstat 'my-show/templates/gone.html'");
    expect(scrub("EACCES: c:\\users\\sam\\viewswitcher library\\x.html")).toBe("EACCES: x.html");
    expect(scrub("can't read C:\\Users\\Sam\\ViewSwitcher Library")).toBe("can't read the library");
    expect(scrub("elsewhere: D:\\other\\file")).toBe("elsewhere: D:\\other\\file");
  });
});

describe("Open in editor", () => {
  test("Windows: the editor, or Notepad, with the file as its own argument", () => {
    expect(editorCommand("C:\\lib\\a b.html", undefined, "win32")).toEqual(["notepad.exe", "C:\\lib\\a b.html"]);
    expect(editorCommand("C:\\lib\\a.html", "C:\\Program Files\\Code\\Code.exe", "win32")).toEqual(["C:\\Program Files\\Code\\Code.exe", "C:\\lib\\a.html"]);
  });
  test("macOS: open, as before", () => {
    expect(editorCommand("/lib/a.html", undefined, "darwin")).toEqual(["open", "-t", "/lib/a.html"]);
    expect(editorCommand("/lib/a.html", "Visual Studio Code", "darwin")).toEqual(["open", "-a", "Visual Studio Code", "/lib/a.html"]);
  });
});

describe("--mcp-stdio opens the Windows app beside the installed server", () => {
  test("Helpers\\viewswitcher-server.exe → ViewSwitcher.exe one folder up, when it's there", () => {
    const server = "C:\\Users\\sam\\AppData\\Local\\ViewSwitcher\\current\\Helpers\\viewswitcher-server.exe";
    expect(windowsAppFor(server, (p) => p === "C:\\Users\\sam\\AppData\\Local\\ViewSwitcher\\current\\ViewSwitcher.exe")).toBe("C:\\Users\\sam\\AppData\\Local\\ViewSwitcher\\current\\ViewSwitcher.exe");
    expect(windowsAppFor(server, () => false)).toBeNull();
    expect(windowsAppFor("C:\\Users\\sam\\.bun\\bin\\bun.exe", () => true)).toBeNull(); // a source run has no app
  });
});

describe("the Windows app's stop and parent", () => {
  test("only a server the app started with VIEWSWITCHER_STOP_ON_STDIN=1 stops when stdin ends", () => {
    expect(stopsOnStdinEnd({ VIEWSWITCHER_STOP_ON_STDIN: "1" })).toBe(true);
    expect(stopsOnStdinEnd({})).toBe(false);
  });
  test("a parent that's gone is gone on Windows too (no reparenting to pid 1 there)", () => {
    expect(parentGone(4242, 4242, () => false)).toBe(true);
    expect(parentGone(4242, 4242, () => true)).toBe(false);
  });
});
