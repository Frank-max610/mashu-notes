#!/usr/bin/env python3
"""Generate 麻薯 app icons (SVG + PNG) without external dependencies.

A vibrant squircle (sunset → magenta → dusk) with cream 麻薯 lettering.
Run with: npm run icons
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

STOPS = [(0.0, (255, 122, 23)), (0.55, (255, 77, 141)), (1.0, (139, 92, 246))]
CREAM = (255, 247, 242, 255)

FONT_CANDIDATES = [
    ("/System/Library/Fonts/PingFang.ttc", 2),
    ("/System/Library/Fonts/PingFang.ttc", 1),
    ("/System/Library/Fonts/STHeiti Medium.ttc", 0),
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 0),
]


def load_font(size):
    for path, index in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size=size, index=index)
            except Exception:
                continue
    return ImageFont.load_default()


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient_pixel(t):
    for i in range(len(STOPS) - 1):
        left, right = STOPS[i], STOPS[i + 1]
        if left[0] <= t <= right[0]:
            local = (t - left[0]) / (right[0] - left[0] or 1)
            return lerp(left[1], right[1], local)
    return STOPS[-1][1]


def render_icon(size, maskable=False):
    work = max(size * 4, 1024)
    image = Image.new("RGBA", (work, work), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for y in range(work):
        for x in range(work):
            t = (x / work) * 0.5 + (y / work) * 0.5
            image.putpixel((x, y), gradient_pixel(t) + (255,))

    # soft gloss in the top-left corner
    gloss = Image.new("RGBA", (work, work), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(gloss)
    gdraw.ellipse(
        (-work * 0.35, -work * 0.55, work * 0.72, work * 0.5),
        fill=(255, 255, 255, 40),
    )
    image = Image.alpha_composite(image, gloss)
    draw = ImageDraw.Draw(image)

    text = "麻薯"
    font = load_font(int(work * (0.27 if maskable else 0.30)))
    box = draw.textbbox((0, 0), text, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    draw.text(
        ((work - tw) / 2 - box[0], (work - th) / 2 - box[1] - work * 0.01),
        text,
        font=font,
        fill=CREAM,
    )

    mask = Image.new("L", (work, work), 0)
    radius = 0 if maskable else int(work * 0.22)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, work - 1, work - 1), radius=radius, fill=255)
    rounded = Image.new("RGBA", (work, work), (0, 0, 0, 0))
    rounded.paste(image, (0, 0), mask)
    return rounded.resize((size, size), Image.LANCZOS)


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="麻薯">
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff7a17"/>
      <stop offset=".55" stop-color="#ff4d8d"/>
      <stop offset="1" stop-color="#8b5cf6"/>
    </linearGradient>
    <radialGradient id="gloss" cx=".28" cy=".18" r=".7">
      <stop offset="0" stop-color="#fff" stop-opacity=".35"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="113" fill="url(#brand)"/>
  <rect width="512" height="512" rx="113" fill="url(#gloss)"/>
  <text x="256" y="318" text-anchor="middle" font-family="PingFang SC, SF Pro Display, Noto Sans SC, sans-serif" font-size="168" font-weight="700" fill="#fff7f2">麻薯</text>
</svg>
"""


def main():
    (OUT / "icon.svg").write_text(SVG, encoding="utf-8")
    for size in (180, 192, 512):
        render_icon(size).save(OUT / f"icon-{size}.png")
    render_icon(512, maskable=True).save(OUT / "icon-maskable-512.png")
    render_icon(32).save(OUT.parent / "favicon.ico", sizes=[(32, 32)])
    print(f"icons written to {OUT}")


if __name__ == "__main__":
    main()
