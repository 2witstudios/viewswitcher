import { describe, expect, test } from "bun:test";
import { MODAL_SELECTOR, modalOpen, trapTab } from "./modal";

describe("modal dialogs own the keyboard (CodeRabbit: Edit with AI over the editor)", () => {
  test("modalOpen asks for an aria-modal dialog", () => {
    const asked: string[] = [];
    expect(modalOpen({ querySelector: (s: string) => (asked.push(s), {} as Element) })).toBe(true);
    expect(modalOpen({ querySelector: () => null })).toBe(false);
    expect(asked).toEqual([MODAL_SELECTOR]);
  });
  test("Tab wraps at the ends, and comes in from outside", () => {
    const [a, b, c] = ["a", "b", "c"];
    expect(trapTab([a, b, c], c, false)).toBe(a);
    expect(trapTab([a, b, c], a, true)).toBe(c);
    expect(trapTab([a, b, c], b, false)).toBeNull();
    expect(trapTab([a, b, c], null, false)).toBe(a);
    expect(trapTab([a, b, c], "outside", true)).toBe(c);
    expect(trapTab([], null, false)).toBeNull();
  });
});
