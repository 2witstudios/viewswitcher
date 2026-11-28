// ViewSwitcher for Windows, built (apps/apple/scripts/build.sh's Windows twin):
//   bun run win:build                      the payload, the app published self-contained, and the Velopack
//                                          release in apps/windows/build/release (ViewSwitcher-win-Setup.exe,
//                                          the full .nupkg and releases.win.json, the update feed)
//   bun run win:build --app                just apps/windows/build/app (ViewSwitcher.exe with Helpers\ and Resources\)
//   bun run win:build --arch arm64         for ARM PCs (x64 by default)
//   bun run win:release [--publish]        the same, from a clean tree on origin/main; --publish uploads the
//                                          release's Windows files to the DRAFT GitHub release for the version
// Signing: with WINDOWS_SIGN_PARAMS set (signtool's arguments, e.g. "/f cert.pfx /p … /fd sha256 /tr
// http://timestamp.digicert.com /td sha256"), vpk signs every exe and the setup; without, it warns and
// builds unsigned (Windows SmartScreen then warns on first run).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../../..");
const WIN = join(REPO, "apps/windows");
const BUILD = join(WIN, "build");
const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const value = (f: string, fallback: string) => (argv.includes(f) ? argv[argv.indexOf(f) + 1]! : fallback);
const arch = value("--arch", "x64");
const rid = `win-${arch}`;
const release = flag("--release");
const publish = flag("--publish");

/** The version every app ships with: the Mac app's (apps/apple/project.yml MARKETING_VERSION), so both platforms release together. */
function version(): string {
  const yml = readFileSync(join(REPO, "apps/apple/project.yml"), "utf8");
  const v = yml.match(/MARKETING_VERSION:\s*"?([\d.]+)"?/)?.[1];
  if (!v || !/^\d+\.\d+\.\d+$/.test(v)) throw new Error("no MARKETING_VERSION in apps/apple/project.yml");
  return v;
}

function run(cmd: string[], cwd = REPO, env: Record<string, string> = {}) {
  console.log(`[win:build] ${cmd.join(" ")}`);
  const p = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit", env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1", ...env } });
  if (p.exitCode !== 0) throw new Error(`${cmd[0]} failed (${p.exitCode})`);
}

/** dotnet and vpk: on PATH, else where the per-user installs put them. */
function tool(name: string, fallbacks: string[]): string {
  const onPath = Bun.which(name);
  if (onPath) return onPath;
  const found = fallbacks.find(existsSync);
  if (!found) throw new Error(`${name} isn't installed (see apps/windows/README.md)`);
  return found;
}
const home = process.env.USERPROFILE ?? "";
const local = process.env.LOCALAPPDATA ?? join(home, "AppData/Local");
const dotnet = tool("dotnet", [join(local, "Microsoft/dotnet/dotnet.exe"), "C:/Program Files/dotnet/dotnet.exe"]);

if (release) {
  // As release-guard.sh does for the Mac: a release comes from what's on origin/main, nothing local.
  const status = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: REPO }).stdout.toString().trim();
  if (status) throw new Error("the tree has changes: commit or stash them first");
  run(["git", "fetch", "--quiet", "origin", "main"]);
  const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: REPO }).stdout.toString().trim();
  const main = Bun.spawnSync(["git", "rev-parse", "origin/main"], { cwd: REPO }).stdout.toString().trim();
  if (head !== main) throw new Error("HEAD isn't origin/main");
  const pinned = readFileSync(join(REPO, ".bun-version"), "utf8").trim();
  if (Bun.version !== pinned) throw new Error(`bun ${Bun.version} isn't the pinned ${pinned} (.bun-version)`);
}

const v = version();
console.log(`[win:build] ViewSwitcher ${v} for ${rid}`);

// 1. The payload: the switcher, starter, library kit, packs and the compiled server.
run([process.execPath, join(WIN, "scripts/payload.ts"), "--arch", arch]);

// 2. The app, self-contained (the .NET runtime and the Windows App SDK inside it).
const app = join(BUILD, "app");
rmSync(app, { recursive: true, force: true });
run([dotnet, "publish", join(WIN, "ViewSwitcher.Windows/ViewSwitcher.Windows.csproj"), "-c", "Release", "-r", rid, "--self-contained", "-p:Platform=" + (arch === "arm64" ? "ARM64" : "x64"), `-p:Version=${v}`, "-o", app]);
cpSync(join(BUILD, "payload/Helpers"), join(app, "Helpers"), { recursive: true });
cpSync(join(BUILD, "payload/Resources"), join(app, "Resources"), { recursive: true });
if (!existsSync(join(app, "ViewSwitcher.exe")) || !existsSync(join(app, "Helpers/viewswitcher-server.exe"))) throw new Error("the app folder is missing ViewSwitcher.exe or its server");
console.log(`[win:build] ${app}`);
if (flag("--app")) process.exit(0);

// 3. The Velopack release: the installer, the package and the update feed.
const vpk = tool("vpk", [join(home, ".dotnet/tools/vpk.exe")]);
const out = join(BUILD, "release");
mkdirSync(out, { recursive: true });
const sign = process.env.WINDOWS_SIGN_PARAMS;
if (!sign) console.warn("[win:build] WINDOWS_SIGN_PARAMS isn't set: the app and installer are unsigned (SmartScreen will warn)");
run([
  vpk, "pack",
  "--packId", "ViewSwitcher",
  "--packVersion", v,
  "--packTitle", "ViewSwitcher",
  "--packAuthors", "2wit Studios",
  "--packDir", app,
  "--mainExe", "ViewSwitcher.exe",
  "--icon", join(WIN, "ViewSwitcher.Windows/Assets/ViewSwitcher.ico"),
  "--runtime", rid,
  "--channel", arch === "arm64" ? "win-arm64" : "win",
  "--shortcuts", "Desktop,StartMenuRoot",
  "--outputDir", out,
  ...(sign ? ["--signParams", sign] : []),
]);
console.log(`[win:build] ${out}`);

if (publish) {
  // Onto the DRAFT release for this version (the Mac build makes it; draft so nothing is public until someone publishes it).
  const tag = `v${v}`;
  const draft = Bun.spawnSync(["gh", "release", "view", tag, "--json", "isDraft", "-q", ".isDraft"], { cwd: REPO }).stdout.toString().trim();
  if (draft !== "true") throw new Error(`there's no draft release ${tag}: make it with bun run mac:release --publish first, or gh release create ${tag} --draft`);
  const files = Bun.spawnSync(["cmd", "/c", "dir", "/b", out]).stdout.toString().split(/\r?\n/).filter(Boolean).map((f) => join(out, f));
  run(["gh", "release", "upload", tag, "--clobber", ...files]);
}
