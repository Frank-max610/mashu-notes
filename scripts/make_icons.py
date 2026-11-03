#!/usr/bin/env python3
"""Generate 日新 app icons (SVG + PNG) without external dependencies.

The mark is a vermilion seal with the name 日新 in Songti, on paper. Run: npm run icons
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

PAPER = (244, 241, 234, 255)
VERMILION = (166, 61, 51, 255)
CREAM = (255, 248, 242, 255)

FONT_CANDIDATES = [
    ("/System/Library/Fonts/Supplemental/Songti.ttc", 0),
    ("/System/Library/Fonts/Supplemental/Songti.ttc", 1),
    ("/System/Library/Fonts/STHeiti Medium.ttc", 0),
]


def load_font(size):
    for path, index in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size=size, index=index)
            except Exception:
                continue
    return ImageFont.load_default()


def draw_seal(draw, size, x_offset=0):
    """Vermilion seal with cream 日新, centred at (size/2, size/2)."""
    seal_w = size * 0.58
    seal_x = (size - seal_w) / 2 + x_offset
    seal_y = (size - seal_w) / 2
    draw.rectangle((seal_x, seal_y, seal_x + seal_w, seal_y + seal_w), fill=VERMILION)
    # thin cream inner rule
    inset = seal_w * 0.075
    draw.rectangle(
        (seal_x + inset, seal_y + inset, seal_x + seal_w - inset, seal_y + seal_w - inset),
        outline=(255, 248, 242, 210),
        width=max(1, int(size * 0.006)),
    )
    font = load_font(int(seal_w * 0.46))
    text = "日新"
    box = draw.textbbox((0, 0), text, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    draw.text(
        (seal_x + (seal_w - tw) / 2 - box[0], seal_y + (seal_w - th) / 2 - box[1]),
        text,
        font=font,
        fill=CREAM,
    )


def render_icon(size, maskable=False):
    work = max(size * 4, 1024)
    image = Image.new("RGBA", (work, work), PAPER)
    draw = ImageDraw.Draw(image)
    if maskable:
        draw.rectangle((0, 0, work, work), fill=PAPER)
        draw_seal(draw, work)
    else:
        # paper field with a hairline ink frame; seal in the middle
        draw.rectangle((0, 0, work, work), fill=PAPER)
        margin = work * 0.055
        draw.rectangle(
            (margin, margin, work - margin, work - margin),
            outline=(22, 24, 28, 40),
            width=max(1, int(work * 0.004)),
        )
        draw_seal(draw, work)
    # rounded corners for the non-maskable icon (8% radius keeps it crisp, not bubbly)
    mask = Image.new("L", (work, work), 0)
    radius = 0 if maskable else int(work * 0.08)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, work - 1, work - 1), radius=radius, fill=255)
    rounded = Image.new("RGBA", (work, work), (0, 0, 0, 0))
    rounded.paste(image, (0, 0), mask)
    return rounded.resize((size, size), Image.LANCZOS)


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="日新">
  <rect width="512" height="512" rx="41" fill="#f4f1ea"/>
  <rect x="28" y="28" width="456" height="456" fill="none" stroke="#16181c" stroke-opacity=".16"/>
  <rect x="100" y="100" width="312" height="312" fill="#a63d33"/>
  <rect x="123" y="123" width="266" height="266" fill="none" stroke="#fff8f2" stroke-opacity=".82" stroke-width="3"/>
  <text x="256" y="301" text-anchor="middle" font-family="Songti SC, Noto Serif SC, STSong, serif" font-size="150" font-weight="600" fill="#fff8f2">日新</text>
</svg>
"""


def main():
    (OUT / "icon.svg").write_text(SVG, encoding="utf-8")
    # A classic favicon so browsers never 404 on /favicon.ico.
    render_icon(32).save(OUT.parent / "favicon.ico", sizes=[(32, 32)])
    for size in (180, 192, 512):
        render_icon(size).save(OUT / f"icon-{size}.png")
    render_icon(512, maskable=True).save(OUT / "icon-maskable-512.png")
    print(f"icons written to {OUT}")


if __name__ == "__main__":
    main()
