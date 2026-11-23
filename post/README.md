# daisy-video

The Daisy Debate video pipeline. It turns a talking-head recording into a finished YouTube upload with:

- Animated bullet cards synced to speech.
- The Daisy Debate badge in the top-left corner.
- Cleaned and levelled audio.
- A thumbnail and chapter timestamps.

Everything is driven from one file per video: `videos/<slug>/video.py`.

## Setup (once)

```bash
brew install ffmpeg whisper-cpp
pip3 install -r requirements.txt
```

The overlays use Avenir Next, which comes with macOS. On first use, the Whisper model (`ggml-base.en`, 140 MB) downloads to `~/.cache/daisy-video/models/`.

## Making a video

```bash
./dv new my-topic ~/Documents/"My Recording.m4v"
```

This creates `videos/my-topic/video.py` and transcribes the recording to `transcript.srt` and `transcript.txt`.

The steps after that:

1. **Write the cards.** Edit `CARDS` in `videos/my-topic/video.py` against `transcript.txt`. Or ask Claude Code in this repo to "write the cards for my-topic", and `CLAUDE.md` tells it how.
2. **Check the cards:**
   ```bash
   ./dv preview my-topic
   ```
   This renders a still of every card over the video in a few seconds. Open `build/preview/_sheet.jpg` to see them all at once. You can also check specific moments with `./dv preview my-topic 4:48 4:52`.
3. **Make the final mp4:**
   ```bash
   ./dv build my-topic
   ```
   This renders the overlay, cleans and levels the audio to -16 LUFS, and encodes to the `OUTPUT` path set in `video.py`. It takes about 3 minutes for a 12-minute video.
4. **Make the thumbnail:**
   ```bash
   ./dv thumb my-topic --frames
   ./dv thumb my-topic
   ```
   `--frames` makes a contact sheet of candidate frames. Set `THUMB['at']` in `video.py` to the frame you want and fill in the text, then run the command again without `--frames`.
5. **Get chapter timestamps:**
   ```bash
   ./dv chapters my-topic
   ```
   This prints chapters for the YouTube description, taken from the card titles. To control the list, set `chapter="..."` on a card to rename its chapter, or `chapter=False` to leave it out.

`./dv brand` regenerates the channel profile picture and banner into `~/Documents/Daisy Debate YouTube/`.

## Card format

```python
dict(start="4:33", end="4:54", kicker="BURDENS = WIN CONDITIONS", title="Your thesis is a three-legged table",
     items=[("4:41", "table", dict(mode="knock", at="4:48")),
            ("4:50", "note", "Remove one leg and you no longer have a table.")])
```

- **Timing:** a card slides in at `start` and out at `end`. Each item fades in at its own time, and the card grows as items appear.
- **Times:** written as `"m:ss"`, and decimals are allowed (`"5:06.5"`).
- **Layout:** cards can't overlap, and the build fails if they do. The card sits on the right side of the frame so the face stays clear.

### Card item kinds

| kind | payload | looks like |
|---|---|---|
| `bullet` | `"text"` | amber dot + body text |
| `check` | `"text"` | green check |
| `cross` | `"text"` | red X |
| `sub` | `"text"` | smaller, muted, indented under the previous line |
| `num` | `("1", "text")` | numbered amber circle |
| `def` | `("Term", "definition")` | amber term over white definition |
| `quote` | `"text"` | large quote with a bar on the left (for resolutions and theses) |
| `q` | `"question?"` | highlighted amber callout box |
| `note` | `"text"` | italic muted footnote |
| `box` | `"text"` | outlined box, chain with `because` to make a flow |
| `because` | `"because of"` | up arrow + italic label between boxes |
| `chips` | `["A", "B", …]` | pill tags that wrap |
| `table` | `dict(mode="knock"\|"target"\|None, at="m:ss")` | thesis on warrant legs over a definitions floor. `knock` drops the right leg at `at`; `target` turns every leg red and adds crosshairs. Optional keys: `top`, `leg`, `floor`, `legs` |

Font limits: Avenir doesn't include the `→` or `≠` glyphs, which render as empty boxes. Write them out in words.

## Audio

The cleanup chain is in `daisyvid/media.py`. It runs these steps:

1. Rumble high-pass at 80 Hz.
2. Light denoise.
3. Gentle 2:1 compression.
4. A −2.5 dB dip at 6.5 kHz to soften harshness.
5. A limiter.

The gain is measured per video so every upload lands at -16 LUFS. This is the "B / gentler" version that was picked by ear. A de-esser was tried and rejected.

## Layout

```
dv                      launcher (python3 -m daisyvid.cli)
daisyvid/style.py       brand colours, fonts, time parsing
daisyvid/cards.py       card item kinds, anti-aliased drawing, badge
daisyvid/timeline.py    per-frame states -> cached PNGs + ffmpeg concat list
daisyvid/media.py       ffprobe, whisper, audio chain, final encode
daisyvid/thumbnail.py   thumbnail template + contact sheets
daisyvid/brand.py       channel profile picture + banner
assets/daisy_clean.png  logo (keyed out of the checkerboard export; swap in a real transparent PNG if one turns up)
videos/<slug>/          video.py spec, transcript, youtube.md; build/ is scratch (gitignored)
```
