import { describe, expect, test } from "bun:test";
import type { AgentOnAir } from "@viewswitcher/shared";
import { agentGuard, type GuardAction } from "./agent-guard";

const onAir = { path: "daisy/projects/ld/streams/12-04-x/teaching.html", transition: "daisy/templates/_shared/transition.html" };
const go: GuardAction = { kind: "go_on_air" };
const write = (...paths: string[]): GuardAction => ({ kind: "write", paths });

const rows: [AgentOnAir, boolean, GuardAction, boolean][] = [
  // setting, live, action, allowed
  ["never", false, go, false],
  ["never", true, go, false],
  ["not-live", false, go, true],
  ["not-live", true, go, false],
  ["always", false, go, true],
  ["always", true, go, true],

  ["not-live", true, write(onAir.path), false],
  ["not-live", true, write("daisy/templates/_shared/transition.html"), false],
  ["not-live", true, write("daisy/projects/ld/transition.html"), false], // would take over as the scene's transition
  ["not-live", true, write("daisy/templates/_shared/theme.css"), false],
  ["not-live", true, write("daisy/projects/ld/streams/12-04-x/brb.html", onAir.path), false], // any path in the list
  ["not-live", true, write("daisy/projects/ld/streams/12-04-x/brb.html"), true],
  ["not-live", true, write("daisy/templates/teaching.html"), true],
  ["not-live", true, write("other/templates/_shared/theme.css"), true], // another org's shared files
  ["not-live", true, write("daisy/projects/other/transition.html"), true],
  ["not-live", false, write(onAir.path, "daisy/templates/_shared/theme.css"), true],
  ["never", true, write("daisy/templates/_shared/theme.css"), false],
  ["never", false, write(onAir.path), true],
  ["always", true, write(onAir.path, "daisy/templates/_shared/theme.css"), true],
];

describe("agentGuard", () => {
  test.each(rows)("%s, live %p, %o → allowed %p", (setting, live, action, allowed) => {
    expect(agentGuard({ setting, live, onAir, action }).ok).toBe(allowed);
  });
  test("nothing on air: writes are fine even while live", () => {
    expect(agentGuard({ setting: "not-live", live: true, onAir: null, action: write("daisy/templates/_shared/theme.css") })).toEqual({ ok: true });
  });
  test("a project's own transition counts when it's the one resolved", () => {
    const own = { path: "daisy/projects/ld/scenes/teaching.html", transition: "daisy/projects/ld/transition.html" };
    expect(agentGuard({ setting: "not-live", live: true, onAir: own, action: write("daisy/projects/ld/transition.html") }).ok).toBe(false);
  });
  test("each refusal says why and what to do instead", () => {
    const r = (action: GuardAction, setting: AgentOnAir = "not-live") => {
      const g = agentGuard({ setting, live: true, onAir, action });
      return g.ok ? "" : g.reason;
    };
    expect(r(write(onAir.path))).toBe("That scene is on air and you're live. Make a stream copy with customize_scene (or duplicate_scene) and change that, or wait until the stream ends.");
    expect(r(write("daisy/templates/_shared/transition.html"))).toContain("Wait until the stream ends");
    expect(r(write("daisy/templates/_shared/theme.css"))).toContain("customize_scene");
    expect(r(go)).toContain("let them put it on air in the switcher");
    expect(r(go, "never")).toContain("never put scenes on air");
  });
});
