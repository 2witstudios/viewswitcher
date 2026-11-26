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

**The MCP configs and AGENTS.md name port 7420**, the port the Mac app always runs the switcher on, so they're the same file in every library and the kit can keep them updated. A switcher on another port (`PORT`, e.g. a second copy or a test on 7433) isn't reached by them; Edit with AI says so on that port and gives the address to add instead (`claude mcp add --transport http viewswitcher http://127.0.0.1:<port>/mcp`), and its stdio command and Claude Desktop extension carry the real port (`--mcp-stdio --port <port>`).

They're stored under other names so this repo's own agents and git don't pick them up as this repo's CLAUDE.md, AGENTS.md, .gitignore, MCP config or skill. All of them are meant to be committed in the library's repo, so the kit's `.gitignore` never ignores them.

**This is where changes to the agent skill (viewswitcher-scenes) ship.** A file the kit wrote and nobody has changed since (its hash is in the library's `.viewswitcher/kit.json`) is updated when the kit changes; a file someone edited, or one that was there before the kit, is never touched.

This README isn't copied.
