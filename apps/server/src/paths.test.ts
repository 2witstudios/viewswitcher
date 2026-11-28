import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { inside, plainName, windowsUnsafe } from "./paths";

const root = "/tmp/lib";

describe("inside", () => {
  test("allows paths in the library", () => {
    expect(inside(root, "projects/ld/scenes/teaching.html")).toBe(resolve("/tmp/lib/projects/ld/scenes/teaching.html"));
    expect(inside(root, "/assets/logo.png")).toBe(resolve("/tmp/lib/assets/logo.png"));
  });
  test("rejects escapes", () => {
    for (const p of ["../etc/passwd", "projects/../../x", "", "a\0b"]) {
      expect(() => inside(root, p)).toThrow();
    }
  });
});

describe("on Windows", () => {
  test("refuses what Windows reads as something else: backslashes, drives and streams, devices, a trailing dot or space", () => {
    for (const p of ["daisy\\templates\\brb.html", "daisy/templates/brb.html:hidden", "C:/Windows/win.ini", "daisy/CON", "daisy/nul.html", "daisy/com1.txt", "daisy/templates/brb.html.", "daisy/brb ", "daisy/a*b", "daisy/a?b"]) {
      expect(() => inside(root, p, true)).toThrow();
    }
    for (const n of ["CON", "aux.html", "LPT9", "logo.png.", "a:b"]) expect(() => plainName(n, true)).toThrow();
  });
  test("still allows the names a library has", () => {
    expect(inside(root, "daisy/templates/brb.html", true)).toBe(resolve("/tmp/lib/daisy/templates/brb.html"));
    expect(inside(root, "daisy/projects/live/streams/12-07-show/console.html", true)).toBeTruthy();
    expect(plainName("Daisy logo.png", true)).toBe("Daisy logo.png");
    expect(windowsUnsafe("contour.html")).toBe(false);
    expect(windowsUnsafe("con.html")).toBe(true);
  });
  test("off Windows, the same names are left alone", () => {
    expect(inside(root, "daisy/templates/brb.html:hidden", false)).toBe(resolve("/tmp/lib/daisy/templates/brb.html:hidden"));
    expect(plainName("CON", false)).toBe("CON");
  });
});

describe("plainName", () => {
  test("accepts upload names, rejects traversal and dot-files", () => {
    expect(plainName("Daisy logo (transparent).png".replace(/[()]/g, ""))).toBeTruthy();
    for (const n of ["../x", "a/b", ".env", ""]) expect(() => plainName(n)).toThrow();
  });
});
