import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { api } from "./api";

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
