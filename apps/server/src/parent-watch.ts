// A server the Mac app started exits when the app goes away without stopping it (a crash, a force
// quit), so the port is never left held by an orphan. The app passes its pid in
// VIEWSWITCHER_PARENT_PID; a server started any other way (bun run dev) has none and is never watched.

/** The Mac or Windows app that started this server, or null when something else did. */
export function appParent(env: Record<string, string | undefined> = process.env): number | null {
  const pid = Number(env.VIEWSWITCHER_PARENT_PID);
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}

/** Whether the app that started this server stops it by closing stdin (the Windows app: no SIGTERM there). */
export const stopsOnStdinEnd = (env: Record<string, string | undefined> = process.env) => env.VIEWSWITCHER_STOP_ON_STDIN === "1";

/** Whether a process with this pid exists. EPERM means it does, under another user. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Whether the app is gone. A dead parent is handed to launchd (ppid 1) at once, which also catches
 * the app's pid being reused by another process before the next check.
 */
export function parentGone(parent: number, ppid: number = process.ppid, isAlive: (pid: number) => boolean = alive): boolean {
  return ppid === 1 || !isAlive(parent);
}

/** Calls `onGone` once, the first time a check finds the parent gone. Returns a function that stops watching. */
export function watchParent(parent: number, onGone: () => void, { everyMs = 2000, gone = () => parentGone(parent) } = {}): () => void {
  const timer = setInterval(() => {
    if (!gone()) return;
    clearInterval(timer);
    onGone();
  }, everyMs);
  // Never what keeps the process alive.
  timer.unref();
  return () => clearInterval(timer);
}
