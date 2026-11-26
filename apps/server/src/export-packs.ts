// Export the built-in template packs (the starter kit and the six example shows, from
// @viewswitcher/packs) as files: what the Mac app ships in Contents/Resources/packs.
//
//   bun run packs:export [out-dir]      (default: dist/packs → <id>/ and <id>.zip for each)
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { showPacks, starterPack, zipPack } from "@viewswitcher/packs";

if (import.meta.main) {
  const repo = resolve(import.meta.dir, "../../..");
  const out = resolve(process.argv[2] ?? join(repo, "dist/packs"));
  const packs = [{ id: "starter", files: await starterPack(join(repo, "apps/server/starter")) }, ...(await showPacks())];
  for (const { id, files } of packs) {
    const dir = join(out, id);
    await rm(dir, { recursive: true, force: true });
    for (const f of files) {
      await mkdir(dirname(join(dir, f.path)), { recursive: true });
      await writeFile(join(dir, f.path), f.data);
    }
    await writeFile(join(out, `${id}.zip`), zipPack(id, files));
    console.log(`wrote ${join(out, `${id}.zip`)} (${files.length} files)`);
  }
}
