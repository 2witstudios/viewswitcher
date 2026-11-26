// release-guard.sh's remote check, run through bash as the release scripts run it.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const guard = join(import.meta.dir, "release-guard.sh");
const sshConfig = join(mkdtempSync(join(tmpdir(), "vs-guard-")), "ssh_config");
writeFileSync(sshConfig, "Host github-work\n  HostName github.com\nHost elsewhere\n  HostName gitlab.com\n");

const ok = (url: string) =>
  Bun.spawnSync(["bash", "-c", `source "${guard}"; release_remote_ok "$1"`, "_", url], { env: { ...process.env, RELEASE_SSH_CONFIG: sshConfig } }).exitCode === 0;

describe("release_remote_ok", () => {
  test("the release repository over HTTPS or SSH, with or without .git or a trailing slash", () => {
    for (const url of [
      "https://github.com/2witstudios/viewswitcher",
      "https://github.com/2witstudios/viewswitcher.git",
      "https://github.com/2witstudios/viewswitcher/",
      "git@github.com:2witstudios/viewswitcher.git",
      "ssh://git@github.com/2witstudios/viewswitcher.git",
      "ssh://git@github.com:22/2witstudios/viewswitcher",
    ]) expect(ok(url)).toBe(true);
  });

  test("an SSH host alias counts when ssh resolves it to github.com", () => {
    expect(ok("git@github-work:2witstudios/viewswitcher.git")).toBe(true);
    expect(ok("git@elsewhere:2witstudios/viewswitcher.git")).toBe(false);
  });

  test("a look-alike host, a fork, a longer name or another scheme never does", () => {
    for (const url of [
      "https://notgithub.com/2witstudios/viewswitcher",
      "https://github.com.evil.example/2witstudios/viewswitcher",
      "https://evil.example/github.com/2witstudios/viewswitcher",
      "https://github.com/someone/viewswitcher",
      "https://github.com/2witstudios/viewswitcher-fork",
      "http://github.com/2witstudios/viewswitcher",
      "/Users/me/viewswitcher",
    ]) expect(ok(url)).toBe(false);
  });
});
