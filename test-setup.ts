// Preloaded by `bun test` (bunfig.toml): every server a test starts, and every module a test imports,
// keeps this computer's state (paired devices, the agent setting) in a temp folder, never in the real
// ~/Library/Application Support/ViewSwitcher (or %APPDATA%\ViewSwitcher on Windows).
// node:fs through require only: an import here would fix its names before test-links patches symlink.
const { mkdtempSync } = require("node:fs");
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linksForWindowsTests } from "./test-links";

process.env.VIEWSWITCHER_STATE ||= mkdtempSync(join(tmpdir(), "vs-machine-state-"));

// Windows lets only admins (or Developer Mode) make symlinks; a junction needs neither. The link tests
// are about folders and files reached through a link, so there a folder link is made a junction.
linksForWindowsTests();
