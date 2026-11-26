import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { api, packs, refreshed } from "./api";
import { queryClient } from "./live";

/** A page showing an org's library, served by a "server" whose streams the test changes. */
function page() {
  const streams = ["first"];
  const client = new QueryClient();
  const observer = new QueryObserver(client, { queryKey: ["library", "show"], queryFn: async () => [...streams], staleTime: 30_000 });
  const off = observer.subscribe(() => {});
  return { client, streams, shown: () => client.getQueryData<string[]>(["library", "show"]), off };
}

describe("refreshed: a change, then the library as it is after it", () => {
  test("by the time it resolves (when the page navigates), the page's library has the new stream", async () => {
    const p = page();
    await Bun.sleep(0);
    expect(p.shown()).toEqual(["first"]);
    const made = await refreshed(
      (async () => {
        p.streams.push("second"); // the server made it
        return { streamId: "second" };
      })(),
      p.client,
    );
    expect(made).toEqual({ streamId: "second" });
    expect(p.shown()).toEqual(["first", "second"]);
    p.off();
  });

  test("a change that fails throws, as before, and leaves the library alone", async () => {
    const p = page();
    await Bun.sleep(0);
    p.streams.push("not asked for");
    await expect(refreshed(Promise.reject(new Error("That name is taken")), p.client)).rejects.toThrow("That name is taken");
    expect(p.shown()).toEqual(["first"]);
    p.off();
  });
});

describe("which requests refresh the library", () => {
  // Every request answers 200 with an empty body; the library query on the page's own client counts
  // its refetches, which take a moment, so a request that doesn't wait for one resolves before it.
  const realFetch = globalThis.fetch;
  let refetched = 0;
  let off = () => {};
  beforeAll(async () => {
    globalThis.fetch = (async () => Response.json({ path: "show/x.html", name: "x", hash: "h", saved: [] })) as unknown as typeof fetch;
    const observer = new QueryObserver(queryClient, {
      queryKey: ["library", "show"],
      queryFn: async () => {
        await Bun.sleep(5);
        return ++refetched;
      },
      staleTime: 30_000,
    });
    off = observer.subscribe(() => {});
    await Bun.sleep(20);
  });
  afterAll(() => {
    off();
    globalThis.fetch = realFetch;
  });

  const changes: [string, () => Promise<unknown>][] = [
    ["createOrg", () => api.createOrg("Show")],
    ["createProject", () => api.createProject("show", "Weekly", [])],
    ["createStream", () => api.createStream("show", "p", "Episode", "2026-11-26")],
    ["addFromTemplate", () => api.addFromTemplate("show", "brb", "p", "s")],
    ["customize", () => api.customize("show", "p", "s", "brb")],
    ["revert", () => api.revert("show", "p", "s", "brb")],
    ["customizeTransition", () => api.customizeTransition("show", "p")],
    ["revertTransition", () => api.revertTransition("show", "p")],
    ["duplicate", () => api.duplicate("show/templates/brb.html")],
    ["renameScene", () => api.renameScene("show/templates/brb.html", "h", "Back soon")],
    ["upload", () => api.upload("show", [new File(["x"], "logo.png")])],
    ["packs.install", () => packs.install("show", "token")],
    ["packs.removeSet", () => packs.removeSet("show", "neon")],
  ];
  for (const [name, run] of changes) {
    test(`${name} resolves once the page's library has been fetched again`, async () => {
      const before = refetched;
      await run();
      expect(refetched).toBe(before + 1);
    });
  }

  const reads: [string, () => Promise<unknown>][] = [
    ["putOnAir", () => api.putOnAir({ path: "show/templates/brb.html", label: "BRB" })],
    ["editScene", () => api.editScene("show/templates/brb.html", "h", [])],
    ["open", () => api.open("show/templates/brb.html")],
    ["packs.cancel", () => packs.cancel("show", "token")],
  ];
  for (const [name, run] of reads) {
    test(`${name} changes no library listing and refetches nothing`, async () => {
      const before = refetched;
      await run();
      await Bun.sleep(20);
      expect(refetched).toBe(before);
    });
  }
});
