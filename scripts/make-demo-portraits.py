"""Draw original illustrated portraits for the demo characters (no AI, no stock art).

Usage: python scripts/make-demo-portraits.py
Writes WebP files to prisma/seed-assets/, used by prisma/seed.mts.
Each picture is a layered scene + character silhouette with rim light, 768x960.
"""
import math
import random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 768, 960
OUT = Path(__file__).resolve().parent.parent / "prisma" / "seed-assets"
OUT.mkdir(parents=True, exist_ok=True)


def font(size):
    """A font with Thai + math glyphs (Tahoma ships with Windows); falls back to PIL's default."""
    for name in ("tahoma.ttf", "C:/Windows/Fonts/tahoma.ttf", "NotoSansThai-Regular.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def vgradient(stops):
    """stops: list of (position 0..1, rgb)."""
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / (H - 1)
        for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
            if p0 <= t <= p1:
                d.line([(0, y), (W, y)], fill=lerp(c0, c1, (t - p0) / max(1e-6, p1 - p0)))
                break
    return img.convert("RGBA")


def glow(img, xy, r, color, alpha=170, blur=60):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    x, y = xy
    ImageDraw.Draw(layer).ellipse([x - r, y - r, x + r, y + r], fill=color + (alpha,))
    return Image.alpha_composite(img, layer.filter(ImageFilter.GaussianBlur(blur)))


def stars(img, n, seed, area=(0, 0, W, H * 0.6), color=(255, 255, 255)):
    rnd = random.Random(seed)
    d = ImageDraw.Draw(img)
    for _ in range(n):
        x = rnd.uniform(area[0], area[2])
        y = rnd.uniform(area[1], area[3])
        r = rnd.choice([0.8, 1, 1.2, 1.6, 2.2])
        a = rnd.randint(120, 255)
        d.ellipse([x - r, y - r, x + r, y + r], fill=color + (a,))
    return img


def bust(img, cx, base_y, scale, body, rim, accessory=None):
    """Character silhouette (head + shoulders) with a soft rim light."""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    head_r = 78 * scale
    head_cy = base_y - 300 * scale
    shoulders = [cx - 230 * scale, base_y - 150 * scale, cx + 230 * scale, base_y + 260 * scale]
    neck = [cx - 42 * scale, head_cy + 40 * scale, cx + 42 * scale, base_y - 120 * scale]
    # rim light: slightly larger shapes, blurred, behind the body
    rim_layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    rd = ImageDraw.Draw(rim_layer)
    g = 10 * scale
    rd.ellipse([cx - head_r - g, head_cy - head_r - g, cx + head_r + g, head_cy + head_r + g], fill=rim + (220,))
    rd.ellipse([shoulders[0] - g, shoulders[1] - g, shoulders[2] + g, shoulders[3]], fill=rim + (200,))
    img = Image.alpha_composite(img, rim_layer.filter(ImageFilter.GaussianBlur(14 * scale)))
    d.ellipse(shoulders, fill=body)
    d.rectangle(neck, fill=body)
    d.ellipse([cx - head_r, head_cy - head_r, cx + head_r, head_cy + head_r], fill=body)
    if accessory:
        accessory(d, cx, head_cy, head_r, scale, body)
    return Image.alpha_composite(img, layer)


def vignette(img, strength=150):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i in range(40):
        a = int(strength * (i / 40) ** 2)
        d.rectangle([i * 6, i * 7, W - i * 6, H - i * 7], outline=(0, 0, 0, a), width=8)
    return Image.alpha_composite(img, layer.filter(ImageFilter.GaussianBlur(30)))


def save(img, name):
    path = OUT / f"{name}.webp"
    img.convert("RGB").save(path, "WEBP", quality=88, method=6)
    print("wrote", path.name, path.stat().st_size // 1024, "KB")


# ---------- Mira Vale: lighthouse keeper on a stormy night ----------
def mira():
    img = vgradient([(0, (12, 18, 48)), (0.55, (38, 48, 96)), (0.7, (24, 34, 70)), (1, (8, 12, 28))])
    img = stars(img, 160, 1)
    img = glow(img, (600, 150), 70, (255, 240, 200), 230, 18)
    img = glow(img, (600, 150), 160, (180, 190, 255), 90, 60)
    d = ImageDraw.Draw(img)
    # sea
    for i in range(14):
        y = 620 + i * 26
        d.arc([-200 + (i % 3) * 60, y - 30, W + 200, y + 40], 180, 360, fill=(90, 120, 190, 70), width=3)
    # cliff + lighthouse
    d.polygon([(0, 700), (180, 600), (330, 640), (380, 960), (0, 960)], fill=(10, 12, 24))
    d.polygon([(150, 300), (230, 300), (250, 610), (130, 610)], fill=(230, 226, 240))
    for y in (370, 450, 530):
        d.rectangle([140, y, 240, y + 22], fill=(200, 60, 80))
    d.rectangle([150, 255, 230, 300], fill=(30, 30, 50))
    img = glow(img, (190, 278), 40, (255, 220, 140), 255, 10)
    beam = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(beam).polygon([(190, 278), (768, 120), (768, 330)], fill=(255, 230, 160, 70))
    img = Image.alpha_composite(img, beam.filter(ImageFilter.GaussianBlur(12)))

    def shawl(d, cx, hy, hr, s, body):
        d.ellipse([cx - hr * 1.15, hy - hr * 1.2, cx + hr * 1.15, hy + hr * 0.3], fill=body)  # hair
        d.ellipse([cx - hr * 1.25, hy - hr * 0.4, cx - hr * 0.55, hy + hr * 1.9], fill=body)  # long hair, left
        d.ellipse([cx + hr * 0.55, hy - hr * 0.4, cx + hr * 1.25, hy + hr * 1.9], fill=body)  # long hair, right

    img = bust(img, 520, 980, 1.25, (14, 16, 34, 255), (255, 210, 150), shawl)
    save(vignette(img), "mira-vale")


# ---------- Captain Idris Kael: smuggler pilot in a nebula ----------
def idris():
    img = vgradient([(0, (8, 6, 22)), (0.5, (30, 12, 54)), (1, (6, 4, 16))])
    img = glow(img, (200, 260), 260, (190, 60, 160), 120, 90)
    img = glow(img, (560, 420), 240, (40, 120, 220), 110, 90)
    img = stars(img, 260, 2, area=(0, 0, W, H))
    img = glow(img, (640, 180), 95, (240, 150, 90), 255, 4)
    d = ImageDraw.Draw(img)
    d.ellipse([560, 100, 720, 260], outline=(255, 210, 160, 160), width=3)
    d.arc([500, 160, 780, 210], 0, 360, fill=(255, 220, 180, 130), width=4)  # ring
    # ship silhouette
    d.polygon([(70, 420), (300, 380), (360, 400), (300, 420), (70, 440)], fill=(14, 12, 28))
    d.polygon([(150, 400), (210, 350), (240, 390)], fill=(14, 12, 28))
    img = glow(img, (66, 430), 26, (120, 220, 255), 255, 8)

    def collar(d, cx, hy, hr, s, body):
        d.polygon([(cx - hr * 1.6, hy + hr * 1.9), (cx - hr * 0.3, hy + hr * 1.2), (cx - hr * 0.9, hy + hr * 3.2)], fill=body)
        d.polygon([(cx + hr * 1.6, hy + hr * 1.9), (cx + hr * 0.3, hy + hr * 1.2), (cx + hr * 0.9, hy + hr * 3.2)], fill=body)
        d.rectangle([cx - hr * 1.05, hy - hr * 0.95, cx + hr * 1.05, hy - hr * 0.55], fill=body)  # cap band
        d.ellipse([cx - hr * 0.95, hy - hr * 1.15, cx + hr * 0.95, hy - hr * 0.35], fill=body)

    img = bust(img, 420, 990, 1.3, (10, 8, 20, 255), (110, 200, 255), collar)
    save(vignette(img), "captain-idris-kael")


# ---------- Professor Nim: warm study with chalkboard ----------
def nim():
    img = vgradient([(0, (54, 34, 22)), (0.6, (90, 58, 34)), (1, (36, 22, 14))])
    d = ImageDraw.Draw(img)
    d.rectangle([60, 120, 708, 470], fill=(30, 52, 44))
    d.rectangle([60, 120, 708, 470], outline=(120, 84, 50), width=14)
    chalk = (220, 230, 220)
    d.text((100, 160), "E = mc²", fill=chalk, font=font(46))
    d.text((100, 230), "a² + b² = c²", fill=chalk, font=font(38))
    d.text((420, 170), "สวัสดี", fill=chalk, font=font(44))
    d.text((420, 250), "f(x) = 2x + 1", fill=chalk, font=font(34))
    d.line([(100, 330), (330, 330)], fill=chalk, width=3)
    d.ellipse([480, 320, 600, 440], outline=chalk, width=3)
    # books
    rnd = random.Random(3)
    x = 40
    while x < 260:
        w = rnd.randint(26, 44)
        h = rnd.randint(120, 190)
        d.rectangle([x, 960 - 120 - h, x + w, 960 - 120], fill=rnd.choice([(150, 50, 50), (60, 90, 150), (200, 160, 60), (70, 120, 80)]))
        x += w + 4
    img = glow(img, (640, 560), 150, (255, 200, 120), 170, 60)

    def glasses(d, cx, hy, hr, s, body):
        d.ellipse([cx - hr * 1.1, hy - hr * 1.15, cx + hr * 1.1, hy - hr * 0.1], fill=body)  # hair
        for ox in (-0.45, 0.45):
            d.ellipse([cx + hr * (ox - 0.32), hy - hr * 0.2, cx + hr * (ox + 0.32), hy + hr * 0.38], outline=(255, 220, 160), width=int(5 * s))
        d.line([(cx - hr * 0.13, hy + hr * 0.05), (cx + hr * 0.13, hy + hr * 0.05)], fill=(255, 220, 160), width=int(5 * s))

    img = bust(img, 430, 990, 1.25, (28, 18, 12, 255), (255, 190, 110), glasses)
    save(vignette(img, 120), "professor-nim")


# ---------- Sora: pastel sunset companion ----------
def sora():
    img = vgradient([(0, (110, 120, 220)), (0.45, (240, 150, 190)), (0.7, (255, 196, 150)), (1, (120, 80, 140))])
    img = glow(img, (384, 560), 130, (255, 230, 170), 255, 30)
    d = ImageDraw.Draw(img)
    rnd = random.Random(4)
    for _ in range(9):
        cx, cy = rnd.randint(0, W), rnd.randint(60, 420)
        for k in range(5):
            r = rnd.randint(30, 60)
            d.ellipse([cx + k * 34 - r, cy - r * 0.6, cx + k * 34 + r, cy + r * 0.6], fill=(255, 240, 250, 110))
    # skyline
    x = 0
    while x < W:
        w = rnd.randint(40, 90)
        h = rnd.randint(80, 220)
        d.rectangle([x, 760 - h, x + w, 960], fill=(70, 50, 110))
        for wy in range(760 - h + 14, 760, 24):
            for wx in range(x + 8, x + w - 8, 16):
                if rnd.random() < 0.35:
                    d.rectangle([wx, wy, wx + 6, wy + 9], fill=(255, 220, 150))
        x += w + 6
    for _ in range(14):  # sparkles
        sx, sy = rnd.randint(30, W - 30), rnd.randint(40, 500)
        d.line([(sx - 8, sy), (sx + 8, sy)], fill=(255, 255, 255, 200), width=2)
        d.line([(sx, sy - 8), (sx, sy + 8)], fill=(255, 255, 255, 200), width=2)

    def headphones(d, cx, hy, hr, s, body):
        d.ellipse([cx - hr * 1.15, hy - hr * 1.2, cx + hr * 1.15, hy + hr * 0.2], fill=body)
        d.arc([cx - hr * 1.25, hy - hr * 1.35, cx + hr * 1.25, hy + hr * 0.9], 190, 350, fill=(255, 150, 200), width=int(12 * s))
        for side in (-1, 1):
            d.rounded_rectangle([cx + side * hr * 1.05 - hr * 0.25, hy - hr * 0.15, cx + side * hr * 1.05 + hr * 0.25, hy + hr * 0.5], radius=int(14 * s), fill=(255, 150, 200))

    img = bust(img, 384, 1000, 1.3, (60, 40, 90, 255), (255, 240, 220), headphones)
    save(vignette(img, 90), "sora")


# ---------- The Archivist: infinite library ----------
def archivist():
    img = vgradient([(0, (24, 14, 10)), (0.5, (46, 28, 18)), (1, (12, 8, 6))])
    d = ImageDraw.Draw(img)
    vx, vy = 384, 380  # vanishing point
    for side in (-1, 1):
        for i in range(12):
            t0, t1 = i / 12, (i + 1) / 12
            x0 = vx + side * (40 + 420 * t0 ** 1.4)
            x1 = vx + side * (40 + 420 * t1 ** 1.4)
            top0, bot0 = vy - 30 - 380 * t0 ** 1.4, vy + 30 + 600 * t0 ** 1.4
            top1, bot1 = vy - 30 - 380 * t1 ** 1.4, vy + 30 + 600 * t1 ** 1.4
            d.polygon([(x0, top0), (x1, top1), (x1, bot1), (x0, bot0)], fill=(60, 36, 22) if i % 2 else (74, 46, 28))
            for k in range(6):
                yy0 = top0 + (bot0 - top0) * (k + 0.2) / 6
                yy1 = top1 + (bot1 - top1) * (k + 0.2) / 6
                d.line([(x0, yy0), (x1, yy1)], fill=(140, 60, 40), width=max(1, int(6 * t1)))
    img = glow(img, (vx, vy), 120, (255, 200, 120), 200, 50)
    rnd = random.Random(5)
    for _ in range(14):  # candles / floating lights
        x, y = rnd.randint(40, W - 40), rnd.randint(80, 560)
        img = glow(img, (x, y), rnd.randint(6, 12), (255, 200, 110), 255, 6)
    d = ImageDraw.Draw(img)
    for _ in range(6):  # floating books
        x, y = rnd.randint(80, W - 120), rnd.randint(120, 480)
        d.polygon([(x, y), (x + 40, y - 12), (x + 80, y), (x + 40, y + 14)], fill=(220, 200, 160, 220))

    def hood(d, cx, hy, hr, s, body):
        d.polygon([(cx, hy - hr * 1.9), (cx - hr * 1.5, hy + hr * 1.6), (cx + hr * 1.5, hy + hr * 1.6)], fill=body)
        d.ellipse([cx - hr * 0.55, hy - hr * 0.1, cx - hr * 0.25, hy + hr * 0.12], fill=(255, 210, 140))
        d.ellipse([cx + hr * 0.25, hy - hr * 0.1, cx + hr * 0.55, hy + hr * 0.12], fill=(255, 210, 140))

    img = bust(img, 384, 1000, 1.3, (16, 10, 8, 255), (255, 190, 110), hood)
    save(vignette(img, 170), "the-archivist")


# ---------- Detective Ruth Okafor: neon city in the rain ----------
def ruth():
    img = vgradient([(0, (10, 8, 24)), (0.6, (26, 16, 44)), (1, (6, 6, 14))])
    d = ImageDraw.Draw(img)
    rnd = random.Random(6)
    x = -20
    while x < W:
        w = rnd.randint(70, 140)
        h = rnd.randint(260, 620)
        d.rectangle([x, 960 - h, x + w, 960], fill=(18, 16, 34))
        x += w + 10
    for (sx, sy, col, text) in [(70, 300, (255, 60, 140), "BAR"), (520, 230, (60, 220, 255), "24H"), (300, 420, (255, 190, 60), "HOTEL")]:
        img = glow(img, (sx + 60, sy + 25), 80, col, 120, 40)
        d = ImageDraw.Draw(img)
        d.rounded_rectangle([sx, sy, sx + 130, sy + 56], radius=10, outline=col, width=4)
        d.text((sx + 22, sy + 8), text, fill=col, font=font(34))
    rain = Image.new("RGBA", img.size, (0, 0, 0, 0))
    rd = ImageDraw.Draw(rain)
    for _ in range(420):
        x, y = rnd.randint(0, W), rnd.randint(0, H)
        rd.line([(x, y), (x - 8, y + 34)], fill=(180, 200, 255, rnd.randint(40, 110)), width=1)
    img = Image.alpha_composite(img, rain)

    def hat(d, cx, hy, hr, s, body):
        d.ellipse([cx - hr * 1.9, hy - hr * 0.75, cx + hr * 1.9, hy - hr * 0.35], fill=body)  # brim
        d.rounded_rectangle([cx - hr * 0.95, hy - hr * 1.55, cx + hr * 0.95, hy - hr * 0.5], radius=int(18 * s), fill=body)
        d.polygon([(cx - hr * 1.7, hy + hr * 2.2), (cx - hr * 0.2, hy + hr * 1.1), (cx - hr * 0.6, hy + hr * 3.4)], fill=body)  # coat collar
        d.polygon([(cx + hr * 1.7, hy + hr * 2.2), (cx + hr * 0.2, hy + hr * 1.1), (cx + hr * 0.6, hy + hr * 3.4)], fill=body)

    img = bust(img, 400, 1000, 1.3, (8, 8, 16, 255), (255, 70, 150), hat)
    save(vignette(img, 160), "detective-ruth-okafor")


for fn in (mira, idris, nim, sora, archivist, ruth):
    fn()
