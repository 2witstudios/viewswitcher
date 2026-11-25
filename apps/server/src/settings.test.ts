import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  test("a bad file or value falls back to the default", async () => {
    const root = temp();
    await mkdir(join(root, ".viewswitcher"));
    await writeFile(join(root, ".viewswitcher/settings.json"), "{ nope");
    expect(await readSettings(root)).toEqual({ agentOnAir: "not-live" });
    await writeFile(join(root, ".viewswitcher/settings.json"), JSON.stringify({ agentOnAir: "sometimes" }));
    expect(await readSettings(root)).toEqual({ agentOnAir: "not-live" });
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
});
