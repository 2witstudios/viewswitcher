import { describe, expect, test } from "bun:test";
import { inside, plainName } from "./paths";

const root = "/tmp/lib";

describe("inside", () => {
  test("allows paths in the library", () => {
    expect(inside(root, "projects/ld/scenes/teaching.html")).toBe("/tmp/lib/projects/ld/scenes/teaching.html");
    expect(inside(root, "/assets/logo.png")).toBe("/tmp/lib/assets/logo.png");
  });
  test("rejects escapes", () => {
    for (const p of ["../etc/passwd", "projects/../../x", "", "a\0b"]) {
      expect(() => inside(root, p)).toThrow();
    }
  });
});

describe("plainName", () => {
  test("accepts upload names, rejects traversal and dot-files", () => {
    expect(plainName("Daisy logo (transparent).png".replace(/[()]/g, ""))).toBeTruthy();
    for (const n of ["../x", "a/b", ".env", ""]) expect(() => plainName(n)).toThrow();
  });
});
