"""Brand constants shared by overlays, thumbnails and channel art."""
import os
from PIL import ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
LOGO = os.path.join(ASSETS, "daisy_clean.png")

BRAND_NAME = "Daisy Debate"
TAGLINE = "DEBATE FROM FIRST PRINCIPLES"

AVENIR = "/System/Library/Fonts/Avenir Next.ttc"
_IDX = {"bold": 0, "demi": 2, "italic": 4, "medium": 5, "regular": 7, "heavy": 8}


def font(style, size):
    return ImageFont.truetype(AVENIR, int(size), index=_IDX[style])


NAVY = (14, 18, 30)
NAVY_D, NAVY_L = (11, 14, 24), (28, 36, 58)
ACCENT = (255, 184, 76)
GREEN = (110, 214, 140)
RED = (255, 110, 110)
WHITE = (245, 245, 247)
MUTED = (190, 196, 210)
CARD_BG = NAVY + (238,)
SLATE = (40, 46, 64)


def t(ts):
    """'m:ss', 'h:mm:ss', 'm:ss.s' or a number -> seconds."""
    if isinstance(ts, (int, float)):
        return float(ts)
    secs = 0.0
    for part in str(ts).split(":"):
        secs = secs * 60 + float(part)
    return secs


def fmt(sec):
    m, s = divmod(int(sec), 60)
    h, m = divmod(m, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
