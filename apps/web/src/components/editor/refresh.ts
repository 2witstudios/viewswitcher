// Reading the scene again because it changed somewhere else, and what to do with what was read.
import type { SceneBase } from "@viewswitcher/shared";

/**
 * `same`: the read is the version the editor already has (its own save, coming back), or the server's
 * newest report says the version open is the file's now (it changed back while this was read, so what
 * was read is older than that report). `retry`: read again later, because the editor got busy, or one
 * of its own saves landed while the file was being read (what was read may be older than what's shown
 * now). `show`: load it.
 */
export function refreshVerdict(r: { readFrom: SceneBase | null; now: SceneBase | null; readHash: string; reportedHash?: string; free: boolean }): "same" | "retry" | "show" {
  if (r.readHash === r.now?.hash || alreadyHave(r.reportedHash, r.now)) return "same";
  if (!r.free || r.now !== r.readFrom) return "retry";
  return "show";
}

/**
 * Whether a change the server reported is the version the editor already has, by the hash the server
 * sent with it (its own save, coming back), so there's nothing to read. Unknown (no hash) isn't.
 */
export const alreadyHave = (reportedHash: string | undefined, now: SceneBase | null) => reportedHash !== undefined && reportedHash === now?.hash;
