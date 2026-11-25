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

The site shows six made-up shows (`src/data/shows.ts`), each with its own look: Full Count (sports podcast, the hero), NOVA_PLAYS (gaming), Grace Community (church), Roam with Remi (travel), Riverside Live (live events) and Saltwater Kitchen (cooking). Each show's views are plain HTML in `scripts/shows/<id>/` (a `theme.css` plus starting soon, full-screen camera, main, break and ending), sharing `scripts/shows/_shared/` (base styles and `view.js`: countdown, clock, and cutting the device boxes out of patterned grounds). They're written to become downloadable template sets (the pack format, [docs/template-packs.md](../../docs/template-packs.md)); `TEMPLATE_DOWNLOADS_URL` in `site.config.ts` turns the show cards' "Download coming soon" into "Download these templates". `scripts/library.ts` copies them into a scratch library **outside the repo** (`$TMPDIR/viewswitcher-site-library`, or `SHOTS_LIBRARY`). `scripts/shots.ts` starts the switcher server on port 7434 (OBS offline, USB bridge off), renders every view the way OBS shows it (transparent, with holes for the devices) to `src/assets/views/<show>-<view>.webp`, and records each view's device boxes and ground color in `src/data/views.json` (`SHOTS_ONLY=nova,grace` renders just those). `bun scripts/contact-sheet.ts <out.jpg>` composites every view with its photos for checking by eye.

The site stacks them the way OBS does: the show's ground color, then the photo or screen in each box (`media` in `shows.ts`, focal points in `src/lib/views.ts`), then the view on top. The hero moves the camera, guest and screen between boxes when you click a view. Photos are Unsplash-licensed and credited in `CREDITS.md`; no real org's scenes appear on the site.

## Pages and SEO (SITE-19…24)

The homepage, `/download`, `/setup` (OBS setup guide), `/ipad`, `/church-livestream`, `/support` and `/privacy`. "The free, one-click OBS scene switcher for Mac" is the descriptor (`descriptor` in `src/site.config.ts`): the homepage title and hero line, and the footer. The Mac app's version and minimum macOS are `site.mac` in `site.config.ts`: update them with each release. Structured data (schema.org JSON-LD) comes from `src/lib/seo.ts` through `Base.astro`'s `schema` prop, and states only what the page shows: SoftwareApplication (free, macOS 14+) on the homepage and `/download`, FAQPage where there are questions on the page (`src/data/faq.ts` for the homepage), HowTo on `/setup`.

App screenshots are real: `bun scripts/app-shots.ts` runs the switcher on port 7434 (OBS offline, USB off) against the scratch library, makes Grace Community a Sunday stream, and saves the switcher, the editor and the Connect OBS card to `src/assets/app/`. The iPad ones are the iPhone and iPad app's App Store screenshots (`apps/apple/scripts/ipad-shots.sh`).

## Templates and template packs (SITE-26 · SITE-29)

`/templates` is a gallery of the six example shows' template sets; `/templates/<slug>` is one page per set (`slug`, `goodFor` and each view's `use` line are in `src/data/shows.ts`, fonts come from the set's `theme.css`, photo credits from `CREDITS.md`). `bun run build` first runs `scripts/packs.ts`, which builds each set's template pack with the app's own exporter (`apps/server/src/export-packs.ts`, the same as `bun run packs:export`), reads every zip back, checks it with the shared validator (a bad pack fails the build), and writes `public/packs/<id>.zip` (gitignored). Vercel serves them as `application/zip`; its install includes `@viewswitcher/server` so the exporter resolves. `PACK_INSTALL_VERSION` in `site.config.ts`: the first app release that installs packs (null: "comes in the next update").

## Demo video (SITE-11)

Record into **`apps/site/public/demo/viewswitcher-demo.mp4`**: 1920×1080 (16:9), H.264 MP4, 10–20 s, no audio track, loops cleanly, ideally under 4 MB. Build again and the hero plays it (autoplay, muted, looped) in the program monitor, with a rendered scene as the poster, in place of the clickable covers.

## Vercel

Project settings: **Root Directory** `apps/site`, **Framework** Astro. `vercel.json` here sets install (`bun install`), build (`bun run build`), output (`dist`), long-lived caching for `/_astro/*`, and a few security headers. One URL per page: `www.viewswitcher.com` and the project's production `*.vercel.app` names redirect to `https://viewswitcher.com` (same path); every other host (previews) gets `X-Robots-Tag: noindex`; pages build as `privacy.html` and `cleanUrls` serves them at `/privacy`, redirecting `/privacy.html` and `/index.html`; there are no trailing slashes. Previews deploy per PR, production from `main`; the domain is viewswitcher.com.

## Privacy

No cookies, no analytics, no third-party requests: the fonts (Space Grotesk, Instrument Sans) are self-hosted from `@fontsource-variable`.
