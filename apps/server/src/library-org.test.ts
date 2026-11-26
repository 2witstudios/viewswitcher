// A new org from the starter kit, on a real (temporary) library: it appears whole, filled in for
// its name, or not at all.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createOrg, listOrgs } from "./library";

const starter = resolve(import.meta.dir, "../starter");
let root = "";
const dirs: string[] = [];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vs-org-"));
  dirs.push(root);
});
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
const staged = () => readdir(join(root, ".viewswitcher/staging")).catch(() => [] as string[]);

describe("createOrg", () => {
  test("fills the starter in for the org and leaves nothing in staging", async () => {
    const { orgId } = await createOrg(root, starter, "R&B Night");
    expect(orgId).toBe("r-b-night");
    const ending = await readFile(join(root, orgId, "templates/ending.html"), "utf8");
    expect(ending).toContain("R&amp;B Night");
    expect(ending).toContain(`/library/${orgId}/templates/_shared/`);
    expect(ending).not.toContain("{{");
    expect(JSON.parse(await readFile(join(root, orgId, "org.json"), "utf8")).name).toBe("R&B Night");
    expect((await readdir(join(root, orgId))).sort()).toEqual(expect.arrayContaining(["assets", "org.json", "projects", "templates"]));
    expect(await staged()).toEqual([]);
    expect((await listOrgs(root)).map((o) => o.id)).toEqual([orgId]);
  });

  test("the org appears whole: while it's made, its folder never shows a placeholder or half the starter", async () => {
    let done = false;
    const seen = new Set<string>();
    const watcher = (async () => {
      while (!done) {
        for (const id of await readdir(root).catch(() => [] as string[])) {
          if (id.startsWith(".")) continue;
          const files = await readdir(join(root, id)).catch(() => [] as string[]);
          seen.add(files.length === 0 ? "empty" : files.includes("org.json") && files.includes("templates") ? "whole" : `partial:${files.join(",")}`);
          const ending = await readFile(join(root, id, "templates/ending.html"), "utf8").catch(() => "");
          if (ending.includes("{{")) seen.add("placeholder");
        }
        await Bun.sleep(0);
      }
    })();
    for (let i = 0; i < 5; i++) await createOrg(root, starter, `Show ${i}`);
    done = true;
    await watcher;
    expect([...seen].filter((s) => s !== "empty" && s !== "whole")).toEqual([]);
  });

  test("the same name twice at once: two orgs, each filled with its own id", async () => {
    const [a, b] = await Promise.all([createOrg(root, starter, "Daisy"), createOrg(root, starter, "Daisy")]);
    expect([a.orgId, b.orgId].sort()).toEqual(["daisy", "daisy-2"]);
    for (const id of [a.orgId, b.orgId]) expect(await readFile(join(root, id, "org.json"), "utf8")).not.toContain("{{");
    expect(await staged()).toEqual([]);
  });

  test("a dangling link where the org would go: the next name, nothing written through it", async () => {
    const away = await mkdtemp(join(tmpdir(), "vs-org-away-"));
    dirs.push(away);
    await symlink(join(away, "nowhere"), join(root, "daisy"));
    expect((await createOrg(root, starter, "Daisy")).orgId).toBe("daisy-2");
    expect(await readdir(away)).toEqual([]);
  });

  test("a read-only starter kit (as an installed app's can be) still makes a filled org", async () => {
    const ro = await mkdtemp(join(tmpdir(), "vs-org-starter-"));
    dirs.push(ro);
    await cp(starter, ro, { recursive: true });
    // Its files read-only (its folders aren't, in an app bundle copied by the person).
    for (const f of await readdir(ro, { recursive: true })) if ((await stat(join(ro, String(f)))).isFile()) await chmod(join(ro, String(f)), 0o444);
    const { orgId } = await createOrg(root, ro, "Daisy");
    expect(await readFile(join(root, orgId, "templates/ending.html"), "utf8")).toContain("Daisy");
  });

  test("a create that fails leaves nothing behind", async () => {
    await expect(createOrg(root, join(root, "no-starter-here"), "Daisy")).rejects.toThrow();
    expect((await readdir(root)).filter((n) => !n.startsWith("."))).toEqual([]);
    expect(await staged()).toEqual([]);
  });

  test("the library's .viewswitcher/ linked outside: refused, nothing written there", async () => {
    const away = await mkdtemp(join(tmpdir(), "vs-org-away-"));
    dirs.push(away);
    await symlink(away, join(root, ".viewswitcher"));
    await expect(createOrg(root, starter, "Daisy")).rejects.toThrow("link");
    expect(await readdir(away)).toEqual([]);
    await rm(join(root, ".viewswitcher"));
    await mkdir(join(root, ".viewswitcher"));
    await symlink(away, join(root, ".viewswitcher/staging"));
    await expect(createOrg(root, starter, "Daisy")).rejects.toThrow("link");
    expect(await readdir(away)).toEqual([]);
    expect((await readdir(root)).filter((n) => !n.startsWith("."))).toEqual([]);
  });
});
