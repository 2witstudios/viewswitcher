import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";

/** config.ts read in a fresh process with `env`, so each case sees its own environment. */
function configWith(env: Record<string, string>) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("VIEWSWITCHER_")));
  const p = Bun.spawnSync(["bun", "-e", `const { config } = await import(${JSON.stringify(join(import.meta.dir, "config.ts"))}); console.log(JSON.stringify(config))`], {
    env: { ...clean, ...env },
  });
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  return JSON.parse(p.stdout.toString());
}

describe("config paths (MAC-1)", () => {
  test("default to the repo", () => {
    const c = configWith({});
    expect(c.starter).toBe(resolve(import.meta.dir, "../starter"));
    expect(c.webDist).toBe(resolve(import.meta.dir, "../../web/dist"));
    expect(c.libraryKit).toBe(resolve(import.meta.dir, "../library-kit"));
  });
  test("follow the env overrides the Mac app passes", () => {
    const c = configWith({ VIEWSWITCHER_STARTER: "/app/Resources/starter", VIEWSWITCHER_WEB_DIST: "/app/Resources/web", VIEWSWITCHER_LIBRARY_KIT: "/app/Resources/library-kit", PORT: "7433" });
    expect(c.starter).toBe("/app/Resources/starter");
    expect(c.webDist).toBe("/app/Resources/web");
    expect(c.libraryKit).toBe("/app/Resources/library-kit");
    expect(c.port).toBe(7433);
  });
});
