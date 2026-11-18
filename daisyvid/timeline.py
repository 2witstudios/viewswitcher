"""Turn a CARDS list into cached PNG states + an ffmpeg concat list."""
import os
from .style import t
from .cards import prep, make_badge, render, ease_out

IN_F, ITEM_F, OUT_F, ANIM_F = 9, 7, 7, 20   # frames: card in, item fade, card out, table animation


class Timeline:
    def __init__(self, cards, fps=24):
        self.cards = [prep(dict(c)) for c in cards]
        self.fps = fps
        self.badge = make_badge()
        self._check()

    def _check(self):
        prev_end = -1
        for c in self.cards:
            s, e = t(c["start"]), t(c["end"])
            if e <= s: raise ValueError(f"card {c.get('title') or c.get('kicker')!r}: end before start")
            if s < prev_end: raise ValueError(f"card {c.get('title') or c.get('kicker')!r} overlaps the previous card")
            for rt, *_ in c["_items"]:
                if not s <= rt <= e: raise ValueError(f"item at {rt:.1f}s outside card {c['start']}-{c['end']}")
            prev_end = e

    def state_at(self, f):
        FPS = self.fps
        tt = f / FPS
        for ci, c in enumerate(self.cards):
            s, e = t(c["start"]), t(c["end"])
            if s <= tt < e + OUT_F / FPS:
                fin = min(1, (f - s * FPS) / IN_F)
                fout = 1 - max(0, (f - e * FPS) / OUT_F)
                ca = ease_out(max(0, fin)) * max(0, fout)
                sl = int(round((1 - ease_out(max(0, fin))) * 40))
                alphas = [max(0, min(1, (f - rt * FPS) / ITEM_F)) for rt, *_ in c["_items"]]
                alphas = tuple(round(round(a * ITEM_F) / ITEM_F, 3) for a in alphas)
                anims = tuple(round(max(0, min(1, (f - fn.anim * FPS) / ANIM_F)) * ANIM_F) / ANIM_F if hasattr(fn, "anim") else 0
                              for *_, fn in c["_items"])
                return (ci, alphas, round(ca, 3), sl, anims)
        return None

    def image(self, key):
        if key is None:
            return self.badge.copy()
        ci, alphas, ca, sl, anims = key
        return render(self.cards[ci], list(alphas), ca, sl, anims, self.badge)

    def image_at(self, seconds):
        return self.image(self.state_at(int(round(seconds * self.fps))))

    def write(self, out, duration, log=print):
        os.makedirs(out, exist_ok=True)
        out = os.path.abspath(out)
        for fn in os.listdir(out):
            if fn.endswith(".png"): os.remove(os.path.join(out, fn))
        blank = os.path.join(out, "blank.png")
        self.badge.save(blank)
        runs, prev, n = [], "__none__", 0
        for f in range(int(duration * self.fps) + 1):
            k = self.state_at(f)
            if k == prev: runs[-1][1] += 1
            else: runs.append([k, 1]); prev = k
        cache, lines = {}, []
        for k, nf in runs:
            if k is None:
                path = blank
            else:
                if k not in cache:
                    n += 1
                    cache[k] = os.path.join(out, f"s{n:05d}.png")
                    self.image(k).save(cache[k], compress_level=1)
                    if n % 100 == 0: log(f"  rendered {n} states")
                path = cache[k]
            lines.append(f"file '{path}'\nduration {nf / self.fps:.6f}\n")
        lines.append(f"file '{blank}'\n")
        lst = os.path.join(out, "list.txt")
        open(lst, "w").write("".join(lines))
        log(f"  {n} states, {len(runs)} segments")
        return lst
