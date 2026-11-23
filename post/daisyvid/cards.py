"""Card layout + drawing. Overlays are drawn at 1280x720 and scaled to the video size when composited."""
import math
from PIL import Image, ImageDraw, ImageFilter
from .style import font, t, LOGO, BRAND_NAME, ACCENT, GREEN, RED, WHITE, MUTED, CARD_BG, SLATE, NAVY

W, H = 1280, 720

F_KICK = font("demi", 14)
F_TITLE = font("bold", 28)
F_BODY = font("medium", 21)
F_BODY_B = font("demi", 21)
F_SUB = font("medium", 17)
F_NOTE = font("italic", 17)
F_QUOTE = font("demi", 24)

CX, CY, CW = 784, 48, 466  # card position/width (right side, face stays clear on the left)
PAD = 24
TW = CW - 2 * PAD
ITEM_GAP = 14


# ---------------------------------------------------------------- helpers
def wrap(text, f, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if f.getlength(trial) <= width or not cur:
            cur = trial
        else:
            lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines


def mix(c, k):
    """Opaque blend of colour c over the card background (PIL writes alpha directly, so never use translucent fills)."""
    return tuple(int(round(CARD_BG[i] + (c[i] - CARD_BG[i]) * k)) for i in range(3))


def lerp(c1, c2, k):
    return tuple(int(round(c1[i] + (c2[i] - c1[i]) * k)) for i in range(3))


def lh(f):
    a, d = f.getmetrics(); return a + d


def rgba(c, a):
    return (c[0], c[1], c[2], int(round(255 * a)) if len(c) == 3 else int(round(c[3] * a)))


def draw_lines(d, x, y, lines, f, col, a, gap=3):
    for ln in lines:
        d.text((x, y), ln, font=f, fill=rgba(col, a)); y += lh(f) + gap
    return y


class AADraw:
    """ImageDraw-compatible wrapper: shapes are drawn 4x supersampled and composited (anti-aliased corners)."""
    S = 4

    def __init__(self, im):
        self.im, self.d = im, ImageDraw.Draw(im)

    def text(self, *a, **k):
        return self.d.text(*a, **k)

    def _patch(self, xs, ys, pad, draw):
        S = self.S
        bx, by = int(math.floor(min(xs) - pad)), int(math.floor(min(ys) - pad))
        bw, bh = int(math.ceil(max(xs) + pad)) - bx + 1, int(math.ceil(max(ys) + pad)) - by + 1
        patch = Image.new("RGBA", (bw * S, bh * S), (0, 0, 0, 0))
        draw(ImageDraw.Draw(patch), lambda x: (x - bx) * S, lambda y: (y - by) * S)
        patch = patch.resize((bw, bh), Image.BOX)
        cx0, cy0 = max(0, -bx), max(0, -by)
        if cx0 or cy0: patch = patch.crop((cx0, cy0, bw, bh)); bx += cx0; by += cy0
        self.im.alpha_composite(patch, (bx, by))

    def _box(self, xy, pad, fn):
        x0, y0, x1, y1 = xy
        self._patch((x0, x1), (y0, y1), pad, lambda d, X, Y: fn(d, (X(x0), Y(y0), X(x1 + 1) - 1, Y(y1 + 1) - 1)))

    def rounded_rectangle(self, xy, radius=0, fill=None, outline=None, width=1):
        self._box(xy, 2, lambda d, b: d.rounded_rectangle(b, radius * self.S, fill=fill, outline=outline, width=width * self.S))

    def rectangle(self, xy, fill=None, outline=None, width=1):
        self._box(xy, 2, lambda d, b: d.rectangle(b, fill=fill, outline=outline, width=width * self.S))

    def ellipse(self, xy, fill=None, outline=None, width=1):
        self._box(xy, 2, lambda d, b: d.ellipse(b, fill=fill, outline=outline, width=width * self.S))

    def line(self, pts, fill=None, width=1, joint=None):
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        def fn(d, X, Y):
            P = [(X(x + .5), Y(y + .5)) for x, y in pts]
            d.line(P, fill=fill, width=width * self.S, joint=joint)
            r = width * self.S / 2   # round caps
            for px, py in (P[0], P[-1]): d.ellipse((px - r, py - r, px + r, py + r), fill=fill)
        self._patch(xs, ys, width + 2, fn)

    def polygon(self, pts, fill=None):
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        self._patch(xs, ys, 2, lambda d, X, Y: d.polygon([(X(x + .5), Y(y + .5)) for x, y in pts], fill=fill))


# ---------------------------------------------------------------- item kinds
# Each returns (height, drawfn(d, im, x, y, alpha[, progress])). Animated kinds set fn.anim = start seconds.
def _note(p):
    ls = wrap(p, F_NOTE, TW)
    return len(ls) * (lh(F_NOTE) + 3) + 4, lambda d, im, x, y, a: draw_lines(d, x, y + 4, ls, F_NOTE, MUTED, a)


def _marker(kind):
    def make(p):
        ls = wrap(p, F_BODY, TW - 28)
        h = len(ls) * (lh(F_BODY) + 3)
        def fn(d, im, x, y, a):
            cy = y + lh(F_BODY) // 2 + 1
            if kind == "bullet":
                d.ellipse((x + 4, cy - 4, x + 12, cy + 4), fill=rgba(ACCENT, a))
            elif kind == "check":
                d.line([(x + 1, cy), (x + 6, cy + 6), (x + 15, cy - 6)], fill=rgba(GREEN, a), width=3, joint="curve")
            else:
                d.line([(x + 2, cy - 6), (x + 14, cy + 6)], fill=rgba(RED, a), width=3)
                d.line([(x + 14, cy - 6), (x + 2, cy + 6)], fill=rgba(RED, a), width=3)
            draw_lines(d, x + 28, y, ls, F_BODY, WHITE, a)
        return h, fn
    return make


def _sub(p):
    ls = wrap(p, F_SUB, TW - 44)
    h = len(ls) * (lh(F_SUB) + 2) - 4
    def fn(d, im, x, y, a):
        d.line([(x + 28, y + 3), (x + 28, y + h + 2)], fill=rgba(mix(ACCENT, 0.6), a), width=2)
        draw_lines(d, x + 40, y, ls, F_SUB, MUTED, a, gap=2)
    return h, fn


def _num(p):
    n, txt = p
    ls = wrap(txt, F_BODY, TW - 42)
    h = max(28, len(ls) * (lh(F_BODY) + 3))
    def fn(d, im, x, y, a):
        d.ellipse((x, y, x + 28, y + 28), fill=rgba(ACCENT, a))
        d.text((x + 14, y + 14), n, font=F_BODY_B, fill=rgba(NAVY, a), anchor="mm")
        draw_lines(d, x + 42, y + (1 if len(ls) > 1 else 0), ls, F_BODY, WHITE, a)
    return h, fn


def _def(p):
    term, defn = p
    ls1 = wrap(term, F_BODY_B, TW - 16)
    ls2 = wrap(defn, F_SUB, TW - 16)
    h = len(ls1) * (lh(F_BODY_B) + 2) + len(ls2) * (lh(F_SUB) + 2) + 2
    def fn(d, im, x, y, a):
        d.rectangle((x, y + 2, x + 3, y + h - 2), fill=rgba(ACCENT, a))
        yy = draw_lines(d, x + 16, y, ls1, F_BODY_B, ACCENT, a, gap=2)
        draw_lines(d, x + 16, yy + 2, ls2, F_SUB, WHITE, a, gap=2)
    return h, fn


def _quote(p):
    ls = wrap(p, F_QUOTE, TW - 20)
    h = len(ls) * (lh(F_QUOTE) + 4) + 8
    def fn(d, im, x, y, a):
        d.rectangle((x, y + 4, x + 4, y + h - 4), fill=rgba(ACCENT, a))
        draw_lines(d, x + 20, y + 4, ls, F_QUOTE, WHITE, a, gap=4)
    return h, fn


def _q(p):
    ls = wrap(p, F_BODY_B, TW - 32)
    h = len(ls) * (lh(F_BODY_B) + 3) + 24
    def fn(d, im, x, y, a):
        d.rounded_rectangle((x, y, x + TW, y + h), 10, fill=rgba(mix(ACCENT, 0.16), a), outline=rgba(ACCENT, a), width=2)
        draw_lines(d, x + 16, y + 12, ls, F_BODY_B, WHITE, a)
    return h, fn


def _box(p):
    h = 46
    def fn(d, im, x, y, a):
        d.rounded_rectangle((x, y, x + TW, y + h), 10, fill=rgba(SLATE, a), outline=rgba(ACCENT, a), width=2)
        d.text((x + TW // 2, y + h // 2), p, font=F_BODY_B, fill=rgba(WHITE, a), anchor="mm")
    return h, fn


def _because(p):
    h = 30
    def fn(d, im, x, y, a):
        cx = x + TW // 2
        d.line([(cx, y + 2), (cx, y + h - 2)], fill=rgba(ACCENT, a), width=2)
        d.polygon([(cx - 6, y + 8), (cx + 6, y + 8), (cx, y + 1)], fill=rgba(ACCENT, a))
        d.text((cx + 14, y + h // 2), p, font=F_NOTE, fill=rgba(MUTED, a), anchor="lm")
    return h, fn


def _chips(p):
    rows, cur, cw = [], [], 0
    for c in p:
        w = F_SUB.getlength(c) + 24
        if cw + w > TW and cur: rows.append(cur); cur, cw = [], 0
        cur.append((c, w)); cw += w + 8
    rows.append(cur)
    h = len(rows) * 40 - 6
    def fn(d, im, x, y, a):
        yy = y
        for r in rows:
            xx = x
            for c, w in r:
                d.rounded_rectangle((xx, yy, xx + w, yy + 32), 16, outline=rgba(ACCENT, a), width=2, fill=rgba(mix(WHITE, 0.08), a))
                d.text((xx + w / 2, yy + 16), c, font=F_SUB, fill=rgba(WHITE, a), anchor="mm")
                xx += w + 8
            yy += 40
    return h, fn


def _table(p):
    """Thesis tabletop on N identical warrant legs over a definitions floor.
    payload: dict(mode="knock"|"target"|None, at="m:ss", top="THESIS", leg="Warrant", floor="DEFINITIONS", legs=3)"""
    mode, at = p.get("mode"), p.get("at")
    top, leg_lbl, floor = p.get("top", "THESIS"), p.get("leg", "Warrant"), p.get("floor", "DEFINITIONS")
    nlegs = p.get("legs", 3)
    h = 170
    def fn(d, im, x, y, a, pr=0.0):
        y += 18
        tx0, tx1 = x + 10, x + TW - 10
        mid = (tx0 + tx1) // 2
        xs = [tx0 + 70 + (tx1 - tx0 - 140) * i / (nlegs - 1) for i in range(nlegs)] if nlegs > 1 else [mid]
        lw, ly0, ly1 = 86, y + 40, y + 118
        q1 = min(1, pr / 0.35)
        q2 = max(0, min(1, (pr - 0.35) / 0.65)); q2e = q2 * q2 * (3 - 2 * q2)
        def leg(cx, col, dy=0, la=1.0):
            d.rectangle((cx - lw // 2, ly0 + dy, cx + lw // 2, ly1 + dy), fill=rgba(SLATE, a * la), outline=rgba(col, a * la), width=2)
            d.text((cx, (ly0 + ly1) / 2 + dy), leg_lbl, font=F_SUB, fill=rgba(WHITE, a * la), anchor="mm")
        tgt = q1 if mode == "target" else 0
        for i, cx in enumerate(xs):
            if mode == "knock" and i == len(xs) - 1:
                leg(cx, lerp(ACCENT, RED, q1), dy=int(46 * q2e), la=1 - q2e)
            else:
                leg(cx, lerp(ACCENT, RED, tgt))
        # table top (supersampled; tilts about the middle when a leg is knocked out)
        S = 4
        ox, oy = tx0 - 24, y - 40
        pw, ph = (tx1 - tx0) + 48, 130
        patch = Image.new("RGBA", (pw * S, ph * S), (0, 0, 0, 0))
        pd = ImageDraw.Draw(patch)
        pd.rounded_rectangle(((tx0 - ox) * S, (y - oy) * S, (tx1 - ox) * S, (y + 40 - oy) * S), 8 * S, fill=rgba(ACCENT, a))
        pd.text(((mid - ox) * S, (y + 20 - oy) * S), top, font=font("bold", 21 * S), fill=rgba(NAVY, a), anchor="mm")
        ang = -6 * q2e if mode == "knock" else 0
        if ang:
            patch = patch.rotate(ang, resample=Image.BICUBIC, center=((mid - ox) * S, (y + 40 - oy) * S))
        im.alpha_composite(patch.resize((pw, ph), Image.BOX), (ox, oy))
        # floor
        fy0, fy1 = y + 118, y + 152
        fc = (58, 66, 92)
        d.rounded_rectangle((x, fy0, x + TW, fy1), 6, fill=rgba(fc, a), outline=rgba(lerp(fc, RED, tgt), a), width=2)
        lx = x + TW / 2 - (sum(F_KICK.getlength(c) + 4 for c in floor) - 4) / 2
        for c in floor:
            d.text((lx, (fy0 + fy1) / 2), c, font=F_KICK, fill=rgba(WHITE, a), anchor="lm"); lx += F_KICK.getlength(c) + 4
        if mode == "target" and tgt > 0:   # crosshairs on each leg
            for cx in xs:
                cy = (ly0 + ly1) / 2 - 22
                d.ellipse((cx - 9, cy - 9, cx + 9, cy + 9), outline=rgba(RED, a * tgt), width=2)
                d.line([(cx - 13, cy), (cx - 5, cy)], fill=rgba(RED, a * tgt), width=2)
                d.line([(cx + 5, cy), (cx + 13, cy)], fill=rgba(RED, a * tgt), width=2)
    if at is not None:
        fn.anim = t(at)
    return h, fn


KINDS = {
    "note": _note, "bullet": _marker("bullet"), "check": _marker("check"), "cross": _marker("cross"),
    "sub": _sub, "num": _num, "def": _def, "quote": _quote, "q": _q, "box": _box,
    "because": _because, "chips": _chips, "table": _table,
}


def item_layout(kind, p):
    if kind not in KINDS:
        raise ValueError(f"unknown item kind {kind!r}; known: {', '.join(KINDS)}")
    return KINDS[kind](p)


# ---------------------------------------------------------------- cards
def prep(card):
    head = []
    y = PAD
    if card.get("kicker"):
        head.append(("kicker", y)); y += lh(F_KICK) + 6
    tls = wrap(card["title"], F_TITLE, TW) if card.get("title") else []
    if tls:
        head.append(("title", y, tls)); y += len(tls) * (lh(F_TITLE) + 1) + 14
    else:
        y += 6
    items = []
    for ts, kind, p in card["items"]:
        h, fn = item_layout(kind, p)
        items.append((t(ts), y, h, fn)); y += h + ITEM_GAP
    card["_head"], card["_items"], card["_h"] = head, items, y - ITEM_GAP + PAD
    return card


def make_badge():
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    f = font("demi", 21)
    size, pad = 40, 8
    tw = f.getlength(BRAND_NAME)
    x0, y0 = 30, CY
    bw, bh = pad + size + 10 + tw + 18, size + 2 * pad
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((x0 + 2, y0 + 5, x0 + bw + 2, y0 + bh + 5), bh // 2, fill=(0, 0, 0, 100))
    im = Image.alpha_composite(im, sh.filter(ImageFilter.GaussianBlur(8)))
    d = AADraw(im)
    d.rounded_rectangle((x0, y0, x0 + bw, y0 + bh), bh // 2, fill=CARD_BG)
    logo = Image.open(LOGO).convert("RGBA").resize((size, size), Image.LANCZOS)
    im.alpha_composite(logo, (x0 + pad, y0 + pad))
    d.text((x0 + pad + size + 10, y0 + bh / 2), BRAND_NAME, font=f, fill=WHITE, anchor="lm")
    return im


def ease_out(x):
    return 1 - (1 - x) ** 3


def render(card, alphas, card_a, slide, anims, badge):
    im = badge.copy()
    its = card["_items"]
    stops = [its[0][1] - ITEM_GAP + PAD] + [it[1] + it[2] + PAD for it in its]
    ch = stops[0]
    for i, a in enumerate(alphas):   # card grows as items reveal
        if a > 0:
            ch = stops[i] + (stops[i + 1] - stops[i]) * ease_out(min(1, a * 1.4))
    ch = int(round(ch))
    x0, y0 = CX + slide, CY
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((x0 + 4, y0 + 8, x0 + CW + 4, y0 + ch + 8), 18, fill=(0, 0, 0, int(110 * card_a)))
    im = Image.alpha_composite(im, sh.filter(ImageFilter.GaussianBlur(10)))
    d = AADraw(im)
    d.rounded_rectangle((x0, y0, x0 + CW, y0 + ch), 18, fill=rgba(CARD_BG, card_a))
    for hd in card["_head"]:
        if hd[0] == "kicker":
            d.text((x0 + PAD, y0 + hd[1]), card["kicker"], font=F_KICK, fill=rgba(ACCENT, card_a))
        else:
            draw_lines(d, x0 + PAD, y0 + hd[1], hd[2], F_TITLE, WHITE, card_a, gap=1)
    for (rt, iy, ih, fn), a, pr in zip(card["_items"], alphas, anims):
        if a > 0:
            ease = 1 - (1 - a) ** 2
            args = (d, im, x0 + PAD + int((1 - ease) * 14), y0 + iy, a * card_a)
            fn(*args, pr) if hasattr(fn, "anim") else fn(*args)
    return im
