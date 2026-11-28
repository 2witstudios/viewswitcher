// The Windows app's payload (apps/windows/build/payload), as apps/apple/scripts/build.sh makes the Mac's:
// the switcher (apps/web, built), the starter kit, the library kit, the built-in template packs, and the
// server compiled to one executable. The app copies it beside ViewSwitcher.exe (Helpers\ and Resources\).
//   bun apps/windows/scripts/payload.ts [--arch x64|arm64]
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../../..");
const PAYLOAD = join(REPO, "apps/windows/build/payload");
const arch = process.argv.includes("--arch") ? process.argv[process.argv.indexOf("--arch") + 1] : "x64";
if (arch !== "x64" && arch !== "arm64") throw new Error(`--arch is x64 or arm64, not ${arch}`);

function run(cmd: string[], cwd = REPO) {
  console.log(`[payload] ${cmd.join(" ")}`);
  const p = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if (p.exitCode !== 0) throw new Error(`${cmd[0]} failed (${p.exitCode})`);
}

rmSync(PAYLOAD, { recursive: true, force: true });
mkdirSync(join(PAYLOAD, "Resources"), { recursive: true });
mkdirSync(join(PAYLOAD, "Helpers"), { recursive: true });

run([process.execPath, "x", "vite", "build"], join(REPO, "apps/web"));
cpSync(join(REPO, "apps/web/dist"), join(PAYLOAD, "Resources/web"), { recursive: true });
cpSync(join(REPO, "apps/server/starter"), join(PAYLOAD, "Resources/starter"), { recursive: true });
cpSync(join(REPO, "apps/server/library-kit"), join(PAYLOAD, "Resources/library-kit"), { recursive: true });
rmSync(join(PAYLOAD, "Resources/library-kit/README.md"), { force: true });
// The built-in template packs: the starter and the site's shows, from @viewswitcher/packs (folders only, as the Mac app ships them).
run([process.execPath, "apps/server/src/export-packs.ts", join(PAYLOAD, "Resources/packs")]);
for (const f of readdirSync(join(PAYLOAD, "Resources/packs"))) if (f.endsWith(".zip")) rmSync(join(PAYLOAD, "Resources/packs", f));

const exe = join(PAYLOAD, "Helpers/viewswitcher-server.exe");
run([process.execPath, "build", join(REPO, "apps/server/src/index.ts"), "--compile", "--minify", `--target=bun-windows-${arch}`, "--outfile", exe]);
if (!existsSync(exe)) throw new Error(`no ${exe}`);
console.log(`[payload] ${PAYLOAD} (${arch})`);
