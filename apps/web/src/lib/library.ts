import type { OrgContent, Scene, TemplateSet } from "@viewswitcher/shared";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { api } from "./api";

/**
 * The cache keys for what the server's library holds. Each kind has its own place in the key, so no
 * org id can name another kind ("orgs" is a fine name for a show). Everything is under "library",
 * which a change to the library refreshes as one.
 */
export const libraryKeys = {
  orgs: ["library", "orgs"] as const,
  org: (id: string | undefined) => ["library", "org", id] as const,
};

export function useOrgs() {
  return useQuery({ queryKey: libraryKeys.orgs, queryFn: api.orgs });
}

/** The org in the URL (/$org/...), if any. */
export function useOrgId(): string | undefined {
  return (useParams({ strict: false }) as { org?: string }).org;
}

export function useLibrary(org: string | undefined) {
  return useQuery({ queryKey: libraryKeys.org(org), queryFn: () => api.library(org!), enabled: !!org });
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

/** Templates by set: the org's own first, then each installed template pack. */
export function templateGroups(lib: OrgContent): { set: TemplateSet | null; name: string; templates: Scene[] }[] {
  return [{ set: null, name: lib.org.name, templates: lib.templates }, ...lib.sets.map((s) => ({ set: s, name: s.name, templates: s.templates }))];
}
