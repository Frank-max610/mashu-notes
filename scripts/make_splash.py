#!/usr/bin/env python3
"""Generate iOS Home Screen splash screens for 麻薯 (apple-touch-startup-image).

Soft strawberry-milk background, the mochi mascot and the wordmark.
Run with: npm run splash
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent.parent / "public" / "splash"
OUT.mkdir(parents=True, exist_ok=True)

SIZES = [
    (1290, 2796, "iphone-15-pro-max"),
    (1284, 2778, "iphone-14-plus"),
    (1179, 2556, "iphone-15-pro"),
    (1170, 2532, "iphone-6.1"),
    (1125, 2436, "iphone-x"),
    (828, 1792, "iphone-xr"),
    (750, 1334, "iphone-se"),
]

TOP = (255, 249, 247)
BOTTOM = (255, 238, 244)
INK = (74, 58, 66)
MUTED = (138, 106, 121)

FONT_CANDIDATES = [
    ("/System/Library/Fonts/PingFang.ttc", 2),
    ("/System/Library/Fonts/PingFang.ttc", 1),
    ("/System/Library/Fonts/STHeiti Medium.ttc", 0),
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 0),
]


def load_font(size: int):
    for path, index in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size=size, index=index)
            except Exception:
                continue
    return ImageFont.load_default()


def vertical_gradient(image, top, bottom):
    draw = ImageDraw.Draw(image)
    height = image.height
    for y in range(height):
        t = y / max(height - 1, 1)
        color = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        draw.line([(0, y), (image.width, y)], fill=color)


def soft_glow(image, center, radius, color, blur=90):
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    cx, cy = center
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=color)
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    return Image.alpha_composite(image.convert("RGBA"), layer).convert("RGB")


def draw_mascot(image, cx, cy, size):
    draw = ImageDraw.Draw(image, "RGBA")
    body_w, body_h = size * 0.82, size * 0.74
    # body + top highlight
    draw.ellipse((cx - body_w / 2, cy - body_h / 2 + size * 0.08, cx + body_w / 2, cy + body_h / 2 + size * 0.08),
                 fill=(255, 228, 238, 255))
    draw.ellipse((cx - body_w * 0.34, cy - body_h * 0.16, cx + body_w * 0.34, cy + body_h * 0.2),
                 fill=(255, 245, 249, 235))
    # ears / blush
    for side in (-1, 1):
        draw.ellipse((cx + side * body_w * 0.33 - size * 0.05, cy + size * 0.04,
                      cx + side * body_w * 0.33 + size * 0.05, cy + size * 0.13),
                     fill=(255, 166, 188, 180))
    # eyes
    eye = size * 0.026
    for side in (-1, 1):
        ex = cx + side * size * 0.16
        ey = cy - size * 0.03
        draw.ellipse((ex - eye, ey - eye, ex + eye, ey + eye), fill=(90, 59, 70, 255))
        draw.ellipse((ex - eye * 0.35, ey - eye * 0.65, ex + eye * 0.2, ey - eye * 0.05), fill=(255, 255, 255, 230))
    # smile
    draw.arc((cx - size * 0.07, cy + size * 0.02, cx + size * 0.07, cy + size * 0.12), 15, 165, fill=(150, 90, 105, 255), width=max(2, int(size * 0.012)))
    # strawberry hat
    berry_r = size * 0.155
    bx, by = cx + size * 0.17, cy - size * 0.34
    draw.ellipse((bx - berry_r, by - berry_r * 0.85, bx + berry_r, by + berry_r * 0.9), fill=(255, 143, 171, 255))
    draw.ellipse((bx - berry_r * 0.7, by - berry_r * 0.55, bx + berry_r * 0.1, by - berry_r * 0.15), fill=(255, 190, 205, 220))
    # leaf
    leaf = size * 0.09
    draw.polygon(
        [(bx - leaf * 0.9, by - berry_r * 0.7), (bx - leaf * 0.2, by - berry_r * 0.45),
         (bx - leaf * 0.35, by - berry_r * 0.15), (bx - leaf * 1.15, by - berry_r * 0.4)],
        fill=(143, 220, 189, 255),
    )
    draw.polygon(
        [(bx + leaf * 0.9, by - berry_r * 0.7), (bx + leaf * 0.2, by - berry_r * 0.45),
         (bx + leaf * 0.35, by - berry_r * 0.15), (bx + leaf * 1.15, by - berry_r * 0.4)],
        fill=(121, 208, 174, 255),
    )


def render(width, height):
    image = Image.new("RGB", (width, height), TOP)
    vertical_gradient(image, TOP, BOTTOM)
    image = soft_glow(image, (width * 0.12, height * 0.1), width * 0.55, (255, 190, 210, 80), blur=int(width * 0.09))
    image = soft_glow(image, (width * 0.9, height * 0.12), width * 0.5, (196, 176, 234, 70), blur=int(width * 0.09))
    image = soft_glow(image, (width * 0.55, height * 0.96), width * 0.7, (255, 231, 178, 40), blur=int(width * 0.1))

    draw = ImageDraw.Draw(image)
    cx, cy = width / 2, height * 0.44
    draw_mascot(image, cx, cy, width * 0.34)

    title_font = load_font(int(width * 0.11))
    title = "麻薯"
    box = draw.textbbox((0, 0), title, font=title_font)
    title_y = cy + width * 0.25
    draw.text((cx - (box[2] - box[0]) / 2 - box[0], title_y), title, font=title_font, fill=INK)

    sub_font = load_font(int(width * 0.028))
    sub = "记录 · 复盘 · 改进"
    box2 = draw.textbbox((0, 0), sub, font=sub_font)
    draw.text(
        (cx - (box2[2] - box2[0]) / 2 - box2[0], title_y + (box[3] - box[1]) * 1.25),
        sub,
        font=sub_font,
        fill=MUTED,
    )
    return image


def main():
    for width, height, name in SIZES:
        render(width, height).save(OUT / f"{name}.png", optimize=True)
        print(f"  ✓ public/splash/{name}.png ({width}×{height})")


if __name__ == "__main__":
    main()
