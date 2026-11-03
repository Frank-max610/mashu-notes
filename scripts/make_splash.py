#!/usr/bin/env python3
"""Generate iOS Home Screen splash screens for 麻薯 (apple-touch-startup-image).

Run with: npm run splash
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "public" / "splash"
OUT.mkdir(parents=True, exist_ok=True)

# (width, height, filename) — iPhone portrait sizes used by current iOS versions.
SIZES = [
    (1290, 2796, "iphone-15-pro-max"),
    (1284, 2778, "iphone-14-plus"),
    (1179, 2556, "iphone-15-pro"),
    (1170, 2532, "iphone-6.1"),
    (1125, 2436, "iphone-x"),
    (828, 1792, "iphone-xr"),
    (750, 1334, "iphone-se"),
]

BG_TOP = (247, 245, 240)
BG_BOTTOM = (240, 237, 230)
INK = (58, 53, 44)
MUTED = (111, 103, 90)

FONT_CANDIDATES = [
    ("/System/Library/Fonts/PingFang.ttc", 2),
    ("/System/Library/Fonts/PingFang.ttc", 0),
    ("/System/Library/Fonts/STHeiti Medium.ttc", 0),
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 0),
]


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path, index in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size=size, index=index)
            except Exception:
                continue
    return ImageFont.load_default()


def render(width: int, height: int) -> Image.Image:
    image = Image.new("RGB", (width, height), BG_TOP)
    draw = ImageDraw.Draw(image)
    for y in range(height):
        ratio = y / max(height - 1, 1)
        color = tuple(round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * ratio) for i in range(3))
        draw.line([(0, y), (width, y)], fill=color)

    cx, cy = width / 2, height / 2
    radius = int(width * 0.09)
    # a soft sage mochi blob
    draw.ellipse((cx - radius, cy - radius * 1.9, cx + radius, cy + radius * 0.1), fill=(223, 233, 227))
    draw.ellipse(
        (cx - radius * 0.62, cy - radius * 1.55, cx + radius * 0.3, cy - radius * 0.95),
        fill=(247, 245, 240),
    )

    title_font = load_font(int(width * 0.12))
    title = "麻薯"
    box = draw.textbbox((0, 0), title, font=title_font)
    draw.text((cx - (box[2] - box[0]) / 2 - box[0], cy + radius * 0.9), title, font=title_font, fill=INK)

    subtitle_font = load_font(int(width * 0.032))
    subtitle = "本地生活记录"
    box2 = draw.textbbox((0, 0), subtitle, font=subtitle_font)
    draw.text(
        (cx - (box2[2] - box2[0]) / 2 - box2[0], cy + radius * 0.9 + (box[3] - box[1]) * 1.55),
        subtitle,
        font=subtitle_font,
        fill=MUTED,
    )
    return image


def main() -> None:
    for width, height, name in SIZES:
        render(width, height).save(OUT / f"{name}.png", optimize=True)
        print(f"  ✓ public/splash/{name}.png ({width}×{height})")


if __name__ == "__main__":
    main()
