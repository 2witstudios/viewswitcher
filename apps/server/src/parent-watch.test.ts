import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alive, appParent, parentGone, watchParent } from "./parent-watch";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("appParent", () => {
  test("only a real pid from the Mac app counts", () => {
    expect(appParent({ VIEWSWITCHER_PARENT_PID: "4242" })).toBe(4242);
    for (const v of [undefined, "", "1", "0", "-5", "12.5", "abc"]) expect(appParent({ VIEWSWITCHER_PARENT_PID: v })).toBeNull();
  });
});

describe("parentGone", () => {
  test("a live parent that is still our parent", () => {
    expect(parentGone(4242, 4242, () => true)).toBe(false);
  });
  test("a parent that no longer exists", () => {
    expect(parentGone(4242, 4242, () => false)).toBe(true);
  });
  test("handed to launchd: gone, even if something now holds the old pid", () => {
    expect(parentGone(4242, 1, () => true)).toBe(true);
  });
  test("alive: this process yes, an exited one no", async () => {
    expect(alive(process.pid)).toBe(true);
    const p = Bun.spawn(["true"]);
    await p.exited;
    expect(alive(p.pid)).toBe(false);
  });
});

describe("watchParent", () => {
  test("calls onGone once, at the first check that finds the parent gone", async () => {
    let gone = false;
    let calls = 0;
    watchParent(4242, () => calls++, { everyMs: 10, gone: () => gone });
    await sleep(50);
    expect(calls).toBe(0);
    gone = true;
    await sleep(50);
    expect(calls).toBe(1);
  });
  test("stop ends the watch", async () => {
    let calls = 0;
    const stop = watchParent(4242, () => calls++, { everyMs: 10, gone: () => true });
    stop();
    await sleep(50);
    expect(calls).toBe(0);
  });
  test("a server whose app is killed exits by itself", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vs-parent-"));
    try {
      const script = join(dir, "server.ts");
      writeFileSync(
        script,
        `import { appParent, watchParent } from ${JSON.stringify(join(import.meta.dir, "parent-watch.ts"))};
         watchParent(appParent()!, () => process.exit(7), { everyMs: 50 });
         setInterval(() => {}, 1000);
         console.log("up");`,
      );
      const app = Bun.spawn(["sleep", "30"]);
      const server = Bun.spawn(["bun", script], { env: { ...process.env, VIEWSWITCHER_PARENT_PID: String(app.pid) }, stdout: "pipe" });
      // Wait until it runs, then check it stays while the app does.
      await server.stdout.getReader().read();
      await sleep(200);
      expect(server.exitCode).toBeNull();
      app.kill("SIGKILL");
      const code = await Promise.race([server.exited, sleep(3000).then(() => "still running")]);
      if (code === "still running") server.kill("SIGKILL");
      expect(code).toBe(7);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
