// loadedFiles when /library/ would serve a file but it can't be read (a disk error, or a link swapped in
// mid-scan): the file is named as unreadable, and the agents' guard refuses a live write naming it. The
// read is made to fail here, since a real file on a healthy disk can't produce an EIO on demand.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentGuard } from "./agent-guard";
import { readNoFollow } from "./library/contain";
import { loadedFiles } from "./scene-refs";

const root = mkdtempSync(join(tmpdir(), "vs-unreadable-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(join(root, "daisy/templates/_shared"), { recursive: true });
writeFileSync(join(root, "daisy/templates/brb.html"), `<link rel="stylesheet" href="/library/daisy/templates/_shared/theme.css">`);
writeFileSync(join(root, "daisy/templates/_shared/theme.css"), "body{}");

/** The real no-link read, except that the stylesheet fails as a disk error would. */
const failing = (abs: string) => (abs.endsWith("theme.css") ? Promise.reject(Object.assign(new Error("io"), { code: "EIO" })) : readNoFollow(abs));

test("a file /library/ would serve but the scan couldn't read is named as unreadable, and the guard refuses a live write naming it", async () => {
  const l = await loadedFiles(root, ["daisy/templates/brb.html"], 200, { read: failing });
  expect(l.unreadable).toEqual(["daisy/templates/_shared/theme.css"]);
  const g = agentGuard({
    setting: "not-live",
    live: true,
    onAir: { path: "daisy/templates/brb.html", loads: l.files, loadsComplete: l.complete, loadsUnreadable: l.unreadable },
    action: { kind: "write", paths: ["daisy/assets/anything.png"] },
  });
  expect(g.ok).toBe(false);
  expect(g.ok ? "" : g.reason).toContain("daisy/templates/_shared/theme.css");
});
