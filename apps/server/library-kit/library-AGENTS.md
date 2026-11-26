# ViewSwitcher Library

Live-stream content for ViewSwitcher, one folder per show (a brand or channel; `<org>/`). Each show has its own templates, assets, projects and brand (`<org>/BRAND.md`). The ViewSwitcher app serves this folder and switches between its views (HTML scene files) in OBS.

Before creating or editing views, read `.claude/skills/viewswitcher-scenes/SKILL.md` (or call the `get_guide` tool). It covers the folder layout, which file to change, the view file contract and the brand.

The ViewSwitcher MCP server is at `http://127.0.0.1:7420/mcp` (Streamable HTTP) while the app is open. With its tools, read a file right before you change it, write with the hash you read, and preview every visual change (`preview_scene`) and fix it until it looks right. Put a view on air only when the user asks.

Claude Code (`.mcp.json`) and Cursor (`.cursor/mcp.json`) pick it up from this folder. For Codex, add it to `~/.codex/config.toml` (or this folder's `.codex/config.toml` once the project is trusted):

```toml
[mcp_servers.viewswitcher]
url = "http://127.0.0.1:7420/mcp"
```
