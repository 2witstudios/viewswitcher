// Review finding on PR #1: a save queued behind a 409 must not go out with the reloaded file's hash
// and the old file's element ids (it would patch the wrong element).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyEdits, scanElements, textOf } from "@viewswitcher/shared";
import type { SceneEdit } from "@viewswitcher/shared";
import { createSceneSaver } from "./scene-saver";

class Conflict extends Error {}
const teaching = readFileSync(join(import.meta.dir, "../../../server/starter/templates/teaching.html"), "utf8");
const idOf = (html: string, text: string) => scanElements(html).find((e) => e.leaf && textOf(html, e) === text)!.id;

function setup() {
  // A tiny stand-in for the server: the hash is the file's text.
  let file = teaching;
  const sent: { hash: string; edits: SceneEdit[] }[] = [];
  const send = async (hash: string, edits: SceneEdit[]) => {
    sent.push({ hash, edits });
    if (hash !== file) throw new Conflict();
    file = applyEdits(file, edits);
    return { hash: file };
  };
  let base: { hash: string; source: string } | null = { hash: file, source: file };
  let generation = 1;
  const stale: SceneEdit[][] = [];
  const conflicts: SceneEdit[][] = [];
  const saved: SceneEdit[][] = [];
  const save = createSceneSaver<{ hash: string; source: string }, null>({
    base: () => base,
    generation: () => generation,
    send,
    isConflict: (e) => e instanceof Conflict,
    onSaved: (b, edits, hash) => {
      saved.push(edits);
      base = { hash, source: applyEdits(b.source, edits) };
    },
    onConflict: async (edits) => {
      conflicts.push(edits);
      base = { hash: file, source: file }; // the editor reloads the latest
      generation++;
    },
    onStale: (edits) => void stale.push(edits),
    onError: async (e) => {
      throw e;
    },
  });
  return { save, sent, stale, conflicts, saved, file: () => file, agentWrites: (f: (s: string) => string) => void (file = f(file)) };
}

describe("createSceneSaver", () => {
  test("saves in order against the current version", async () => {
    const s = setup();
    const title = idOf(teaching, "Today's topic");
    const a = s.save([{ id: title, text: "One" }], null);
    const b = s.save([{ id: title, text: "Two" }], null);
    await Promise.all([a, b]);
    expect(s.saved).toHaveLength(2);
    expect(s.file()).toContain(">Two</h2>");
  });

  test("an edit queued behind a 409 isn't sent with the new hash; it joins the conflict", async () => {
    const s = setup();
    const kicker = idOf(teaching, "Notes");
    const para = idOf(teaching, "Key point, link or question for chat.");
    // The agent adds an element above everything: every later id shifts by one.
    s.agentWrites((f) => f.replace("<body>", "<body>\n<span>agent</span>"));
    const a = s.save([{ id: para, text: "Mine A" }], null);
    const b = s.save([{ id: para, text: "Mine B" }], null);
    await Promise.all([a, b]);
    expect(s.conflicts).toEqual([[{ id: para, text: "Mine A" }]]);
    expect(s.stale).toEqual([[{ id: para, text: "Mine B" }]]);
    expect(s.sent).toHaveLength(1); // B never went out
    expect(s.file()).not.toContain("Mine");
    expect(textOf(s.file(), scanElements(s.file())[kicker + 1]!)).toBe("Notes");
  });

  test("a change that started before the reload (a drag, typing) and ends after it isn't sent", async () => {
    const s = setup();
    const para = idOf(teaching, "Key point, link or question for chat.");
    s.agentWrites((f) => f.replace("<body>", "<body>\n<span>agent</span>"));
    const startedIn = 1; // the generation when the drag began
    await s.save([{ id: para, text: "Mine A" }], null); // 409 → reload → generation 2
    await s.save([{ id: para, text: "Dropped late" }], null, startedIn);
    expect(s.stale).toEqual([[{ id: para, text: "Dropped late" }]]);
    expect(s.file()).not.toContain("Dropped late");
  });

  test("a handler that throws doesn't stop later saves", async () => {
    let calls = 0;
    const save = createSceneSaver<{ hash: string }, null>({
      base: () => ({ hash: "h" }),
      generation: () => 1,
      send: async () => {
        if (++calls === 1) throw new Error("network");
        return { hash: "h" };
      },
      isConflict: () => false,
      onSaved: () => {},
      onConflict: async () => {},
      onStale: () => {},
      onError: async () => {
        throw new Error("handler failed");
      },
    });
    await save([{ id: 1, text: "a" }], null).catch(() => {});
    await save([{ id: 1, text: "b" }], null);
    expect(calls).toBe(2);
  });

  test("edits made after the reload save normally", async () => {
    const s = setup();
    const para = idOf(teaching, "Key point, link or question for chat.");
    s.agentWrites((f) => f.replace("<body>", "<body>\n<span>agent</span>"));
    await s.save([{ id: para, text: "Mine A" }], null);
    await s.save([{ id: para + 1, text: "After reload" }], null);
    expect(s.file()).toContain(">After reload</p>");
    expect(s.file()).toContain(">Notes</span>");
  });
});
