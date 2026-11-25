# Library kit

What a new ViewSwitcher library starts with. On every start the server's `ensureLibrary` (`src/library-kit.ts`) copies these into the library, under the names below, when they're missing:

| here | in the library |
|---|---|
| `library-CLAUDE.md` | `CLAUDE.md` |
| `library-gitignore` | `.gitignore` |
| `skills/viewswitcher-scenes/SKILL.md` | `.claude/skills/viewswitcher-scenes/SKILL.md` |
| `library-AGENTS.md` | `AGENTS.md` (Codex, Cursor and other agents: points to the skill and the MCP server) |
| `library-mcp.json` | `.mcp.json` (Claude Code's project MCP config: the switcher's `http://127.0.0.1:7420/mcp`) |
| `library-cursor-mcp.json` | `.cursor/mcp.json` (Cursor's project MCP config, same server) |

They're stored under other names so this repo's own agents and git don't pick them up as this repo's CLAUDE.md, AGENTS.md, .gitignore, MCP config or skill. All of them are meant to be committed in the library's repo, so the kit's `.gitignore` never ignores them.

**This is where changes to the scene skill ship.** A file the kit wrote and nobody has changed since (its hash is in the library's `.viewswitcher/kit.json`) is updated when the kit changes; a file someone edited, or one that was there before the kit, is never touched.

This README isn't copied.
