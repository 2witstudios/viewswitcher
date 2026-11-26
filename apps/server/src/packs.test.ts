// EDIT-24 · EDIT-25 · EDIT-27 · EDIT-29: staging, installing and removing template packs on a real (temporary)
// library, with the starter kit exported as a pack, and hostile packs that must leave nothing behind.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { asDropped, buildBuiltins, readBuiltins } from "./builtin-packs";
import { addFromTemplate, createOrg, createProject, scanLibrary } from "./library";
import { cancelPack, installPack, PackError, removeSet, stagePack } from "./packs";
import { SHOWS, showPacks, starterPack, writeZip, zipPack } from "@viewswitcher/packs";

const starter = resolve(import.meta.dir, "../starter");
let root = "";
let org = "";
let starterZip: Uint8Array;
const starterJs = () => readFile(join(starter, "templates/_shared/scene.js"), "utf8");

/** Everything in the library, so "nothing written" is a comparison of two listings. */
async function listing(dir = root, base = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const rel = base ? `${base}/${e.name}` : e.name;
    out.push(rel);
    if (e.isDirectory()) out.push(...(await listing(join(dir, e.name), rel)));
  }
  return out.sort();
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vs-packs-"));
  org = (await createOrg(root, starter, "Daisy Debate", "#ff5a36", "#101010")).orgId;
  starterZip = zipPack("starter", await starterPack(starter));
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("the starter kit as a pack (EDIT-27)", () => {
  test("stages with covers filled in for the org, and says what it runs", async () => {
    const s = await stagePack(root, org, { zip: starterZip }, await starterJs());
    expect(s.set).toBe("starter");
    expect(s.manifest.views).toEqual(["starting-soon", "teaching", "whiteboard", "brb", "ending"]);
    expect(s.views.map((v) => v.label)).toEqual(["Starting soon", "Teaching", "Whiteboard", "Be right back", "Ending"]);
    expect(s.scripts).toEqual({ files: ["_shared/scene.js"], inline: [], remote: [], standard: true });
    expect(s.warnings).toEqual([]);
    const cover = await readFile(join(root, s.views[1]!.path), "utf8");
    expect(s.views[1]!.path.startsWith(`${org}/.viewswitcher/staging/`)).toBe(true); // library paths start with the org id
    expect(cover).toContain(`href="/library/${org}/.viewswitcher/staging/${s.token}/preview/_shared/theme.css"`);
    expect(cover).toContain("Daisy Debate");
    // Staged, not installed: the org has no set yet.
    expect((await scanLibrary(root, org)).sets).toEqual([]);
  });

  test("installs as its own set, filled from org.json; New scene and New project can use it", async () => {
    const s = await stagePack(root, org, { zip: starterZip }, await starterJs());
    expect(await installPack(root, org, s.token)).toEqual({ set: "starter" });
    const lib = await scanLibrary(root, org);
    expect(lib.templates.map((t) => t.name)).toEqual(["starting-soon", "teaching", "whiteboard", "brb", "ending"]); // the org's own, unchanged
    expect(lib.sets).toHaveLength(1);
    expect(lib.sets[0]).toMatchObject({ id: "starter", name: "Starter", version: "1.0.0", transition: null });
    expect(lib.sets[0]!.templates.map((t) => [t.name, t.set, t.path])).toContainEqual(["teaching", "starter", `${org}/templates/starter/teaching.html`]);
    const html = await readFile(join(root, org, "templates/starter/teaching.html"), "utf8");
    expect(html).toContain(`href="/library/${org}/templates/starter/_shared/theme.css"`);
    expect(html).toContain("Daisy Debate");
    expect(await readFile(join(root, org, "templates/starter/_shared/theme.css"), "utf8")).toContain("--accent: #ff5a36;");
    // Staging is gone.
    expect(await readdir(join(root, org, ".viewswitcher/staging"))).toEqual([]);

    const { projectId } = await createProject(join(root, org), "Season 1", ["starter/teaching", "teaching"]);
    expect((await readdir(join(root, org, "projects", projectId, "scenes"))).sort()).toEqual(["teaching-2.html", "teaching.html"]);
    expect(await readFile(join(root, org, "projects", projectId, "scenes/teaching.html"), "utf8")).toContain("/templates/starter/_shared/theme.css");
    const { name } = await addFromTemplate(join(root, org), "starter/brb", projectId);
    expect(name).toBe("brb");
  });

  test("installing it again makes a second set beside the first", async () => {
    for (const _ of [1, 2]) await installPack(root, org, (await stagePack(root, org, { zip: starterZip }, null)).token);
    expect((await scanLibrary(root, org)).sets.map((s) => s.id)).toEqual(["starter", "starter-2"]);
  });

  test("a dropped folder installs the same way (and a wrapping folder is fine)", async () => {
    const files = (await starterPack(starter)).map((f) => ({ path: `starter/${f.path}`, data: new Blob([f.data]) }));
    const s = await stagePack(root, org, { files }, null);
    expect(s.scripts.standard).toBe(false); // no starter script given to compare with
    await installPack(root, org, s.token);
    expect((await scanLibrary(root, org)).sets[0]!.templates).toHaveLength(5);
  });

  test("cancel clears staging; a used or made-up token installs nothing", async () => {
    const s = await stagePack(root, org, { zip: starterZip }, null);
    await cancelPack(root, org, s.token);
    expect(await readdir(join(root, org, ".viewswitcher/staging"))).toEqual([]);
    await expect(installPack(root, org, s.token)).rejects.toThrow(/isn't ready/);
    await expect(installPack(root, org, "../../etc")).rejects.toThrow(/isn't ready/);
  });

  test("a pack staged for one org can't be installed into another", async () => {
    const other = (await createOrg(root, starter, "Personal")).orgId;
    const s = await stagePack(root, org, { zip: starterZip }, null);
    await expect(installPack(root, other, s.token)).rejects.toThrow(/isn't ready|another org/);
    expect((await scanLibrary(root, other)).sets).toEqual([]);
  });
});

test("an org whose name has HTML characters: its new templates and an added set show the name as text", async () => {
  const name = `R&B <Live> "Club"`;
  const id = (await createOrg(root, starter, name)).orgId;
  const own = await readFile(join(root, id, "templates/teaching.html"), "utf8");
  const set = (await showPacks()).find((p) => p.id === "grace")!;
  const s = await stagePack(root, id, { zip: zipPack(set.id, set.files) }, null);
  await installPack(root, id, s.token);
  const installed = await Promise.all(["starting-soon", "live", "main"].map((v) => readFile(join(root, id, `templates/grace/${v}.html`), "utf8")));
  for (const html of [own, ...installed]) {
    expect(html).not.toContain("<Live>");
    expect(html).toContain("R&amp;B &lt;Live&gt;");
  }
  expect(await readFile(join(root, id, "templates/_shared/brand/mark.svg"), "utf8")).toContain(">R</text>");
  expect(JSON.parse(await readFile(join(root, id, "org.json"), "utf8")).name).toBe(name); // org.json stays valid JSON
  expect((await scanLibrary(root, id)).org.name).toBe(name);
});

test("the site's six example shows each install as a set", async () => {
  const packs = await showPacks();
  expect(packs.map((p) => p.id)).toEqual(["fullcount", "nova", "grace", "remi", "riverside", "kitchen"]);
  for (const p of packs) {
    const s = await stagePack(root, org, { zip: zipPack(p.id, p.files) }, null);
    expect(s.warnings).toEqual([]);
    await installPack(root, org, s.token);
  }
  const sets = (await scanLibrary(root, org)).sets;
  expect(sets.map((s) => s.templates.length)).toEqual([5, 5, 5, 5, 5, 5]);
  expect(await readFile(join(root, org, "templates/nova/main.html"), "utf8")).toContain(`/library/${org}/templates/nova/_shared/theme.css`);
});

describe("built-in template packs", () => {
  test("the starter and the six shows, in the site's order", async () => {
    const b = await buildBuiltins(starter);
    expect(b.map((p) => p.id)).toEqual(["starter", "fullcount", "nova", "grace", "remi", "riverside", "kitchen"]);
    expect(b.map((p) => p.name)).toEqual(["Starter", "Full Count", "NOVA_PLAYS", "Grace Community", "Roam with Remi", "Riverside Live", "Saltwater Kitchen"]);
    const left: string[] = [];
    expect((await buildBuiltins(join(root, "no-starter"), (id) => left.push(id))).map((p) => p.id)).toEqual(SHOWS.map((s) => s.id)); // one that won't build is left out
    expect(left).toEqual(["starter"]);
  });

  test("each installs through the drop path as its own set, generic: the org's name and colors, not the show's", async () => {
    const shows = ["Full Count", "NOVA_PLAYS", "Grace Community", "Roam with Remi", "Riverside Live", "Saltwater Kitchen"];
    for (const p of await buildBuiltins(starter)) {
      const s = await stagePack(root, org, { files: asDropped(p) }, await starterJs());
      expect(s.warnings).toEqual([]);
      const { set } = await installPack(root, org, s.token);
      const dir = join(root, org, "templates", set);
      const texts = await Promise.all((await readdir(dir)).filter((f) => f.endsWith(".html")).map((f) => readFile(join(dir, f), "utf8")));
      for (const t of texts) {
        expect(t).not.toContain("{{");
        for (const show of shows) expect(t.toUpperCase()).not.toContain(show.toUpperCase());
      }
      const theme = await readFile(join(dir, "_shared/theme.css"), "utf8");
      expect(theme).toContain("#ff5a36");
      if (p.id !== "starter") expect(texts.join("")).toContain("Daisy Debate");
    }
    expect((await scanLibrary(root, org)).sets.map((s) => s.id).sort()).toEqual(["fullcount", "grace", "kitchen", "nova", "remi", "riverside", "starter"]);
  });

  test("prebuilt (the Mac app's Resources/packs) reads the same as built from source", async () => {
    const out = join(root, "..", `${org}-prebuilt-${Date.now()}`);
    const built = await buildBuiltins(starter);
    for (const p of built) for (const f of p.files) {
      await mkdir(join(out, p.id, f.path, ".."), { recursive: true });
      await writeFile(join(out, p.id, f.path), f.data);
    }
    await writeFile(join(out, "starter.zip"), "not a folder");
    const read = await readBuiltins(out);
    expect(read.map((p) => [p.id, p.files.length])).toEqual(built.map((p) => [p.id, p.files.length]));
    await rm(out, { recursive: true, force: true });
  });
});

describe("removing a set (EDIT-25)", () => {
  test("goes entirely when no scene uses it", async () => {
    await installPack(root, org, (await stagePack(root, org, { zip: starterZip }, null)).token);
    expect(await removeSet(root, org, "starter")).toEqual({ kept: 0 });
    expect(await readdir(join(root, org, "templates"))).not.toContain("starter");
  });

  test("keeps the theme and pictures that scenes made from it use, and never touches those scenes", async () => {
    await installPack(root, org, (await stagePack(root, org, { zip: starterZip }, null)).token);
    const { projectId } = await createProject(join(root, org), "Show", ["starter/teaching"]);
    const scene = join(root, org, "projects", projectId, "scenes/teaching.html");
    const before = await readFile(scene, "utf8");
    expect(await removeSet(root, org, "starter")).toEqual({ kept: 1 });
    expect((await scanLibrary(root, org)).sets).toEqual([]);
    expect(await readFile(scene, "utf8")).toBe(before);
    expect(await readFile(join(root, org, "templates/starter/_shared/theme.css"), "utf8")).toContain("--accent");
  });

  test("refuses what isn't a set", async () => {
    await expect(removeSet(root, org, "_shared")).rejects.toThrow();
    await expect(removeSet(root, org, "../projects")).rejects.toThrow();
    await mkdir(join(root, org, "templates/plain"));
    await expect(removeSet(root, org, "plain")).rejects.toThrow(/isn't an installed template set/);
  });
});

describe("hostile and broken packs change nothing (EDIT-24 · EDIT-26)", () => {
  const good = async () => (await starterPack(starter)).map((f) => ({ name: `p/${f.path}`, data: f.data }));
  const cases: [string, () => Promise<Uint8Array>, RegExp][] = [
    ["zip-slip", async () => writeZip([...(await good()), { name: "p/../../../evil.html", data: "<script>x</script>" }]), /outside the pack/],
    ["zip-slip to an absolute path", async () => writeZip([...(await good()), { name: "/tmp/evil.js", data: "x" }]), /outside the pack/],
    ["a symlink", async () => writeZip([...(await good()), { name: "p/_shared/link.css", data: "/etc/passwd", link: true }]), /link/],
    ["a wrong file type", async () => writeZip([...(await good()), { name: "p/assets/run.command", data: "#!/bin/sh" }]), /assets\/ holds/],
    ["a script among the views", async () => writeZip([...(await good()), { name: "p/templates/x.js", data: "x" }]), /only the views/],
    ["an oversized file", async () => writeZip([...(await good()), { name: "p/assets/big.mp4", data: new Uint8Array(26 * 1024 * 1024) }]), /over 25 MB/],
    // A zip bomb: claims 1 KB but inflates to 50 MB. Inflating stops at the declared size.
    ["a zip bomb that lies about its size", async () => writeZip([...(await good()), { name: "p/assets/bomb.png", data: new Uint8Array(50 * 1024 * 1024), declaredSize: 1024 }]), /size it says/],
    ["a zip bomb that declares its size", async () => writeZip([...(await good()), ...Array.from({ length: 5 }, (_, i) => ({ name: `p/assets/b${i}.mp4`, data: new Uint8Array(24 * 1024 * 1024) }))]), /over 100 MB/],
    ["a broken pack.json", async () => writeZip([{ name: "pack.json", data: "{" }, { name: "templates/a.html", data: "x" }]), /valid JSON/],
    ["a missing view", async () => writeZip((await good()).filter((f) => !f.name.endsWith("brb.html"))), /templates\/brb.html isn't in the pack/],
    ["not a zip", async () => new TextEncoder().encode("hello"), /isn't a zip/],
  ];
  for (const [what, make, why] of cases) {
    test(`refuses ${what}`, async () => {
      const before = await listing();
      const zip = await make();
      const err = await stagePack(root, org, { zip }, null).then(() => null, (e) => e);
      expect(err).toBeInstanceOf(PackError);
      expect(String(err.message)).toMatch(why);
      // Nothing written: not in the org, not left in staging, not outside the library.
      const after = (await listing()).filter((p) => !/^[^/]+\/\.viewswitcher(\/staging)?$/.test(p));
      expect(after).toEqual(before);
      expect(await readdir(join(root, org, ".viewswitcher/staging")).catch(() => [])).toEqual([]);
    });
  }

  test("a folder with a path out of it is refused", async () => {
    const files = [...(await starterPack(starter)).map((f) => ({ path: f.path, data: new Blob([f.data]) })), { path: "../x.html", data: new Blob(["x"]) }];
    await expect(stagePack(root, org, { files }, null)).rejects.toThrow(/outside the pack/);
  });

  test("an install that fails partway leaves nothing in the org", async () => {
    const s = await stagePack(root, org, { zip: starterZip }, null);
    // Something takes the set's name while the pack waits: the install picks the next free name.
    await mkdir(join(root, org, "templates/starter"));
    await writeFile(join(root, org, "templates/starter/keep.txt"), "mine");
    expect(await installPack(root, org, s.token)).toEqual({ set: "starter-2" });
    expect(await readdir(join(root, org, "templates/starter"))).toEqual(["keep.txt"]);
    // And when the staged copy is gone mid-way, nothing appears.
    const t = await stagePack(root, org, { zip: starterZip }, null);
    await rm(join(root, org, ".viewswitcher/staging", t.token, "raw"), { recursive: true });
    const before = await listing(join(root, org));
    const err = await installPack(root, org, t.token).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(PackError);
    expect(err.message).not.toContain(root); // no absolute paths in what the client sees
    expect((await listing(join(root, org))).filter((p) => !p.startsWith(".viewswitcher"))).toEqual(before.filter((p) => !p.startsWith(".viewswitcher")));
    expect(await readdir(join(root, org, "templates"))).not.toContain("starter-3");
  });
});

test("an existing library without sets reads as before", async () => {
  await cp(join(root, org), join(root, "copy"), { recursive: true });
  const lib = await scanLibrary(root, "copy");
  expect(lib.sets).toEqual([]);
  expect(lib.templates).toHaveLength(5);
});

describe("a templates/ folder linked outside the library", () => {
  test("install and remove never write or delete there", async () => {
    const { symlink } = await import("node:fs/promises");
    const away = await mkdtemp(join(tmpdir(), "vs-packs-away-"));
    try {
      // Install: the org's templates/ is a link outside.
      const s = await stagePack(root, org, { zip: starterZip }, await starterJs());
      await rm(join(root, org, "templates"), { recursive: true, force: true });
      await symlink(away, join(root, org, "templates"));
      await expect(installPack(root, org, s.token)).rejects.toThrow("outside the library");
      expect(await readdir(away)).toEqual([]);
      // Remove: a set that looks installed there.
      await mkdir(join(away, "neon"), { recursive: true });
      await writeFile(join(away, "neon/pack.json"), "{}");
      await writeFile(join(away, "neon/theme.css"), "x");
      await expect(removeSet(root, org, "neon")).rejects.toThrow("outside the library");
      expect((await readdir(join(away, "neon"))).sort()).toEqual(["pack.json", "theme.css"]);
    } finally {
      await rm(away, { recursive: true, force: true });
    }
  });
});
