// Leaving (Done, Back, Edit a copy) and renaming wait for every save, adds and deletes included.
import { describe, expect, test } from "bun:test";
import { createModeStore, idsUnsettled } from "./mode";
import { settleSaves } from "./settle";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () => new Promise((r) => setTimeout(r, 1));

describe("settleSaves", () => {
  test("Done during an add or delete waits for it, then for the queue, then leaves", async () => {
    const mode = createModeStore();
    const queue = deferred();
    mode.dispatch({ t: "structure" });
    let done = null as boolean | null;
    const leaving = settleSaves({ mode, idle: () => queue.promise, conflictPending: () => false }).then((ok) => (done = ok));
    await tick();
    expect(mode.now().kind).toBe("saving-structure"); // not refused, not leaving yet: waiting
    mode.dispatch({ t: "end", kind: "saving-structure" });
    await tick();
    expect(mode.now().kind).toBe("leaving");
    expect(done).toBeNull();
    queue.resolve();
    await leaving;
    expect(done).toBe(true);
    expect(mode.now().kind).toBe("idle");
  });

  test("a conflict during the wait keeps the editor here", async () => {
    const mode = createModeStore();
    const queue = deferred();
    const leaving = settleSaves({ mode, idle: () => queue.promise, conflictPending: () => false });
    await tick();
    const base = { source: "", hash: "", els: [] };
    mode.dispatch({ t: "conflict", conflict: { edits: [], changed: [], prev: base, latest: base } });
    queue.resolve();
    expect(await leaving).toBe(false);
    expect(mode.now().kind).toBe("conflict");
  });

  test("a 409 still waiting for its version keeps the editor here too", async () => {
    const mode = createModeStore();
    expect(await settleSaves({ mode, idle: async () => {}, conflictPending: () => true })).toBe(false);
  });

  test("a rename goes straight after the saves: a picture waiting for a quiet scene doesn't slip in between", async () => {
    const mode = createModeStore();
    const queue = deferred();
    const order: string[] = [];
    // A rename waits for the saves before it; meanwhile a Replace's upload finishes and waits too.
    const rename = settleSaves({ mode, idle: () => queue.promise, conflictPending: () => false }, () => {
      mode.dispatch({ t: "structure" });
      order.push("rename");
    });
    await tick();
    expect(mode.now().kind).toBe("leaving");
    const picture = mode.until((m) => !idsUnsettled(m)).then((m) => order.push(`picture:${m.kind}`));
    queue.resolve(); // the saves land: the rename goes next, without passing through idle
    await rename;
    await tick();
    expect(order).toEqual(["rename"]);
    expect(mode.now().kind).toBe("saving-structure");
    mode.dispatch({ t: "end", kind: "saving-structure" }); // the rename lands: now the picture goes
    await picture;
    expect(order).toEqual(["rename", "picture:idle"]);
  });
});
