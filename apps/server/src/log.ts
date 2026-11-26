// The server's detail log: requests, placements, slot reports, OBS-browser errors. It's off unless
// VIEWSWITCHER_LOG is set (config.verbose); errors and the start-up lines always print. Made once in
// main.ts and handed to whatever takes a `log` option, so nothing reads the environment for it.
export type Log = (line: string) => void;

/** The detail log when `verbose`, else undefined: callers write `log?.(…)`, which costs nothing when it's off. */
export const createLog = (verbose: boolean): Log | undefined => (verbose ? (line) => console.log(line) : undefined);
