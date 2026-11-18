"""Daisy Debate YouTube profile picture + banner (2560x1440, safe area 1546x423)."""
import os, math, random
import numpy as np
from scipy import ndimage
from PIL import Image, ImageDraw, ImageFilter, ImageChops
from .style import font, LOGO, BRAND_NAME, TAGLINE, NAVY_D, NAVY_L, ACCENT, WHITE


def make(OUT):
    os.makedirs(OUT, exist_ok=True)
    flower = flower_only()
    _profile(flower, OUT)
    _banner(flower, OUT)


def flower_only():
    """Flower cut out of the logo (drops the ring + highlight marks, cleans compression specks)."""

    # flower only: drop the logo's ring and highlight marks
    src = Image.open(LOGO).convert("RGBA")
    cx, cy = src.width / 2, src.height / 2
    mask = Image.new("L", src.size, 0)
    ImageDraw.Draw(mask).ellipse((cx - 236, cy - 236, cx + 236, cy + 236), fill=255)
    flower = Image.new("RGBA", src.size, (0, 0, 0, 0))
    flower.paste(src, (0, 0), ImageChops.multiply(src.getchannel("A"), mask))
    # keep only white petals + orange centre; then morphological opening to drop slivers/specks
    fp = flower.load()
    for y in range(flower.height):
        for x in range(flower.width):
            r, g, b, a = fp[x, y]
            if a == 0: continue
            if min(r, g, b) > 200: continue                       # white petal
            if r > 200 and g > 110 and b < 120: continue           # orange centre
            fp[x, y] = (0, 0, 0, 0)
    A = flower.getchannel("A")
    A = A.filter(ImageFilter.MinFilter(9)).filter(ImageFilter.MaxFilter(9))
    A = ImageChops.multiply(A, flower.getchannel("A")).filter(ImageFilter.GaussianBlur(0.6))
    arr = np.array(A); lab, n = ndimage.label(arr > 40)
    sizes = ndimage.sum(np.ones_like(arr), lab, range(1, n + 1))
    keep = np.isin(lab, [i + 1 for i, sz in enumerate(sizes) if sz > 1500])
    A = Image.fromarray((arr * keep).astype("uint8"))
    # fill grey compression blotches inside petals and force petals pure white
    A = A.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(9))
    rgb = np.array(flower.convert("RGB"))
    orange = (rgb[..., 0] > 200) & (rgb[..., 1] > 110) & (rgb[..., 2] < 120)
    orange = ndimage.binary_opening(orange, iterations=2)
    rgb[~orange] = 255
    flower = Image.fromarray(rgb).convert("RGBA")
    flower.putalpha(A.filter(ImageFilter.GaussianBlur(0.7)))
    flower = flower.crop(flower.getbbox())

    return flower


def radial_bg(w, h, center, r):
    small = Image.new("RGB", (w // 8, h // 8))
    px = small.load()
    for y in range(small.height):
        for x in range(small.width):
            d = min(1, math.hypot(x * 8 - center[0], y * 8 - center[1]) / r)
            t = d * d
            px[x, y] = tuple(int(NAVY_L[i] + (NAVY_D[i] - NAVY_L[i]) * t) for i in range(3))
    return small.resize((w, h), Image.BICUBIC).convert("RGBA")

def glow(size, color, alpha):
    g = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(g).ellipse((size * .25, size * .25, size * .75, size * .75), fill=color + (alpha,))
    return g.filter(ImageFilter.GaussianBlur(size / 8))

def place(base, img, size, center, opacity=1.0, angle=0):
    im = img.resize((size, size), Image.LANCZOS)
    if angle: im = im.rotate(angle, Image.BICUBIC, expand=True)
    if opacity < 1:
        im.putalpha(im.getchannel("A").point(lambda a: int(a * opacity)))
    base.alpha_composite(im, (int(center[0] - im.width / 2), int(center[1] - im.height / 2)))

def _profile(flower, OUT):
    # ---------------- profile picture 800x800
    P = 800
    pfp = radial_bg(P, P, (P / 2, P / 2), P * 0.72)
    place(pfp, flower, 560, (P / 2, P / 2))
    pfp.convert("RGB").save(os.path.join(OUT, "Daisy Debate - profile picture.png"))
    # circle preview (how YouTube shows it)
    prev = Image.new("RGBA", (P, P), (255, 255, 255, 255))
    m = Image.new("L", (P, P), 0); ImageDraw.Draw(m).ellipse((0, 0, P, P), fill=255)
    prev.paste(pfp, (0, 0), m)
    prev.convert("RGB").save(os.path.join(OUT, "_preview_profile_circle.png"))


def _banner(flower, OUT):
    # ---------------- banner 2560x1440 (safe area 1546x423 centred)
    BW, BH = 2560, 1440
    ban = radial_bg(BW, BH, (BW / 2, BH / 2), 1500)
    random.seed(7)
    for (x, y, s, o) in [(260, 300, 520, .07), (2330, 1130, 640, .07), (2200, 260, 300, .05), (400, 1180, 340, .05),
                         (90, 760, 200, .04), (2480, 690, 220, .04), (1850, 1290, 180, .035), (700, 140, 160, .035)]:
        place(ban, flower, s, (x, y), o, random.randint(0, 60))

    title_f, tag_f = font("bold", 132), font("demi", 34)
    title, tag = BRAND_NAME, TAGLINE
    fs = 250
    tw = title_f.getlength(title)
    gap = 56
    total = fs + gap + tw
    x0 = (BW - total) / 2
    cyb = BH / 2
    place(ban, flower, fs, (x0 + fs / 2, cyb))
    d = ImageDraw.Draw(ban)
    tx = x0 + fs + gap
    d.text((tx, cyb - 22), title, font=title_f, fill=WHITE, anchor="ls")
    # tagline with spaced letters
    x = tx + 4
    for ch in tag:
        d.text((x, cyb + 46), ch, font=tag_f, fill=ACCENT, anchor="ls")
        x += tag_f.getlength(ch) + 7
    ban.convert("RGB").save(os.path.join(OUT, "Daisy Debate - banner.png"))

    # preview with safe areas outlined
    pv = ban.copy(); dd = ImageDraw.Draw(pv)
    for (w, h, c) in [(1546, 423, (0, 255, 120)), (2560, 423, (255, 80, 80)), (1855, 423, (80, 160, 255))]:
        dd.rectangle(((BW - w) / 2, (BH - h) / 2, (BW + w) / 2, (BH + h) / 2), outline=c + (255,), width=4)
    pv.convert("RGB").resize((1280, 720)).save(os.path.join(OUT, "_preview_banner_safe.jpg"))
    assert total < 1546, "banner text wider than the YouTube safe area"
