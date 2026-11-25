# Contributing to ViewSwitcher

Thanks for helping. ViewSwitcher is MIT licensed; by contributing you agree your work is too.

## Run it

You need [Bun](https://bun.sh) and OBS.

```sh
bun install
bun run dev        # server on :7420 (watch) + the switcher on http://localhost:5173
```

The README's [For developers](README.md#for-developers-and-self-builders) section covers OBS setup, the library, views, template packs, MCP and the Apple apps.

## Test it

```sh
bun test
bun run typecheck   # apps/web, apps/server, packages/shared
cd apps/site && bun run check
```

CI runs the same checks, the switcher build and ViewSwitcherKit's `swift test` on every pull request, and they should pass before a PR merges. Use the Bun version in `.bun-version`.

Keep `packages/shared` dependency-free and tested. The Apple apps have XCTest; see [apps/apple/README.md](apps/apple/README.md).

## Pull requests

- **One PR per slice:** a slice is one coherent change. Its description names what it delivers (and any task codes, like `EDIT-22`) and how you checked it.
- **Conventional commits:** `feat(site): …`, `fix(server): …`, `chore(apple): …`, with the scope being the part of the repo.
- Never commit secrets, `.env` files or anything from your own library (`~/ViewSwitcher Library`). Scenes for a real show belong in a library, not this repo; the only scene HTML here is the starter kit and the site's example templates.

## Where planning lives

Plans, the board and decisions live in PageSpace (the drive "ViewSwitcher"). If you're an AI agent, start with [AGENTS.md](AGENTS.md). Questions, bugs and ideas: [GitHub issues](https://github.com/2witstudios/viewswitcher/issues).
