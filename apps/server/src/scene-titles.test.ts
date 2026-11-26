// The title cache against a filesystem the test controls: what's read again and what isn't.
import { describe, expect, test } from "bun:test";
import { createSceneTitles, type FileStamp } from "./scene-titles";

/** Files by absolute path, each with its text and stamp; `reads` counts the reads of each. */
function disk() {
  const files = new Map<string, { text: string; stamp: FileStamp }>();
  const reads = new Map<string, number>();
  /** Paths whose next read fails (EACCES, EMFILE under load) though their stat works. */
  const failNextRead = new Set<string>();
  let ino = 1;
  const titles = createSceneTitles({
    stat: async (abs) => {
      const f = files.get(abs);
      if (!f) throw new Error("ENOENT");
      return f.stamp;
    },
    read: async (abs) => {
      reads.set(abs, (reads.get(abs) ?? 0) + 1);
      if (failNextRead.delete(abs)) throw new Error("EMFILE");
      const f = files.get(abs);
      if (!f) throw new Error("ENOENT");
      return f.text;
    },
  });
  return {
    titles,
    put: (abs: string, title: string, stamp: Partial<FileStamp> = {}) =>
      files.set(abs, { text: `<title>${title}</title>`, stamp: { size: 100, mtimeMs: 1000, ctimeMs: 1000, ino: ino++, ...stamp } }),
    /** Change the text, keeping the stamp but for `change`. */
    rewrite: (abs: string, title: string, change: Partial<FileStamp> = {}) => {
      const f = files.get(abs)!;
      files.set(abs, { text: `<title>${title}</title>`, stamp: { ...f.stamp, ...change } });
    },
    reads: (abs: string) => reads.get(abs) ?? 0,
    failNextRead: (abs: string) => failNextRead.add(abs),
  };
}

describe("scene titles", () => {
  test("a file whose stamp is the same isn't read again", async () => {
    const d = disk();
    d.put("/lib/o/a.html", "Intro");
    expect(await d.titles.titleOf("/lib/o/a.html")).toBe("Intro");
    expect(await d.titles.titleOf("/lib/o/a.html")).toBe("Intro");
    expect(d.reads("/lib/o/a.html")).toBe(1);
  });

  test("any one part of the stamp changing reads the file again: size, mtime, ctime, inode", async () => {
    for (const change of [{ size: 101 }, { mtimeMs: 2000 }, { ctimeMs: 1000.5 }, { ino: 999 }]) {
      const d = disk();
      d.put("/lib/o/a.html", "Intro");
      await d.titles.titleOf("/lib/o/a.html");
      d.rewrite("/lib/o/a.html", "Outro", change);
      expect(await d.titles.titleOf("/lib/o/a.html")).toBe("Outro");
    }
  });

  test("a path the watcher reports is read again even with the same stamp (a same-second save on a coarse-time drive)", async () => {
    const d = disk();
    d.put("/lib/o/a.html", "Intro");
    d.put("/lib/o/b.html", "BRB");
    await d.titles.titleOf("/lib/o/a.html");
    await d.titles.titleOf("/lib/o/b.html");
    d.rewrite("/lib/o/a.html", "Outro");
    expect(await d.titles.titleOf("/lib/o/a.html")).toBe("Intro"); // nothing told it
    d.titles.forget("/lib", ["o/a.html"]);
    expect(await d.titles.titleOf("/lib/o/a.html")).toBe("Outro");
    await d.titles.titleOf("/lib/o/b.html");
    expect(d.reads("/lib/o/b.html")).toBe(1); // only what was reported
  });

  test("a folder the watcher reports drops every title inside it, and only inside it", async () => {
    const d = disk();
    for (const p of ["/lib/o/s1/a.html", "/lib/o/s1/deep/b.html", "/lib/o/s10/c.html"]) {
      d.put(p, "old");
      await d.titles.titleOf(p);
      d.rewrite(p, "new");
    }
    d.titles.forget("/lib", ["o/s1"]);
    expect(await d.titles.titleOf("/lib/o/s1/a.html")).toBe("new");
    expect(await d.titles.titleOf("/lib/o/s1/deep/b.html")).toBe("new");
    expect(await d.titles.titleOf("/lib/o/s10/c.html")).toBe("old"); // s10 isn't inside s1
  });

  test("forgetting a change to thousands of files at once (a git pull, a sync) is quick", async () => {
    const d = disk();
    for (let s = 0; s < 400; s++) for (const v of "abcde") {
      d.put(`/lib/o/streams/s${s}/${v}.html`, v);
      await d.titles.titleOf(`/lib/o/streams/s${s}/${v}.html`);
    }
    // About 2,000 titles kept: a pass over all of them per path took 200 ms here.
    const paths = Array.from({ length: 20_000 }, (_, i) => `o/streams/s${i % 400}/new-${i}.html`);
    paths.push("o/streams/s7/a.html", "o/streams/s8");
    const t = performance.now();
    d.titles.forget("/lib", paths);
    expect(performance.now() - t).toBeLessThan(100);
    d.rewrite("/lib/o/streams/s8/c.html", "changed");
    expect(await d.titles.titleOf("/lib/o/streams/s8/c.html")).toBe("changed");
  });

  test("a file that can't be stat'ed has no title", async () => {
    const d = disk();
    expect(await d.titles.titleOf("/lib/o/gone.html")).toBe("");
  });

  test("a read that fails isn't kept: the next scan reads the file again and gets its title", async () => {
    const d = disk();
    d.put("/lib/o/a.html", "Intro");
    d.failNextRead("/lib/o/a.html");
    expect(await d.titles.titleOf("/lib/o/a.html")).toBe("");
    expect(await d.titles.titleOf("/lib/o/a.html")).toBe("Intro"); // same stamp, read again
  });
});
