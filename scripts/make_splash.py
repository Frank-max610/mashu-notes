#!/usr/bin/env python3
"""Generate iOS Home Screen splash screens for 麻薯 (apple-touch-startup-image).

Dark canvas with an aurora glow, the gradient brand mark and the wordmark.
Run with: npm run splash
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

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

BG = (8, 9, 12)
CREAM = (255, 247, 242)
MUTED = (154, 161, 176)

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


def glow(image, center, radius, color):
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.ellipse(
        (center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius),
        fill=color,
    )
    from PIL import ImageFilter

    layer = layer.filter(ImageFilter.GaussianBlur(radius * 0.55))
    return Image.alpha_composite(image.convert("RGBA"), layer).convert("RGB")


def gradient_mark(size):
    mark = Image.new("RGB", (size, size))
    draw = ImageDraw.Draw(mark)
    stops = [(0.0, (255, 122, 23)), (0.55, (255, 77, 141)), (1.0, (139, 92, 246))]
    for y in range(size):
        for x in range(size):
            t = (x / size) * 0.5 + (y / size) * 0.5
            color = stops[-1][1]
            for i in range(len(stops) - 1):
                left, right = stops[i], stops[i + 1]
                if left[0] <= t <= right[0]:
                    local = (t - left[0]) / (right[0] - left[0] or 1)
                    color = tuple(round(left[1][k] + (right[1][k] - left[1][k]) * local) for k in range(3))
                    break
            mark.putpixel((x, y), color)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * 0.22), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(mark, (0, 0), mask)
    return out


def render(width, height):
    image = Image.new("RGB", (width, height), BG)
    vertical_gradient(image, BG, (13, 15, 20))
    image = glow(image, (width * 0.2, height * 0.12), width * 0.55, (255, 122, 23, 60))
    image = glow(image, (width * 0.9, height * 0.18), width * 0.55, (139, 92, 246, 70))
    image = glow(image, (width * 0.55, height * 0.95), width * 0.7, (160, 195, 236, 26))

    draw = ImageDraw.Draw(image)
    cx, cy = width / 2, height * 0.44
    mark_size = int(width * 0.3)
    mark = gradient_mark(mark_size)
    image.paste(mark, (int(cx - mark_size / 2), int(cy - mark_size / 2)), mark)
    draw = ImageDraw.Draw(image)

    title_font = load_font(int(width * 0.115))
    title = "麻薯"
    box = draw.textbbox((0, 0), title, font=title_font)
    title_y = cy + mark_size * 0.62
    draw.text((cx - (box[2] - box[0]) / 2 - box[0], title_y), title, font=title_font, fill=CREAM)

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
