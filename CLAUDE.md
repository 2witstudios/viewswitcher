# ViewSwitcher

Planning (PageSpace drive, board, task codes): AGENTS.md.

Bun workspaces monorepo: a live-stream scene switcher that drives OBS (`apps/`, `packages/`), plus a post pipeline (`post/`, has its own CLAUDE.md). Start with README.md.

- Scene **content** lives in a separate repo, `~/ViewSwitcher Library` (env `VIEWSWITCHER_LIBRARY`), one folder per org. To create or edit scenes, work there with its `viewswitcher-scenes` skill. Don't add an org's scenes to this repo; the only scene HTML here is the neutral starter kit in `apps/server/starter/` (placeholders like `{{ORG_NAME}}` are filled in when an org is created).
- Library paths sent to and from clients start with the org id (`daisy/projects/...`). Every server path from a client goes through `inside()` / `plainName()` in `apps/server/src/paths.ts`.
- `packages/shared` holds the pure logic both sides use (`resolveStream`, `coverTransform`, `obsColor`). Keep it dependency-free and tested (`bun test`).
- `apps/web` must stay a static SPA (no SSR or server functions). The iPad app (`apps/ipad`) loads it from the server over its USB-C tunnel; deploy with `bun run ipad:deploy`.
- `apps/mac` is ViewSwitcher.app (Electron) around the server compiled with `bun build --compile`; the server must keep running as that binary (no repo-relative paths without an env override, see `apps/server/src/config.ts`). Build with `bun run mac:build`, check with `bun apps/mac/scripts/e2e.ts` (never on port 7420).
- The agent skill and library CLAUDE.md that new libraries get live in `apps/server/library-kit/`; change the skill there.
- Typecheck: `cd apps/web && bunx tsc --noEmit && bunx tsc -p tsconfig.test.json`, `cd apps/server && bunx tsc -p .`, `cd apps/mac && bunx tsc -p .`.
