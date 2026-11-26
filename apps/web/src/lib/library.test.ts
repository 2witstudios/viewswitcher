import { describe, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { refreshed } from "./library";

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
