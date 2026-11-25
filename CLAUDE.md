# ViewSwitcher

Planning (PageSpace drive, board, task codes): AGENTS.md.

Bun workspaces monorepo: a live-stream scene switcher that drives OBS (`apps/`, `packages/`), plus a post pipeline (`post/`, has its own CLAUDE.md). Start with README.md.

- Scene **content** lives in a separate repo, `~/ViewSwitcher Library` (env `VIEWSWITCHER_LIBRARY`), one folder per org. To create or edit scenes, work there with its `viewswitcher-scenes` skill. Don't add an org's scenes to this repo; the only scene HTML here is the neutral starter kit in `apps/server/starter/` (placeholders like `{{ORG_NAME}}` are filled in when an org is created).
- Library paths sent to and from clients start with the org id (`daisy/projects/...`). Every server path from a client goes through `inside()` / `plainName()` in `apps/server/src/paths.ts`.
- `packages/shared` holds the pure logic both sides use (`resolveStream`, `coverTransform`, `obsColor`). Keep it dependency-free and tested (`bun test`).
- `apps/web` must stay a static SPA (no SSR or server functions). The iPad app (`apps/apple`, target ViewSwitcher iPad) loads it from the server over its USB-C tunnel; deploy with `bun run ipad:deploy`. Safe areas come from the shells: `env(safe-area-inset-*)` on the iPad, `--shell-*` variables and `data-shell` from the Mac app (MAC-13a).
- `apps/apple` is one Xcode project generated from `project.yml` (XcodeGen; the .xcodeproj is gitignored): ViewSwitcher.app for macOS around the server compiled with `bun build --compile` (Contents/Helpers), the iPad app, and the shared ViewSwitcherKit package. The server must keep running as that binary (no repo-relative paths without an env override, see `apps/server/src/config.ts`). Build with `bun run mac:build`, check with `bun run mac:e2e` (never on port 7420), test with `xcodebuild test` (apps/apple/README.md).
- No absolute filesystem paths in API responses, except `GET /api/info` (the library folder and Edit with AI's commands, for the Mac app's Open Library Folder and the sheet) and `GET /api/agent/viewswitcher.mcpb` (the Claude Desktop extension, whose command is this install's server), which answer only this Mac: `isLocalRequest` in `apps/server/src/local.ts` (loopback peer and Host, no proxy headers).
- `/mcp` (agents, `apps/server/src/mcp/`) is loopback-only the same way, refuses any `Origin` that `originAllowed` rejects, and sits under `hostTrusted`. The agent on-air guard (`agent-guard.ts`) limits MCP tools only, never the switcher's own routes.
- The agent skill and library CLAUDE.md that new libraries get live in `apps/server/library-kit/`; change the skill there.
- Typecheck: `cd apps/web && bunx tsc --noEmit && bunx tsc -p tsconfig.test.json`, `cd apps/server && bunx tsc -p .`.
