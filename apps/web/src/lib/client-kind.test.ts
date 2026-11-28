import { describe, expect, test } from "bun:test";
import { clientKind, connectorUrl, inDesktopApp } from "./client-kind";

const SAFARI_IPAD = "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

describe("clientKind", () => {
  test("the iPad app, new and old builds", () => {
    expect(clientKind(`${SAFARI_IPAD} ViewSwitcher-iPad/0.1.0`)).toBe("ipad"); // native (apps/apple)
    expect(clientKind(`${SAFARI_IPAD} ViewSwitcher-iPad`)).toBe("ipad"); // Capacitor
    expect(clientKind(`${SAFARI_IPAD} ViewSwitcher`)).toBe("ipad"); // installed before the rename
  });
  test("the Mac app's window is not the iPad app", () => {
    expect(clientKind(`${CHROME} ViewSwitcher-Mac/0.1.0`)).toBe("mac");
    // Electron's default UA names the app; even unpatched it must not read as the iPad.
    expect(clientKind("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ViewSwitcher/0.1.0 Chrome/142.0.0.0 Electron/39.0.0 Safari/537.36")).toBe("browser");
  });
  test("the Windows app's window is the desktop app, not the iPad app", () => {
    const EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36 Edg/158.0.0.0";
    expect(clientKind(`${EDGE} ViewSwitcher-Windows/1.0.0`)).toBe("windows");
    expect(inDesktopApp(clientKind(`${EDGE} ViewSwitcher-Windows/1.0.0`))).toBe(true);
    expect(inDesktopApp(clientKind(`${CHROME} ViewSwitcher-Mac/0.1.0`))).toBe(true);
    expect(inDesktopApp(clientKind(EDGE))).toBe(false);
    expect(clientKind(EDGE)).toBe("browser");
  });
  test("browsers", () => {
    expect(clientKind(CHROME)).toBe("browser");
    expect(clientKind(SAFARI_IPAD)).toBe("browser");
  });
});

describe("connectorUrl", () => {
  test("the native iPad app serves its connector at viewswitcher://connector/", () => {
    expect(connectorUrl(`${SAFARI_IPAD} ViewSwitcher-iPad/0.1.0`)).toBe("viewswitcher://connector/");
  });
  test("older Capacitor builds keep capacitor://localhost/", () => {
    expect(connectorUrl(`${SAFARI_IPAD} ViewSwitcher-iPad`)).toBe("capacitor://localhost/");
    expect(connectorUrl(`${SAFARI_IPAD} ViewSwitcher`)).toBe("capacitor://localhost/");
  });
});
