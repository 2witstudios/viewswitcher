import type { Library, Scene, TemplateSet } from "@viewswitcher/shared";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { api } from "./api";
import { queryClient } from "./live";

export function useOrgs() {
  return useQuery({ queryKey: ["library", "orgs"], queryFn: api.orgs });
}

/** The org in the URL (/$org/...), if any. */
export function useOrgId(): string | undefined {
  return (useParams({ strict: false }) as { org?: string }).org;
}

export function useLibrary(org: string | undefined) {
  return useQuery({ queryKey: ["library", org], queryFn: () => api.library(org!), enabled: !!org });
}

/**
 * A change made here (a new stream, project or view, a copy, a rename, a revert), then the library
 * as it is after it. Await this before going to what changed: the watcher's own refresh comes a
 * moment later, and until then the page would say the new stream or view doesn't exist.
 */
export async function refreshed<T>(change: Promise<T>, client: QueryClient = queryClient): Promise<T> {
  const result = await change;
  await client.invalidateQueries({ queryKey: ["library"] });
  return result;
}

const LAST_ORG = "viewswitcher.org";
export const lastOrg = {
  get: () => {
    try {
      return localStorage.getItem(LAST_ORG) ?? undefined;
    } catch {
      return undefined;
    }
  },
  set: (id: string) => {
    try {
      localStorage.setItem(LAST_ORG, id);
    } catch {}
  },
};

/** How a template is asked for: "teaching" (the org's own) or "neon/teaching" (in the set "neon"). */
export const templateId = (t: Scene) => (t.set ? `${t.set}/${t.name}` : t.name);

/** Templates by set (EDIT-25): the org's own first, then each installed template pack. */
export function templateGroups(lib: Library): { set: TemplateSet | null; name: string; templates: Scene[] }[] {
  return [{ set: null, name: lib.org.name, templates: lib.templates }, ...lib.sets.map((s) => ({ set: s, name: s.name, templates: s.templates }))];
}
