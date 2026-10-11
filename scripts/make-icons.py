"""Generate Lumora app icons (PNG + favicon) into public/icons and src/app.

Usage: python scripts/make-icons.py
Original artwork: violet gradient tile with a four-point sparkle.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

TOP_LEFT = (139, 123, 255)   # accent #8b7bff
BOTTOM_RIGHT = (192, 132, 252)  # glow #c084fc
BG = (11, 10, 18)  # app background #0b0a12


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(TOP_LEFT, BOTTOM_RIGHT))
    return img


def sparkle(draw: ImageDraw.ImageDraw, cx: float, cy: float, r: float, fill) -> None:
    """Four-point star: long vertical/horizontal points with a narrow waist."""
    w = r * 0.26
    pts = [(cx, cy - r), (cx + w, cy - w), (cx + r, cy), (cx + w, cy + w), (cx, cy + r), (cx - w, cy + w), (cx - r, cy), (cx - w, cy - w)]
    draw.polygon(pts, fill=fill)


def icon(size: int, maskable: bool) -> Image.Image:
    scale = 4  # draw large, then downsample for smooth edges
    s = size * scale
    if maskable:
        base = gradient(s).convert("RGBA")  # full bleed; platform applies its own mask
        star_r = s * 0.24
    else:
        base = Image.new("RGBA", (s, s), BG + (255,))
        tile = gradient(s).convert("RGBA")
        mask = Image.new("L", (s, s), 0)
        m = s * 0.06
        ImageDraw.Draw(mask).rounded_rectangle([m, m, s - m, s - m], radius=s * 0.24, fill=255)
        base.paste(tile, (0, 0), mask)
        star_r = s * 0.27
    # soft glow behind the sparkle
    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sparkle(ImageDraw.Draw(glow), s / 2, s / 2, star_r * 1.05, (255, 255, 255, 120))
    glow = glow.filter(ImageFilter.GaussianBlur(s * 0.03))
    base = Image.alpha_composite(base, glow)
    d = ImageDraw.Draw(base)
    sparkle(d, s / 2, s / 2, star_r, (255, 255, 255, 255))
    sparkle(d, s * 0.70, s * 0.30, star_r * 0.28, (255, 255, 255, 230))
    return base.resize((size, size), Image.LANCZOS)


for size in (192, 512):
    icon(size, False).save(OUT / f"icon-{size}.png")
    icon(size, True).save(OUT / f"maskable-{size}.png")
icon(180, False).convert("RGB").save(ROOT / "src" / "app" / "apple-icon.png")
icon(256, False).save(ROOT / "src" / "app" / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print("icons written to", OUT)
