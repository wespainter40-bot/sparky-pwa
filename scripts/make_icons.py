"""Generate Sparky PWA icons (green energy core + yellow spark) with Pillow."""
import math, random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)
BG = (10, 13, 11, 255)


def make(size, orb_scale=0.62):
    S = size * 2  # supersample
    img = Image.new("RGBA", (S, S), BG)
    c = S / 2
    R = S * orb_scale / 2

    def glow(radius, color, blur):
        layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(layer).ellipse([c - radius, c - radius, c + radius, c + radius], fill=color)
        return layer.filter(ImageFilter.GaussianBlur(blur))

    img = Image.alpha_composite(img, glow(R * 1.5, (0, 200, 83, 70), S * 0.07))
    img = Image.alpha_composite(img, glow(R * 1.15, (0, 200, 83, 140), S * 0.04))
    # orb body: concentric circles, dark rim to bright centre
    body = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(body)
    steps = 60
    for i in range(steps):
        t = i / (steps - 1)
        r = R * (1 - t)
        col = (int(4 + 150 * t ** 1.6), int(70 + 185 * t ** 1.4), int(35 + 120 * t ** 2), 255)
        d.ellipse([c - r, c - r, c + r, c + r], fill=col)
    img = Image.alpha_composite(img, body.filter(ImageFilter.GaussianBlur(S * 0.004)))
    # rim light
    rim = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(rim).ellipse([c - R, c - R, c + R, c + R], outline=(0, 230, 118, 200), width=max(2, int(S * 0.008)))
    img = Image.alpha_composite(img, rim.filter(ImageFilter.GaussianBlur(S * 0.004)))

    # lightning bolt (yellow spark) through the core
    pts = [(0.56, 0.26), (0.43, 0.52), (0.52, 0.52), (0.44, 0.76), (0.62, 0.45), (0.52, 0.45), (0.56, 0.26)]
    poly = [(x * S, y * S) for x, y in pts]
    img = Image.alpha_composite(img, _tint(glow_poly(S, poly, S * 0.025), (255, 200, 40, 200)))
    ImageDraw.Draw(img).polygon(poly, fill=(255, 214, 64, 255))
    inner = [(c + (x - c) * 0.55, c + (y - c) * 0.55 + S * 0.0) for x, y in poly]
    ImageDraw.Draw(img).polygon(inner, fill=(255, 245, 190, 255))

    # a few gold sparks flying off
    random.seed(7)
    dr = ImageDraw.Draw(img)
    for ang in (-35, 20, 150, 205, 265):
        a = math.radians(ang)
        r0, r1 = R * 1.12, R * (1.3 + 0.12 * random.random())
        dr.line([(c + r0 * math.cos(a), c + r0 * math.sin(a)), (c + r1 * math.cos(a), c + r1 * math.sin(a))],
                fill=(255, 205, 60, 255), width=max(2, int(S * 0.012)))
    return img.convert("RGB").resize((size, size), Image.LANCZOS)


def glow_poly(S, poly, blur):
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(layer).polygon(poly, fill=(255, 255, 255, 255))
    return layer.filter(ImageFilter.GaussianBlur(blur))


def _tint(layer, rgba):
    solid = Image.new("RGBA", layer.size, rgba)
    solid.putalpha(layer.getchannel("A").point(lambda v: int(v * rgba[3] / 255)))
    return solid


make(192).save(OUT / "icon-192.png")
make(512).save(OUT / "icon-512.png")
make(512, orb_scale=0.5).save(OUT / "icon-maskable-512.png")  # extra padding for maskable safe zone
make(180).save(OUT / "apple-touch-icon.png")
make(32, 0.8).save(OUT / "favicon-32.png")
print("icons written to", OUT)
