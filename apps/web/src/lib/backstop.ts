// The program page's backstop: a live preview that's neither saved nor refreshed for a while (the
// editor went away) is dropped by reloading the on-air frame. It must never undo a newer request.

type Job = { url: string; path: string };

/** Whether the backstop may reload `job`: it's still what's shown and nothing newer was asked for. */
export function shouldBackstop(shown: Job | null, desired: Job | null, job: Job): boolean {
  return shown === job && desired === job;
}

/** The URL to reload `job` with: one fresh marker, never a growing list of them. */
export function freshUrl(url: string, n: number): string {
  return `${url.replace(/&fresh=\d+/g, "")}&fresh=${n}`;
}
