# Working in daisy-video

This repo makes Daisy Debate YouTube videos. Commands and the card format are in README.md. The finished reference example is `videos/2026-ld-resolution/`; use it as the style guide.

## When asked to do a new video

1. Run `./dv new <slug> <path>` if `videos/<slug>/` doesn't exist yet. The slug is short and kebab-case.
2. Read `transcript.txt` all the way through before writing any cards.
3. Write `CARDS` in `video.py`. Then run `./dv preview <slug>` and look at `build/preview/_sheet.jpg`. Spot-check moments where something animates or a card is dense.
4. Fill in `THUMB`. Use `./dv thumb <slug> --frames` to choose a frame, then `./dv thumb <slug>` and look at the result.
5. Run `./dv build <slug>`.
6. Write `videos/<slug>/youtube.md` with the title, the description and chapters from `./dv chapters <slug>`, edited by hand.

## Card-writing rules (learned from the first video)

- **One card per idea or section.** Cards usually run 15–60 s. Start a card when the speaker starts the idea, not when the transcript line begins.
- **Item timing:** reveal each item when the speaker says it. Find the time in `transcript.srt`; Whisper segments are a few seconds long, so estimate within a segment.
- **Wording:** paraphrase tightly, staying faithful to the speaker's actual claim. Never add arguments the speaker didn't make, and don't "correct" the speaker's terms. "Criterions" is deliberate jargon, for example.
- **Debate logic:** keep it precise. For example, "the negative doesn't have to prove X" is not the same as "the negative can't argue X".
- **Length:** at most about 5 items per card. Each bullet should be 1–2 lines; put detail in a `sub`.
- **Kickers** are short ALL-CAPS section labels, and titles are sentence case.
- **The first card is the video title.** End with a `num` recap card if the speaker recaps.
- **Glyphs:** no → or ≠, because Avenir lacks them.

## Style decisions already made (don't undo)

- **No accent bar on the card's left edge.** The user found it "AI slop". Small bars inside items such as `def` and `quote` are fine.
- **Solid fills only.** Anything translucent inside a card must use `mix()` for an opaque colour, otherwise PIL punches alpha holes in the card.
- **Draw shapes through `AADraw`**, which supersamples them. Plain ImageDraw gives pixelated rounded corners.
- **Audio:** chain "B" with no de-esser, levelled to -16 LUFS.
- **Thumbnail:** both big lines use the same font size and weight. The thumbnail mustn't be clickbait or trash NCFCA.
- **Titles and descriptions** are informative and not clickbait. The tone is critical of a resolution's wording, not of the league.
- **The table graphic** shows a THESIS top on identical "Warrant" legs, standing on a DEFINITIONS floor. The legs are not categories.
