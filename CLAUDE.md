# daisy-production

Bun workspaces monorepo for Daisy Debate video: live scene switching with OBS (`apps/`, `packages/`) and the post pipeline (`post/`, has its own CLAUDE.md). Start with README.md.

- Scene **content** lives in a separate repo, `~/Daisy Production Library` (env `DAISY_LIBRARY`). To create or edit scenes, work there with its `daisy-scenes` skill. Don't add scene HTML to this repo.
- `packages/shared` holds the pure logic both sides use (`resolveStream`, `coverTransform`). Keep it dependency-free and tested (`bun test`).
- Every server path from a client goes through `inside()` in `apps/server/src/paths.ts`.
- `apps/web` must stay a static SPA (no SSR or server functions): a Capacitor app will wrap it.
- Typecheck: `cd apps/web && bunx tsc --noEmit`, `cd apps/server && bunx tsc -p .`.
