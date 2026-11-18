"""1280x720 YouTube thumbnail: speaker photo left fading into navy, kicker pill, two big lines joined by a hinge symbol."""
from PIL import Image, ImageDraw, ImageEnhance
from .style import font, LOGO, BRAND_NAME, NAVY, ACCENT, WHITE

W, H, S = 1280, 720, 2


def fit(txt, f0, maxw):
    s = f0
    while font("heavy", s * S).getlength(txt) > maxw * S: s -= 2
    return s


def make(frame_path, out, kicker, line1, line2, hinge=">", crop=(250, 95, 830, 720)):
    """crop is in source-frame pixels (x0, y0, x1, y1) around the face; scaled to 720 tall."""
    img = Image.new("RGBA", (W * S, H * S), NAVY + (255,))
    fr = Image.open(frame_path).convert("RGB")
    if fr.size != (1280, 720):   # crop is specified for a 1280x720 frame
        fr = fr.resize((1280, 720), Image.LANCZOS)
    fr = ImageEnhance.Contrast(fr).enhance(1.22)
    fr = ImageEnhance.Color(fr).enhance(1.1)
    fr = ImageEnhance.Brightness(fr).enhance(0.96)
    c = fr.crop(crop)
    ph = H * S
    pw = int(c.width * ph / c.height)
    c = c.resize((pw, ph), Image.LANCZOS).convert("RGBA")
    fade = Image.new("L", (pw, ph), 255)
    fd = ImageDraw.Draw(fade)
    fw = 220 * S
    for i in range(fw):
        fd.line([(pw - fw + i, 0), (pw - fw + i, ph)], fill=int(255 * (1 - i / fw) ** 1.6))
    c.putalpha(fade)
    img.alpha_composite(c, (-40 * S, 0))

    d = ImageDraw.Draw(img)
    tx = 600 * S
    kf = font("demi", 26 * S)
    kw = kf.getlength(kicker) + 36 * S
    d.rounded_rectangle((tx, 92 * S, tx + kw, 140 * S), 24 * S, fill=ACCENT)
    d.text((tx + kw / 2, 116 * S), kicker, font=kf, fill=NAVY, anchor="mm")

    size = min(fit(line1, 86, 650), fit(line2, 86, 650))   # same size for both lines
    big = font("heavy", size * S)
    y = 196 * S
    d.text((tx - 4 * S, y), line1, font=big, fill=WHITE, anchor="lt")
    cy, r = y + 165 * S, 54 * S
    cx = tx + r
    if hinge:
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=ACCENT)
        d.text((cx + 3 * S, cy - 4 * S), hinge, font=font("heavy", 88 * S), fill=NAVY, anchor="mm")
    d.text((tx - 4 * S, cy + 82 * S), line2, font=big, fill=WHITE, anchor="lt")

    logo = Image.open(LOGO).convert("RGBA").resize((52 * S, 52 * S), Image.LANCZOS)
    by = 616 * S
    img.alpha_composite(logo, (tx, by))
    d.text((tx + 66 * S, by + 26 * S), BRAND_NAME, font=font("demi", 30 * S), fill=WHITE, anchor="lm")
    img.resize((W, H), Image.LANCZOS).convert("RGB").save(out, quality=95)


def contact_sheet(paths_times, out, cols=5):
    tw, th = 320, 180
    rows = (len(paths_times) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows * (th + 26)), (20, 20, 20))
    d = ImageDraw.Draw(sheet)
    for i, (p, label) in enumerate(paths_times):
        x, y = (i % cols) * tw, (i // cols) * (th + 26)
        sheet.paste(Image.open(p).convert("RGB").resize((tw, th)), (x, y))
        d.text((x + 6, y + th + 4), label, font=font("demi", 16), fill=WHITE)
    sheet.save(out, quality=88)
