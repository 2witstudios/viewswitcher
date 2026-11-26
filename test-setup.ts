// Preloaded by `bun test` (bunfig.toml): every server a test starts, and every module a test imports,
// keeps this Mac's state (paired devices, the agent setting) in a temp folder, never in the real
// ~/Library/Application Support/ViewSwitcher.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.VIEWSWITCHER_STATE ||= mkdtempSync(join(tmpdir(), "vs-machine-state-"));
