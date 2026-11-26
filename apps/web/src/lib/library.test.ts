import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { libraryKeys } from "./library";

describe("the library's cache keys", () => {
  test("a show whose id is \"orgs\" keeps its library apart from the list of shows", async () => {
    const client = new QueryClient();
    await client.fetchQuery({ queryKey: libraryKeys.orgs, queryFn: async () => ["the list of shows"] });
    await client.fetchQuery({ queryKey: libraryKeys.org("orgs"), queryFn: async () => ["the Orgs show's library"] });
    expect(client.getQueryData(libraryKeys.orgs)).toEqual(["the list of shows"]);
    expect(client.getQueryData(libraryKeys.org("orgs"))).toEqual(["the Orgs show's library"]);
  });

  test("every id gets its own key, and all of them are refreshed with the library", async () => {
    const ids = ["orgs", "org", "library", "daisy", ""];
    const keys = [libraryKeys.orgs, ...ids.map(libraryKeys.org)].map((k) => JSON.stringify(k));
    expect(new Set(keys).size).toBe(keys.length);
    const client = new QueryClient();
    for (const id of ids) await client.fetchQuery({ queryKey: libraryKeys.org(id), queryFn: async () => id });
    await client.invalidateQueries({ queryKey: ["library"] });
    expect(ids.every((id) => client.getQueryState(libraryKeys.org(id))?.isInvalidated)).toBe(true);
  });
});
