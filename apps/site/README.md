# viewswitcher.com

The landing page: a static Astro site, no client framework. The only script on the page is the hero's scene switcher (about 1 KB, inlined).

```sh
cd apps/site
bun run dev        # http://127.0.0.1:4321
bun run build      # → dist/
bun run preview    # serve dist/ on :4321
bun run check      # astro check (uses TypeScript 6 locally; the rest of the repo is on 7, which astro check doesn't support)
```

The package is named `viewswitcher-site`, outside the `@viewswitcher/*` filter, so the root `bun run dev`, `build` and `start` don't run or build it.

## The call to action (one switch)

`src/site.config.ts` → `MAC_APP_RELEASED`.

| | primary | secondary |
|---|---|---|
| `false` (now) | Get it on GitHub → the repo | Watch releases → /releases |
| `true` (after MAC-8) | Download for Mac → `releases/latest/download/ViewSwitcher.dmg` | View on GitHub |

The hero, the download section and the small print all follow it. A build can override it without a commit, e.g. to show the other state on a Vercel preview: `SITE_MAC_APP=1 bun run build` (or `0`). The dmg link only resolves if the release has an asset named exactly `ViewSwitcher.dmg`.

## Scene images (generated, never hand-made)

```sh
cp -R "$HOME/ViewSwitcher Library" ../../.scratch/library   # once; a COPY, never the real library
bun run shots
```

`scripts/shots.ts` starts the switcher server on port 7432 (OBS offline, USB bridge off, `VIEWSWITCHER_LIBRARY` = the copy; override with `SHOTS_LIBRARY`), opens each scene in `src/data/scene-list.ts` at 1920×1080 in preview mode with the slot labels hidden, and writes `src/assets/scenes/<id>.webp` plus each scene's slot boxes to `src/data/scenes.json`. The site draws its own labelled Camera/Screen/iPad stand-ins over those boxes, and the hero moves them when you switch scenes. Astro turns each image into responsive WebP with a JPEG fallback at build time. Only rendered images enter this repo, never scene HTML.

`bun run og` regenerates `public/og.png` (1200×630) and the icons (`favicon.svg`, `favicon.ico`, `apple-touch-icon.png`) from the mark in `apps/web/public/icon.svg`, drawn in graphite and white.

## Demo video (SITE-11)

Record into **`apps/site/public/demo/viewswitcher-demo.mp4`**: 1920×1080 (16:9), H.264 MP4, 10–20 s, no audio track, loops cleanly, ideally under 4 MB. Build again and the hero plays it (autoplay, muted, looped) in the program monitor, with a rendered scene as the poster, in place of the clickable covers.

## Vercel

Project settings: **Root Directory** `apps/site`, **Framework** Astro. `vercel.json` here sets install (`bun install`), build (`bun run build`), output (`dist`), long-lived caching for `/_astro/*`, and a few security headers. Previews deploy per PR, production from `main`; the domain is viewswitcher.com.

## Privacy

No cookies, no analytics, no third-party requests: the fonts (Space Grotesk, Instrument Sans) are self-hosted from `@fontsource-variable`.
