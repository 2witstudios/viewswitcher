import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { appSupport, COMPUTER, obsWebsocketConfig, stateRoot } from "./platform-dirs";

describe("where this computer keeps OBS's settings and ViewSwitcher's state", () => {
  test("macOS: ~/Library/Application Support", () => {
    expect(appSupport("darwin", {}, "/Users/sam")).toBe(join("/Users/sam", "Library/Application Support"));
  });
  test("Windows: %APPDATA% (Roaming), where OBS keeps obs-studio", () => {
    const roaming = "C:\\Users\\sam\\AppData\\Roaming";
    expect(appSupport("win32", { APPDATA: roaming }, "C:\\Users\\sam")).toBe(roaming);
    expect(appSupport("win32", {}, "C:\\Users\\sam")).toBe(join("C:\\Users\\sam", "AppData", "Roaming"));
    expect(obsWebsocketConfig(roaming)).toBe(join(roaming, "obs-studio", "plugin_config", "obs-websocket", "config.json"));
    expect(stateRoot(roaming)).toBe(join(roaming, "ViewSwitcher"));
  });
  test("elsewhere: XDG", () => {
    expect(appSupport("linux", { XDG_CONFIG_HOME: "/x" }, "/home/sam")).toBe("/x");
    expect(appSupport("linux", {}, "/home/sam")).toBe(join("/home/sam", ".config"));
  });
  test("what phones and agents are told the computer is", () => {
    expect(COMPUTER).toBe(process.platform === "win32" ? "PC" : "Mac");
  });
});
