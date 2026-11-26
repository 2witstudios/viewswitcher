import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSettings, writeSettings } from "./settings";

const roots: string[] = [];
const temp = () => {
  const r = mkdtempSync(join(tmpdir(), "vs-settings-"));
  roots.push(r);
  return r;
};
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

describe("settings.json", () => {
  test("defaults to not-live when there is no file", async () => {
    expect(await readSettings(temp())).toEqual({ agentOnAir: "not-live" });
  });
  test("a file that can't be read, or a value that isn't a choice, means the strictest setting, never the default", async () => {
    const root = temp();
    await mkdir(join(root, ".viewswitcher"));
    for (const text of ["{ nope", "[]", "null", "", JSON.stringify({ agentOnAir: "sometimes" }), JSON.stringify({ agentOnAir: "always " })]) {
      await writeFile(join(root, ".viewswitcher/settings.json"), text);
      expect(await readSettings(root)).toEqual({ agentOnAir: "never" });
    }
    // A file without the setting yet (other keys only) is the default, as no file is.
    await writeFile(join(root, ".viewswitcher/settings.json"), JSON.stringify({ other: 1 }));
    expect(await readSettings(root)).toEqual({ agentOnAir: "not-live" });
  });
  test("choosing a setting replaces a file that couldn't be read, and leaves no temp file", async () => {
    const root = temp();
    await mkdir(join(root, ".viewswitcher"));
    await writeFile(join(root, ".viewswitcher/settings.json"), "{ nope");
    expect(await writeSettings(root, { agentOnAir: "always" })).toEqual({ agentOnAir: "always" });
    expect(await readdir(join(root, ".viewswitcher"))).toEqual(["settings.json"]);
  });
  test("writes the setting and keeps other keys", async () => {
    const root = temp();
    await mkdir(join(root, ".viewswitcher"));
    await writeFile(join(root, ".viewswitcher/settings.json"), JSON.stringify({ other: 1 }));
    expect(await writeSettings(root, { agentOnAir: "never" })).toEqual({ agentOnAir: "never" });
    expect(JSON.parse(await readFile(join(root, ".viewswitcher/settings.json"), "utf8"))).toEqual({ other: 1, agentOnAir: "never" });
    expect(await readSettings(root)).toEqual({ agentOnAir: "never" });
  });
  test("refuses a value that isn't one of the three", async () => {
    await expect(writeSettings(temp(), { agentOnAir: "sometimes" as never })).rejects.toThrow("onAir is one of never, not-live, always");
    await expect(writeSettings(temp(), { agentOnAir: undefined })).rejects.toThrow("onAir is one of");
  });
  test("quick changes land in the order they were made: the last one wins", async () => {
    const root = temp();
    const picks = ["always", "never", "not-live", "always", "never"] as const;
    const results = await Promise.all(picks.map((agentOnAir) => writeSettings(root, { agentOnAir })));
    expect(results.map((r) => r.agentOnAir)).toEqual([...picks]);
    expect((await readSettings(root)).agentOnAir).toBe("never");
  });
});
