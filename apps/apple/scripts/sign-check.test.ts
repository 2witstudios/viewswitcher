// sign-check.sh's hardened-runtime check on real code signatures (copies of /usr/bin/true, signed
// here), run through macOS's own bash (3.2), as build.sh runs it.
import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const check = join(import.meta.dir, "sign-check.sh");
const dir = mkdtempSync(join(tmpdir(), "vs-sign-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const canSign = process.platform === "darwin" && Bun.which("codesign") !== null;

/** A copy of /usr/bin/true signed ad hoc with `options`; its path. */
function signed(name: string, options: string[]) {
  const path = join(dir, name);
  copyFileSync("/usr/bin/true", path);
  const r = Bun.spawnSync(["codesign", "--force", ...options, "--sign", "-", path]);
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return path;
}
const hardened = (path: string) => Bun.spawnSync(["/bin/bash", "-c", `source "${check}"; hardened_runtime "$1"`, "_", path]).exitCode === 0;

describe.skipIf(!canSign)("hardened_runtime", () => {
  test("an ad hoc signature on the hardened runtime (mac:build --unsigned) passes", () => {
    expect(hardened(signed("adhoc-runtime", ["--options", "runtime"]))).toBe(true);
  });
  test("a signature without the runtime fails, and so does unsigned or missing code", () => {
    expect(hardened(signed("adhoc", []))).toBe(false);
    expect(hardened(join(dir, "nothing-here"))).toBe(false);
    const plain = join(dir, "plain.txt");
    writeFileSync(plain, "not code");
    expect(hardened(plain)).toBe(false);
  });
});
