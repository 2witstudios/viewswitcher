import { describe, expect, test } from "bun:test";
import { limit } from "./limit";

/** A job the test finishes by hand, noting how many ran at once. */
function jobs() {
  let running = 0;
  let peak = 0;
  const open: (() => void)[] = [];
  const started: number[] = [];
  const job = (id: number) => () =>
    new Promise<number>((done) => {
      running++;
      peak = Math.max(peak, running);
      started.push(id);
      open.push(() => {
        running--;
        done(id);
      });
    });
  return { job, open, started, get peak() { return peak; } };
}

describe("limit", () => {
  test("never runs more than n at once, and every job runs, in the order asked", async () => {
    const io = limit(3);
    const j = jobs();
    const all = Promise.all(Array.from({ length: 10 }, (_, i) => io(j.job(i))));
    await Bun.sleep(0);
    expect(j.started).toEqual([0, 1, 2]);
    while (j.open.length) {
      j.open.shift()!();
      await Bun.sleep(0);
    }
    expect(await all).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(j.peak).toBe(3);
    expect(j.started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("a caller arriving just as a slot frees up waits its turn behind those already waiting", async () => {
    const io = limit(1);
    const j = jobs();
    const first = io(j.job(1));
    const second = io(j.job(2));
    await Bun.sleep(0);
    let third: Promise<number> | undefined;
    // Job 1 ends, and in the very next moment, before job 2 has resumed, a third caller arrives.
    j.open.shift()!();
    queueMicrotask(() => void (third = io(j.job(3))));
    await Bun.sleep(0);
    expect(j.started).toEqual([1, 2]);
    expect(j.peak).toBe(1);
    j.open.shift()!();
    await Bun.sleep(0);
    j.open.shift()!();
    expect(await Promise.all([first, second, third!])).toEqual([1, 2, 3]);
    expect(j.peak).toBe(1);
  });

  test("a job that fails frees its slot", async () => {
    const io = limit(1);
    await expect(io(() => Promise.reject(new Error("EACCES")))).rejects.toThrow("EACCES");
    expect(await io(async () => "next")).toBe("next");
  });
});
