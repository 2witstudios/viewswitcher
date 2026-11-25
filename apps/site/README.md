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

## View images (generated, never hand-made)

```sh
bun run shots     # then: bun run og
```

The site shows four made-up shows (`src/data/shows.ts`): Saltwater Kitchen, Intro to Watercolor, Grace Community and The Long Table. `scripts/library.ts` builds them as a scratch library **outside the repo** (`$TMPDIR/viewswitcher-site-library`, or `SHOTS_LIBRARY`): the starter kit (`apps/server/starter`) restyled per show (colors, fonts, titles), plus a talking-head and an interview layout. `scripts/shots.ts` starts the switcher server on port 7434 (OBS offline, USB bridge off), renders every view the way OBS shows it (transparent, with holes for the devices) to `src/assets/views/<show>-<view>.webp`, records each view's device boxes and ground color in `src/data/views.json`, and renders the made-up screen shares in `scripts/screens/` to `src/assets/media/screen-*.webp`.

The site stacks them the way OBS does: the show's ground color, then the photo or screen in each box (`media` in `shows.ts`, focal points in `src/lib/views.ts`), then the view on top. The hero moves the camera, guest and screen between boxes when you click a view. Photos are Unsplash-licensed and credited in `CREDITS.md`; no real org's scenes appear on the site.

## Demo video (SITE-11)

Record into **`apps/site/public/demo/viewswitcher-demo.mp4`**: 1920×1080 (16:9), H.264 MP4, 10–20 s, no audio track, loops cleanly, ideally under 4 MB. Build again and the hero plays it (autoplay, muted, looped) in the program monitor, with a rendered scene as the poster, in place of the clickable covers.

## Vercel

Project settings: **Root Directory** `apps/site`, **Framework** Astro. `vercel.json` here sets install (`bun install`), build (`bun run build`), output (`dist`), long-lived caching for `/_astro/*`, and a few security headers. Previews deploy per PR, production from `main`; the domain is viewswitcher.com.

## Privacy

No cookies, no analytics, no third-party requests: the fonts (Space Grotesk, Instrument Sans) are self-hosted from `@fontsource-variable`.
