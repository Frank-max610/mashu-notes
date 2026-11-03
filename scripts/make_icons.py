#!/usr/bin/env python3
"""Generate Inkstone app icons (SVG + PNG) without external dependencies.

The mark: a dark ink slab with a violet pebble and the character 砚 (inkstone).
Run with: npm run icons
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

BG = (14, 14, 18, 255)
VIOLET = (167, 139, 250, 255)
VIOLET_DEEP = (109, 40, 217, 255)
WHITE = (255, 255, 255, 255)

FONT_CANDIDATES = [
    ("/System/Library/Fonts/PingFang.ttc", 2),
    ("/System/Library/Fonts/PingFang.ttc", 0),
    ("/System/Library/Fonts/Hiragino Sans GB.ttc", 0),
    ("/System/Library/Fonts/STHeiti Medium.ttc", 0),
    ("/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc", 0),
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 0),
]


def load_font(size):
    for path, index in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size=size, index=index)
            except Exception:
                continue
    return None


def rounded_rect_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def draw_glyph(draw, size, scale=1.0):
    """Fallback mark when no CJK font is available: stylised pebble + brush."""
    cx, cy = size / 2, size / 2
    r = size * 0.21 * scale
    draw.ellipse((cx - r, cy - r * 0.88, cx + r, cy + r * 0.92), fill=VIOLET)
    draw.ellipse(
        (cx - r * 0.55, cy - r * 0.6, cx + r * 0.1, cy - r * 0.15),
        fill=(255, 255, 255, 78),
    )
    stroke = size * 0.028 * scale
    draw.rounded_rectangle(
        (cx - r * 0.62, cy + r * 0.55, cx + r * 0.95, cy + r * 0.55 + stroke),
        radius=stroke / 2,
        fill=(255, 255, 255, 160),
    )


def render_icon(size, maskable=False):
    scale = 2 if size < 200 else 1
    big = size * scale
    image = Image.new("RGBA", (big, big), BG)
    draw = ImageDraw.Draw(image)

    # Soft radial glow behind the pebble.
    glow = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    radius = big * 0.46
    for step in range(24, 0, -1):
        alpha = int(3.2 * step)
        r = radius * (0.55 + 0.02 * step)
        glow_draw.ellipse(
            (big / 2 - r, big / 2 - r, big / 2 + r, big / 2 + r),
            fill=(124, 58, 237, min(alpha, 90)),
        )
    image = Image.alpha_composite(image, glow)
    draw = ImageDraw.Draw(image)

    # The pebble: a slightly irregular violet stone.
    stone_w = big * 0.46
    stone_h = big * 0.54
    cx, cy = big / 2, big / 2
    draw.ellipse(
        (cx - stone_w / 2, cy - stone_h / 2, cx + stone_w / 2, cy + stone_h / 2),
        fill=VIOLET_DEEP,
    )
    draw.ellipse(
        (
            cx - stone_w * 0.42,
            cy - stone_h * 0.44,
            cx + stone_w * 0.3,
            cy - stone_h * 0.04,
        ),
        fill=(196, 181, 253, 160),
    )
    draw.ellipse(
        (cx - stone_w * 0.34, cy - stone_h * 0.2, cx + stone_w * 0.34, cy + stone_h * 0.42),
        fill=(139, 92, 246, 120),
    )

    font_size = int(big * (0.3 if maskable else 0.34))
    font = load_font(font_size)
    if font is not None:
        text = "砚"
        bbox = draw.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text(
            (cx - tw / 2 - bbox[0], cy - th / 2 - bbox[1]),
            text,
            font=font,
            fill=WHITE,
        )
    else:
        draw_glyph(draw, big, scale=1.15 if maskable else 1.0)

    if not maskable:
        mask = rounded_rect_mask(big, int(big * 0.225))
        rounded = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        rounded.paste(image, (0, 0), mask)
        image = rounded

    if scale != 1:
        image = image.resize((size, size), Image.LANCZOS)
    return image


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Inkstone 砚">
  <defs>
    <radialGradient id="glow" cx="50%" cy="44%" r="52%">
      <stop offset="0%" stop-color="#8b5cf6" stop-opacity=".85"/>
      <stop offset="100%" stop-color="#6d28d9" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="stone" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#c4b5fd"/>
      <stop offset="55%" stop-color="#8b5cf6"/>
      <stop offset="100%" stop-color="#6d28d9"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="#0e0e12"/>
  <circle cx="256" cy="248" r="196" fill="url(#glow)"/>
  <ellipse cx="256" cy="256" rx="118" ry="138" fill="url(#stone)"/>
  <ellipse cx="232" cy="196" rx="52" ry="34" fill="#ffffff" opacity=".25"/>
  <text x="256" y="300" text-anchor="middle" font-family="-apple-system, 'PingFang SC', 'Noto Sans CJK SC', sans-serif" font-size="168" font-weight="700" fill="#ffffff">砚</text>
</svg>
"""


def main():
    (OUT / "icon.svg").write_text(SVG, encoding="utf-8")
    for size in (180, 192, 512):
        render_icon(size).save(OUT / f"icon-{size}.png")
    render_icon(512, maskable=True).save(OUT / "icon-maskable-512.png")
    print(f"icons written to {OUT}")


if __name__ == "__main__":
    main()
