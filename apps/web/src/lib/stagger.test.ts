import { describe, expect, test } from "bun:test";
import { createStagger } from "./stagger";

/** A clock the test moves by hand. */
function clock() {
  let now = 0;
  const timers: { at: number; fn: () => void }[] = [];
  return {
    later: (ms: number, fn: () => void) => void timers.push({ at: now + ms, fn }),
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const t = timers[0];
        if (!t || t.at > until) break;
        timers.shift();
        now = t.at;
        t.fn();
      }
      now = until;
    },
    get now() {
      return now;
    },
  };
}

describe("staggered reloads", () => {
  test("tiles reload one at a time, a gap apart, never all at once", () => {
    const c = clock();
    const s = createStagger({ gap: 100, later: c.later });
    const ran: [string, number][] = [];
    for (const id of ["a", "b", "c", "d"]) s.request(() => ran.push([id, c.now]), () => false);
    expect(ran).toEqual([]); // not inside the render that asked
    c.advance(0);
    expect(ran).toEqual([["a", 0]]);
    c.advance(1000);
    expect(ran).toEqual([["a", 0], ["b", 100], ["c", 200], ["d", 300]]);
  });

  test("the tiles on screen go first, asked again at each turn", () => {
    const c = clock();
    const s = createStagger({ gap: 100, later: c.later });
    const visible = new Set(["c", "d"]);
    const ran: string[] = [];
    for (const id of ["a", "b", "c", "d"]) s.request(() => ran.push(id), () => visible.has(id));
    c.advance(0);
    expect(ran).toEqual(["c"]);
    visible.add("b"); // scrolled into view meanwhile
    c.advance(100);
    c.advance(100);
    c.advance(100);
    expect(ran).toEqual(["c", "b", "d", "a"]); // both on screen by then: in the order they asked
  });

  test("a cancelled reload doesn't run, and the next one isn't held up by it", () => {
    const c = clock();
    const s = createStagger({ gap: 100, later: c.later });
    const ran: string[] = [];
    s.request(() => ran.push("a"), () => false);
    const cancelB = s.request(() => ran.push("b"), () => false);
    s.request(() => ran.push("c"), () => false);
    cancelB();
    c.advance(100);
    expect(ran).toEqual(["a", "c"]);
  });

  test("after a quiet moment the next change starts straight away again", () => {
    const c = clock();
    const s = createStagger({ gap: 100, later: c.later });
    const ran: [string, number][] = [];
    s.request(() => ran.push(["a", c.now]), () => true);
    c.advance(500);
    s.request(() => ran.push(["b", c.now]), () => true);
    c.advance(0);
    expect(ran).toEqual([["a", 0], ["b", 500]]);
  });
});
