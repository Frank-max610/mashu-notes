#!/usr/bin/env python3
"""Generate 麻薯 app icons (SVG + PNG) without external dependencies.

The mark: a strawberry-milk mochi dumpling with a tiny strawberry hat, on a
pastel rounded square. Run with: npm run icons
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

BACKGROUND_TOP = (255, 241, 245, 255)
BACKGROUND_BOTTOM = (255, 209, 224, 255)
BODY_LIGHT = (255, 246, 249, 255)
BODY_MID = (255, 224, 235, 255)
BODY_SHADE = (255, 199, 215, 255)
INK = (90, 59, 70, 255)
BLUSH = (255, 166, 188, 255)
BERRY = (232, 85, 123, 255)
BERRY_DARK = (206, 63, 102, 255)
LEAF = (127, 203, 154, 255)
HIGHLIGHT = (255, 255, 255, 235)


def vertical_gradient(size, top, bottom):
    image = Image.new("RGBA", (size, size))
    draw = ImageDraw.Draw(image)
    for y in range(size):
        ratio = y / max(size - 1, 1)
        color = tuple(round(top[i] + (bottom[i] - top[i]) * ratio) for i in range(4))
        draw.line([(0, y), (size, y)], fill=color)
    return image


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def draw_mochi(draw, size, scale=1.0):
    cx, cy = size / 2, size * 0.545
    body_w = size * 0.60 * scale
    body_h = size * 0.55 * scale

    # soft shadow puddle
    draw.ellipse(
        (cx - body_w * 0.46, cy + body_h * 0.46, cx + body_w * 0.46, cy + body_h * 0.56),
        fill=(232, 85, 123, 26),
    )

    # squishy body (round + slightly flat bottom)
    draw.ellipse(
        (cx - body_w / 2, cy - body_h / 2, cx + body_w / 2, cy + body_h / 2),
        fill=BODY_MID,
    )
    draw.ellipse(
        (cx - body_w / 2, cy - body_h * 0.02, cx + body_w / 2, cy + body_h / 2),
        fill=BODY_SHADE,
    )
    draw.ellipse(
        (cx - body_w * 0.42, cy - body_h * 0.40, cx + body_w * 0.42, cy + body_h * 0.30),
        fill=BODY_LIGHT,
    )

    # glossy highlight
    draw.ellipse(
        (cx - body_w * 0.30, cy - body_h * 0.36, cx - body_w * 0.02, cy - body_h * 0.10),
        fill=HIGHLIGHT,
    )

    # cheeks
    r = body_w * 0.095
    draw.ellipse((cx - body_w * 0.30 - r, cy + body_h * 0.02 - r * 0.6, cx - body_w * 0.30 + r, cy + body_h * 0.02 + r * 0.6), fill=BLUSH)
    draw.ellipse((cx + body_w * 0.30 - r, cy + body_h * 0.02 - r * 0.6, cx + body_w * 0.30 + r, cy + body_h * 0.02 + r * 0.6), fill=BLUSH)

    # eyes
    eye_r = body_w * 0.038
    for dx in (-body_w * 0.17, body_w * 0.17):
        draw.ellipse(
            (cx + dx - eye_r, cy - eye_r * 1.1, cx + dx + eye_r, cy + eye_r * 1.1),
            fill=INK,
        )
        draw.ellipse(
            (cx + dx - eye_r * 0.45, cy - eye_r * 0.85, cx + dx + eye_r * 0.1, cy - eye_r * 0.2),
            fill=HIGHLIGHT,
        )

    # little smile
    smile_w = body_w * 0.16
    draw.arc(
        (cx - smile_w / 2, cy + body_h * 0.04, cx + smile_w / 2, cy + body_h * 0.12),
        start=20,
        end=160,
        fill=INK,
        width=max(2, int(size * 0.011 * scale)),
    )

    # strawberry hat
    berry_cx, berry_cy = cx + body_w * 0.20, cy - body_h * 0.62
    berry_rx, berry_ry = body_w * 0.15, body_w * 0.17
    draw.polygon(
        [
            (berry_cx - berry_rx * 0.9, berry_cy + berry_ry * 0.55),
            (berry_cx + berry_rx * 0.9, berry_cy + berry_ry * 0.55),
            (berry_cx, berry_cy + berry_ry * 1.45),
        ],
        fill=BERRY_DARK,
    )
    draw.ellipse(
        (berry_cx - berry_rx, berry_cy - berry_ry, berry_cx + berry_rx, berry_cy + berry_ry * 0.9),
        fill=BERRY,
    )
    # seeds
    seed_r = max(1, int(berry_rx * 0.09))
    for sx, sy in ((-0.45, 0.05), (0.0, -0.25), (0.45, 0.1), (-0.2, 0.35), (0.25, 0.4)):
        px = berry_cx + berry_rx * sx
        py = berry_cy + berry_ry * sy
        draw.ellipse((px - seed_r, py - seed_r * 1.5, px + seed_r, py + seed_r * 1.5), fill=(255, 230, 238, 220))
    # leaf
    draw.polygon(
        [
            (berry_cx - berry_rx * 0.9, berry_cy - berry_ry * 0.72),
            (berry_cx, berry_cy - berry_ry * 1.35),
            (berry_cx + berry_rx * 0.9, berry_cy - berry_ry * 0.72),
        ],
        fill=LEAF,
    )


def render_icon(size, maskable=False):
    work = max(size * 2, 1024)
    image = vertical_gradient(work, BACKGROUND_TOP, BACKGROUND_BOTTOM)
    # soft glow behind the mochi
    glow = Image.new("RGBA", (work, work), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    for step in range(30, 0, -1):
        alpha = int(step * 1.8)
        radius = work * (0.30 + step * 0.008)
        cx, cy = work / 2, work * 0.56
        glow_draw.ellipse(
            (cx - radius, cy - radius * 0.86, cx + radius, cy + radius * 0.86),
            fill=(255, 255, 255, min(alpha, 90)),
        )
    image = Image.alpha_composite(image, glow)
    draw = ImageDraw.Draw(image)
    draw_mochi(draw, work, scale=1.0 if maskable else 1.02)

    if not maskable:
        mask = rounded_mask(work, int(work * 0.225))
        rounded = Image.new("RGBA", (work, work), (0, 0, 0, 0))
        rounded.paste(image, (0, 0), mask)
        image = rounded

    return image.resize((size, size), Image.LANCZOS)


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="麻薯">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fff1f5"/>
      <stop offset="100%" stop-color="#ffd1e0"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="52%" r="52%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity=".95"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="body" x1="30%" y1="10%" x2="70%" y2="100%">
      <stop offset="0%" stop-color="#fff6f9"/>
      <stop offset="62%" stop-color="#ffe0eb"/>
      <stop offset="100%" stop-color="#ffc7d7"/>
    </linearGradient>
    <linearGradient id="berry" x1="20%" y1="0%" x2="80%" y2="100%">
      <stop offset="0%" stop-color="#ff8fab"/>
      <stop offset="100%" stop-color="#e8557b"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <ellipse cx="256" cy="300" rx="230" ry="196" fill="url(#glow)"/>
  <ellipse cx="256" cy="292" rx="150" ry="132" fill="url(#body)"/>
  <ellipse cx="250" cy="266" rx="112" ry="70" fill="#fff6f9" opacity=".9"/>
  <ellipse cx="256" cy="310" rx="122" ry="86" fill="#ffc7d7" opacity=".35"/>
  <circle cx="196" cy="292" r="7" fill="#5a3b46"/>
  <circle cx="316" cy="292" r="7" fill="#5a3b46"/>
  <circle cx="198" cy="289" r="2.4" fill="#ffffff"/>
  <circle cx="318" cy="289" r="2.4" fill="#ffffff"/>
  <ellipse cx="176" cy="314" rx="20" ry="12" fill="#ffa6bc" opacity=".7"/>
  <ellipse cx="336" cy="314" rx="20" ry="12" fill="#ffa6bc" opacity=".7"/>
  <path d="M236 322c6 9 24 9 30 0" stroke="#5a3b46" stroke-width="6" stroke-linecap="round" fill="none"/>
  <path d="M330 196c-18-6-34-4-44 4 10 20 32 30 52 22 18-8 22-24 18-34-6 4-16 9-26 8Z" fill="#7fcb9a"/>
  <ellipse cx="348" cy="222" rx="30" ry="26" fill="url(#berry)"/>
  <path d="M348 248c-4 16-2 26 2 34 6-10 6-22 2-34Z" fill="#ce3f66"/>
  <circle cx="340" cy="216" r="2.6" fill="#ffe6ee"/>
  <circle cx="356" cy="220" r="2.2" fill="#ffe6ee"/>
  <circle cx="346" cy="232" r="2.2" fill="#ffe6ee"/>
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
