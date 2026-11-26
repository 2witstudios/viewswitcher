import { describe, expect, test } from "bun:test";
import type { AgentOnAir } from "@viewswitcher/shared";
import { agentGuard, type GuardAction } from "./agent-guard";

const onAir = {
  path: "daisy/projects/ld/streams/12-04-x/teaching.html",
  transition: "daisy/templates/_shared/transition.html",
  loads: ["daisy/assets/logo.svg", "daisy/projects/ld/streams/12-04-x/lower-third.css", "daisy/templates/_shared/theme.css"],
};
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
  ["not-live", true, write("Daisy/Projects/LD/streams/12-04-x/Teaching.html"), false], // the same file on the Mac's disk
  ["not-live", true, write("daisy/Templates/_Shared/theme.css"), false],
  ["not-live", true, write("daisy/projects/ld/streams/12-04-x/brb.html", onAir.path), false], // any path in the list
  ["not-live", true, write("daisy/projects/ld/streams/12-04-x/brb.html"), true],
  ["not-live", true, write("daisy/templates/teaching.html"), true],
  ["not-live", true, write("other/templates/_shared/theme.css"), true], // another org's shared files
  ["not-live", true, write("daisy/projects/other/transition.html"), true],
  // Files the scene on air loads (its <img>, <link>, <script>, <video>, CSS url() targets).
  ["not-live", true, write("daisy/assets/logo.svg"), false],
  ["not-live", true, write("Daisy/Assets/Logo.svg"), false],
  ["not-live", true, write("daisy/projects/ld/streams/12-04-x/lower-third.css"), false],
  ["not-live", true, write("daisy/assets/logo-v2.svg"), true], // a new file beside it
  ["not-live", true, write("daisy/assets/other.png"), true],
  ["not-live", false, write("daisy/assets/logo.svg"), true],
  ["never", true, write("daisy/assets/logo.svg"), false],
  ["always", true, write("daisy/assets/logo.svg"), true],
  ["not-live", false, write(onAir.path, "daisy/templates/_shared/theme.css"), true],
  ["never", true, write("daisy/templates/_shared/theme.css"), false],
  ["never", false, write(onAir.path), true],
  ["always", true, write(onAir.path, "daisy/templates/_shared/theme.css"), true],
];

describe("agentGuard", () => {
  test.each(rows)("%s, live %p, %o → allowed %p", (setting, live, action, allowed) => {
    expect(agentGuard({ setting, live, onAir, action }).ok).toBe(allowed);
  });
  test("when the scan of what the scene loads was cut short, every write is refused while live (and only then)", () => {
    const partial = { ...onAir, loadsComplete: false };
    const g = agentGuard({ setting: "not-live", live: true, onAir: partial, action: write("daisy/assets/anything.png") });
    expect(g.ok).toBe(false);
    expect(g.ok ? "" : g.reason).toContain("loads more files than ViewSwitcher checks");
    expect(agentGuard({ setting: "not-live", live: false, onAir: partial, action: write("daisy/assets/anything.png") }).ok).toBe(true);
    expect(agentGuard({ setting: "always", live: true, onAir: partial, action: write("daisy/assets/anything.png") }).ok).toBe(true);
  });
  test("when the view on air loads a file the scan couldn't read, every write is refused while live, naming that file", () => {
    const blind = { ...onAir, loadsUnreadable: ["daisy/templates/_shared/linked.css"] };
    const g = agentGuard({ setting: "not-live", live: true, onAir: blind, action: write("daisy/assets/anything.png") });
    expect(g.ok).toBe(false);
    expect(g.ok ? "" : g.reason).toContain("loads daisy/templates/_shared/linked.css, which ViewSwitcher can't read");
    expect(agentGuard({ setting: "not-live", live: false, onAir: blind, action: write("daisy/assets/anything.png") }).ok).toBe(true);
  });
  test("a template set's view on air: its set's transition and _shared/ are on stream, another set's aren't", () => {
    const setView = { path: "daisy/templates/neon/brb.html", transition: "daisy/templates/neon/_shared/transition.html" };
    const ok = (path: string) => agentGuard({ setting: "not-live", live: true, onAir: setView, action: write(path) }).ok;
    expect(ok("daisy/templates/neon/_shared/transition.html")).toBe(false);
    expect(ok("daisy/templates/neon/_shared/theme.css")).toBe(false);
    expect(ok("daisy/templates/_shared/theme.css")).toBe(false);
    expect(ok("daisy/templates/_shared/transition.html")).toBe(false); // would take over if the set's went away
    expect(ok("daisy/templates/disco/_shared/theme.css")).toBe(true);
    expect(ok("daisy/templates/disco/_shared/transition.html")).toBe(true);
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
    expect(r(write(onAir.path))).toBe("That view is on air and you're live. Make a stream copy with customize_scene (or duplicate_scene) and change that, or wait until you're off air (OBS stops streaming and recording).");
    expect(r(write("daisy/templates/_shared/transition.html"))).toContain("Wait until you're off air");
    expect(r(write("daisy/templates/_shared/theme.css"))).toContain("customize_scene");
    expect(r(write("daisy/assets/logo.svg"))).toContain("uses that file");
    expect(r(go)).toContain("let them put it on air in the switcher");
    expect(r(go, "never")).toContain("never put views on air");
  });
});
