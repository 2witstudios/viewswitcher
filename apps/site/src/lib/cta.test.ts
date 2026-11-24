import { describe, expect, test } from "bun:test";
import { ctas, macAppFlag } from "./cta";

const repo = "2witstudios/viewswitcher";
const dmg = "https://github.com/2witstudios/viewswitcher/releases/latest/download/ViewSwitcher.dmg";

describe("ctas", () => {
  test("before the Mac app ships, the primary action is GitHub and the secondary is watching releases", () => {
    const c = ctas({ macAppReleased: false, repo, dmgUrl: dmg });
    expect(c.primary).toEqual({ label: "Get it on GitHub", href: "https://github.com/2witstudios/viewswitcher" });
    expect(c.secondary).toEqual({ label: "Watch releases", href: "https://github.com/2witstudios/viewswitcher/releases" });
    expect(c.state).toBe("github");
  });

  test("after the Mac app ships, the primary action downloads the latest dmg and GitHub is secondary", () => {
    const c = ctas({ macAppReleased: true, repo, dmgUrl: dmg });
    expect(c.primary).toEqual({ label: "Download for Mac", href: dmg });
    expect(c.secondary).toEqual({ label: "View on GitHub", href: "https://github.com/2witstudios/viewswitcher" });
    expect(c.state).toBe("download");
  });
});

describe("macAppFlag", () => {
  test("uses the config value when no override is set", () => {
    expect(macAppFlag(false, undefined)).toBe(false);
    expect(macAppFlag(true, "")).toBe(true);
  });
  test("an override of 1/true or 0/false wins, so a preview can show either state", () => {
    expect(macAppFlag(false, "1")).toBe(true);
    expect(macAppFlag(false, "true")).toBe(true);
    expect(macAppFlag(true, "0")).toBe(false);
    expect(macAppFlag(true, "false")).toBe(false);
  });
  test("rejects anything else rather than guessing", () => {
    expect(() => macAppFlag(false, "yes")).toThrow();
  });
});
