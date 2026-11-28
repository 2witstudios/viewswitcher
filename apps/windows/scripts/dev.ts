// The Windows app from this checkout (apps/apple/scripts/dev.sh's twin): a Debug build that runs the
// server from source (`bun apps/server/src/index.ts`, VIEWSWITCHER_REPO), or attaches to whatever already
// answers on PORT (e.g. `bun run dev`). Its settings, log and web view data are its own, beside the
// installed app's, and it runs alongside it (one instance per build).
//   bun run win:dev            builds and opens it
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../../..");
const WIN = join(REPO, "apps/windows");
const local = process.env.LOCALAPPDATA ?? "";
const dotnet = Bun.which("dotnet") ?? [join(local, "Microsoft/dotnet/dotnet.exe"), "C:/Program Files/dotnet/dotnet.exe"].find(existsSync);
if (!dotnet) throw new Error("dotnet isn't installed (see apps/windows/README.md)");

const build = Bun.spawnSync([dotnet, "build", join(WIN, "ViewSwitcher.Windows/ViewSwitcher.Windows.csproj"), "-c", "Debug", "-p:Platform=x64"], { stdout: "inherit", stderr: "inherit", env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" } });
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);
const exe = join(WIN, "ViewSwitcher.Windows/bin/x64/Debug/net10.0-windows10.0.22621.0/win-x64/ViewSwitcher.exe");
// A switcher to load: the dev server builds apps/web on change; without one, build it once.
if (!existsSync(join(REPO, "apps/web/dist/index.html"))) Bun.spawnSync([process.execPath, "x", "vite", "build"], { cwd: join(REPO, "apps/web"), stdout: "inherit", stderr: "inherit" });
Bun.spawn([exe], { env: { ...process.env, VIEWSWITCHER_REPO: REPO, BUN: process.execPath }, stdout: "ignore", stderr: "ignore" }).unref();
console.log(`[win:dev] ${exe}`);
