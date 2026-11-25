# ViewSwitcher: agent map

Rules for the code are below; what the product is, in README.md. Planning lives in PageSpace.

## PageSpace

| what | id |
|---|---|
| Drive "ViewSwitcher" | `nlhtwmyseos66ad3amza4e90` |
| Start here | `x3z2ewdhj7h2tzlzac2ufnw2` |
| Product map | `c7xdk5r3bi189a861na3kjg7` |
| Decisions | `y6758y971ap72lg4ansiz4d6` |
| Board (task list) | `i5cvv1swfj5w8bezoyd6nxkj` |
| Issues (task list) | `j3y1x1wmr10d21hx16cntzxu` |
| Plans folder | `uxtz170vnkzy1arlxhvriguq` |
| Dev channel | `b2li4ri1aov7dsoupz9s50td` |

Statuses on the board: To Do, In Progress, In Review, Blocked, Done.

## Workstreams

Scene editor (EDIT) first and landing page (SITE) in parallel; Mac app (MAC) after EDIT merges. The Product map holds the order.

## Task codes

- `EDIT`: scene editor (plan `w13aum9pua3d4mtflq0i2h4x`)
- `SITE`: landing page, viewswitcher.com (plan `y1qa9qp2ltfjsepjmetpmsgw`)
- `MAC`: Mac app (plan `gz7zkvlaofixz6ljsljdj6sh`)
- `MCP`: agent connection, the MCP server and Edit with AI (plan `q47xu7oithlmzpkeshfn5bdh`)
- `PHONE`: iPhone app, one universal app with the iPad's (plan `yxec9dlaej36ib1ytknvdoq7`)
- `HARD`: hardening: CI and repo hygiene, the live path, the trust boundary, the Mac and iOS shells, vocabulary (plan `giqaj703oqbthlkfknwewy9h`)
- `ISSUE`: bugs, debt and loose ends found outside a slice

Tasks read `<CODE> — Given X, should Y`. Never renumber; inserted work takes a suffix (`EDIT-4a`).

## Workflow

1. A slice has one plan page under Plans (Outcome, Sources, Discovery findings, Design, Task list, Verification, Decisions and open questions) and one board task per code.
2. Post the plan link in the Dev channel (`pagespace channels send b2li4ri1aov7dsoupz9s50td "<message>"`), then build on one branch.
3. One PR per slice; its body names every code it delivers. Move tasks to In Progress while building and In Review when the PR opens; Done after merge.
4. Record decisions on the Decisions page. File anything outside the slice as the next `ISSUE-n`.
5. Never put secrets or .env material in PageSpace. Verify page ids with `pagespace pages read-details <id>`.

## Code rules

Bun workspaces monorepo: a live-stream scene switcher that drives OBS (`apps/`, `packages/`). Start with README.md.

- Scene **content** lives in a separate repo, `~/ViewSwitcher Library` (env `VIEWSWITCHER_LIBRARY`), one folder per org. To create or edit scenes, work there with its `viewswitcher-scenes` skill. Don't add an org's scenes to this repo; the only scene HTML here is the neutral starter kit in `apps/server/starter/` (placeholders like `{{ORG_NAME}}` are filled in when an org is created).
- Library paths sent to and from clients start with the org id (`daisy/projects/...`). Every server path from a client goes through `inside()` / `plainName()` in `apps/server/src/paths.ts`.
- `packages/shared` holds the wire types and pure logic (`resolveStream`, `coverTransform`, `obsColor`, the scene scanner, the pack validator). Keep it dependency-free and tested (`bun test`).
- `apps/web` must stay a static SPA (no SSR or server functions). The iPad app (`apps/apple`, target ViewSwitcher iPad) loads it from the server over its USB-C tunnel; deploy with `bun run ipad:deploy`. Safe areas come from the shells: `env(safe-area-inset-*)` on the iPad, `--shell-*` variables and `data-shell` from the Mac app (MAC-13a).
- `apps/apple` is one Xcode project generated from `project.yml` (XcodeGen; the .xcodeproj is gitignored): ViewSwitcher.app for macOS around the server compiled with `bun build --compile` (Contents/Helpers), the iPad app, and the shared ViewSwitcherKit package. The server must keep running as that binary (no repo-relative paths without an env override, see `apps/server/src/config.ts`). Build with `bun run mac:build`, check with `bun run mac:e2e` (never on port 7420), test with `xcodebuild test` (apps/apple/README.md).
- Scenes are untrusted code (agents, template packs from anyone): `/library/` pages are served with a CSP sandbox (`apps/server/src/scene-sandbox.ts`) and every scene frame is sandboxed (`apps/web/src/lib/scene-frame.ts`). Never give a scene frame `allow-same-origin` together with `allow-scripts`, except the editor's, which only ever loads `?inert` (served with `script-src 'none'`); never reach into a scene frame with contentDocument except that one; the program page talks to scenes through the bridge (`scene-bridge.ts`). Template packs: docs/template-packs.md.
- No absolute filesystem paths in API responses, except `GET /api/info` (the library folder and Edit with AI's commands, for the Mac app's Open Library Folder and the sheet) and `GET /api/agent/viewswitcher.mcpb` (the Claude Desktop extension, whose command is this install's server), which answer only this Mac itself: `fromThisMacOnly` in `apps/server/src/gate.ts` (the gate's `fromThisMac`: loopback peer and Host, no proxy headers; and not the USB-C iPad, whose bridge sockets are marked). Phones paired over Wi-Fi pass the gate but never these, nor `/mcp`.
- `/mcp` (agents, `apps/server/src/mcp/`) is loopback-only the same way, refuses any `Origin` that `originAllowed` rejects, and sits under `hostTrusted`. The agent on-air guard (`agent-guard.ts`) limits MCP tools only, never the switcher's own routes.
- The agent skill and library CLAUDE.md that new libraries get live in `apps/server/library-kit/`; change the skill there.
- Typecheck: `bun run typecheck` (apps/web and its tests, apps/server, packages/shared with its tests). CI (`.github/workflows/ci.yml`) runs it with `bun test`, `astro check`, the switcher build and Kit's `swift test` on every PR; keep it green. Bun is pinned in `.bun-version`.
