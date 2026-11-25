// Deliberately failing: proves CI turns red (Hardening slice A verification). Never merged.
import { expect, test } from "bun:test";
test("CI turns red on a failing test", () => expect(1).toBe(2));
