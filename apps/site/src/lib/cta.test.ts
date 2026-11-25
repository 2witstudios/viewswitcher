import { describe, expect, test } from "bun:test";
import { ctas, ipadApp, macAppFlag } from "./cta";

const repo = "2witstudios/viewswitcher";
const dmg = "https://github.com/2witstudios/viewswitcher/releases/latest/download/ViewSwitcher.dmg";

describe("ctas", () => {
  test("before the Mac app ships, the primary action follows its releases on GitHub", () => {
    const c = ctas({ macAppReleased: false, repo, dmgUrl: dmg });
    expect(c.primary).toEqual({ label: "Follow the Mac app", href: "https://github.com/2witstudios/viewswitcher/releases" });
    expect(c.state).toBe("soon");
  });

  test("after the Mac app ships, the primary action downloads the latest dmg", () => {
    const c = ctas({ macAppReleased: true, repo, dmgUrl: dmg });
    expect(c.primary).toEqual({ label: "Download for Mac", href: dmg });
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

describe("ipadApp", () => {
  test("with no App Store link yet, the iPad app is coming", () => {
    expect(ipadApp(null)).toEqual({ state: "soon" });
    expect(ipadApp(undefined)).toEqual({ state: "soon" });
    expect(ipadApp("  ")).toEqual({ state: "soon" });
  });
  test("an App Store link turns it into the store badge's link", () => {
    const href = "https://apps.apple.com/app/viewswitcher/id1234567890";
    expect(ipadApp(` ${href} `)).toEqual({ state: "store", href });
  });
  test("rejects a link that isn't the App Store rather than sending people elsewhere", () => {
    expect(() => ipadApp("https://example.com/app")).toThrow();
    expect(() => ipadApp("http://apps.apple.com/app/id1")).toThrow();
  });
});

import { flag } from "./cta";
describe("flag", () => {
  test("the config value, unless the env override says 1/0/true/false", () => {
    expect(flag("X", false, undefined)).toBe(false);
    expect(flag("X", false, "1")).toBe(true);
    expect(flag("X", true, "false")).toBe(false);
    expect(() => flag("SITE_AI_CONNECT_RELEASED", false, "yes")).toThrow(/SITE_AI_CONNECT_RELEASED/);
  });
});
