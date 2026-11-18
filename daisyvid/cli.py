"""dv: Daisy Debate video pipeline."""
import argparse, importlib.util, os, sys
from .style import ROOT, t, fmt

VIDEOS = os.path.join(ROOT, "videos")

TEMPLATE = '''"""Video spec: {slug}

Times are "m:ss" (decimals OK). Each card shows from start to end; each item fades in at its own time.
Item kinds: see the README ("Card item kinds").
"""
SOURCE = {source!r}
OUTPUT = {output!r}

THUMB = dict(
    at="0:30",                      # pick a frame with `dv thumb {slug} --frames`
    crop=(250, 95, 830, 720),       # face + mic, in 1280x720 frame pixels
    kicker="KICKER TEXT",
    line1="LINE ONE",
    hinge=">",                      # symbol in the amber circle, or None
    line2="LINE TWO?",
)

# item: (reveal_time, kind, payload)
CARDS = [
    dict(start="0:01", end="0:10", kicker="KICKER", title="Opening title",
         items=[("0:05", "note", "One-line framing of the video")]),
]
'''


def vdir(slug):
    d = os.path.join(VIDEOS, slug)
    if not os.path.isdir(d): sys.exit(f"no such video: {d}")
    return d


def load(slug):
    d = vdir(slug)
    spec = importlib.util.spec_from_file_location(f"video_{slug.replace('-', '_')}", os.path.join(d, "video.py"))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    m.SOURCE = os.path.expanduser(m.SOURCE)
    m.OUTPUT = os.path.expanduser(m.OUTPUT)
    if not os.path.exists(m.SOURCE): sys.exit(f"source video not found: {m.SOURCE}")
    return d, m


def cmd_new(a):
    from . import media
    d = os.path.join(VIDEOS, a.slug)
    if os.path.exists(os.path.join(d, "video.py")): sys.exit(f"{d}/video.py already exists")
    src = os.path.abspath(os.path.expanduser(a.source))
    if not os.path.exists(src): sys.exit(f"not found: {src}")
    os.makedirs(d, exist_ok=True)
    out = os.path.splitext(src)[0] + " - with graphics.mp4"
    home = os.path.expanduser("~")
    tilde = lambda p: "~" + p[len(home):] if p.startswith(home) else p
    open(os.path.join(d, "video.py"), "w").write(TEMPLATE.format(slug=a.slug, source=tilde(src), output=tilde(out)))
    print(f"created {d}/video.py")
    if not a.no_transcribe:
        cmd_transcribe(a)


def cmd_transcribe(a):
    from . import media
    d = vdir(a.slug)
    src = load(a.slug)[1].SOURCE
    srt = os.path.join(d, "transcript.srt")
    print("transcribing (whisper base.en)…")
    media.transcribe(src, srt)
    open(os.path.join(d, "transcript.txt"), "w").write(media.srt_to_text(srt))
    print(f"wrote {srt} and transcript.txt")


def _timeline(m, fps):
    from .timeline import Timeline
    return Timeline(m.CARDS, fps=fps)


def cmd_preview(a):
    from PIL import Image
    from . import media
    from .thumbnail import contact_sheet
    d, m = load(a.slug)
    info = media.probe(m.SOURCE)
    tl = _timeline(m, info["fps"])
    times = [t(x) for x in a.times] if a.times else [t(c["end"]) - 0.3 for c in m.CARDS]   # each card fully revealed
    pv = os.path.join(d, "build", "preview"); os.makedirs(pv, exist_ok=True)
    for fn in os.listdir(pv): os.remove(os.path.join(pv, fn))
    shots = []
    for i, s in enumerate(times):
        raw = os.path.join(pv, f"_raw{i}.png")
        media.frame(m.SOURCE, s, raw)
        base = Image.open(raw).convert("RGBA").resize((1280, 720))
        base.alpha_composite(tl.image_at(s))
        out = os.path.join(pv, f"{i:02d}_{fmt(s).replace(':', '-')}.jpg")
        base.convert("RGB").save(out, quality=90); os.remove(raw)
        shots.append((out, fmt(s)))
    contact_sheet(shots, os.path.join(pv, "_sheet.jpg"), cols=4)
    print(f"{len(shots)} previews in {pv}  (contact sheet: _sheet.jpg)")


def cmd_build(a):
    from . import media
    d, m = load(a.slug)
    info = media.probe(m.SOURCE)
    print(f"source {info['w']}x{info['h']} @ {info['fps']}fps, {fmt(info['duration'])}")
    print("rendering overlay…")
    lst = _timeline(m, info["fps"]).write(os.path.join(d, "build", "overlay"), info["duration"])
    print("measuring audio…")
    af = media.audio_chain(m.SOURCE)
    out = os.path.expanduser(a.out) if a.out else m.OUTPUT
    media.compose(m.SOURCE, lst, out, info, af)
    print(f"done: {out}  (loudness now {media.measure_lufs(out, 'anull'):.1f} LUFS)")


def cmd_thumb(a):
    from . import media, thumbnail
    d, m = load(a.slug)
    tb = os.path.join(d, "build", "thumb"); os.makedirs(tb, exist_ok=True)
    if a.frames:
        dur = media.probe(m.SOURCE)["duration"]
        step = a.every
        shots = []
        for i in range(int(dur // step)):
            s = 5 + i * step
            p = os.path.join(tb, f"f_{int(s)}.jpg"); media.frame(m.SOURCE, s, p); shots.append((p, fmt(s)))
        thumbnail.contact_sheet(shots, os.path.join(tb, "_frames.jpg"))
        print(f"candidate frames: {tb}/_frames.jpg  — set THUMB['at'] in video.py")
        return
    th = m.THUMB
    raw = os.path.join(tb, "frame.png")
    media.frame(m.SOURCE, t(th["at"]), raw)
    out = os.path.expanduser(a.out) if a.out else os.path.splitext(m.OUTPUT)[0].replace(" - with graphics", "") + " - thumbnail.jpg"
    thumbnail.make(raw, out, th["kicker"], th["line1"], th["line2"], th.get("hinge", ">"), tuple(th.get("crop", (250, 95, 830, 720))))
    print(f"thumbnail: {out}")


def cmd_chapters(a):
    _, m = load(a.slug)
    rows = [(0.0, "Intro")]
    for c in m.CARDS[1:]:
        s = t(c["start"])
        if c.get("chapter") is False or s - rows[-1][0] < 10: continue   # YouTube needs ≥10 s chapters
        rows.append((s, c.get("chapter") or c.get("title") or c.get("kicker", "").title()))
    print("\n".join(f"{fmt(s)} {name}" for s, name in rows))


def cmd_brand(a):
    from . import brand
    out = os.path.expanduser(a.out)
    brand.make(out)
    print(f"profile picture + banner in {out}")


def main():
    p = argparse.ArgumentParser(prog="dv", description=__doc__)
    sp = p.add_subparsers(dest="cmd", required=True)
    s = sp.add_parser("new", help="start a video: create videos/<slug>/video.py and transcribe")
    s.add_argument("slug"); s.add_argument("source"); s.add_argument("--no-transcribe", action="store_true")
    s.set_defaults(fn=cmd_new)
    s = sp.add_parser("transcribe", help="(re)run whisper -> transcript.srt + transcript.txt")
    s.add_argument("slug"); s.set_defaults(fn=cmd_transcribe)
    s = sp.add_parser("preview", help="render stills of each card over the video (no encode)")
    s.add_argument("slug"); s.add_argument("times", nargs="*", help="m:ss times (default: end of every card)")
    s.set_defaults(fn=cmd_preview)
    s = sp.add_parser("build", help="render overlay, clean + level audio, encode final mp4")
    s.add_argument("slug"); s.add_argument("--out"); s.set_defaults(fn=cmd_build)
    s = sp.add_parser("thumb", help="make the YouTube thumbnail (or --frames to pick a frame)")
    s.add_argument("slug"); s.add_argument("--frames", action="store_true"); s.add_argument("--every", type=float, default=20)
    s.add_argument("--out"); s.set_defaults(fn=cmd_thumb)
    s = sp.add_parser("chapters", help="print YouTube chapter timestamps from the cards")
    s.add_argument("slug"); s.set_defaults(fn=cmd_chapters)
    s = sp.add_parser("brand", help="regenerate channel profile picture + banner")
    s.add_argument("out", nargs="?", default="~/Documents/Daisy Debate YouTube"); s.set_defaults(fn=cmd_brand)
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
