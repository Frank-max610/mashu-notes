#!/usr/bin/env python3
"""Generate 麻薯 app icons (SVG + PNG): the Mochi Node brand mark.

One warm dot + small associated nodes on thin orbits over a warm paper field.
Run with: npm run icons
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)
PAPER = (247, 243, 236, 255)
ACCENT = (200, 120, 63, 255)
DOTS = [(101, 120, 138, 255), (98, 122, 78, 255), (154, 113, 18, 255), (180, 93, 53, 255)]
INK = (44, 41, 37, 255)
FONT = ["/System/Library/Fonts/STHeiti Medium.ttc", 1]

def font(size):
    try: return ImageFont.truetype(FONT[0], size=size, index=FONT[1])
    except Exception: return ImageFont.load_default()

def draw_node(d, cx, cy, r):
    # orbits
    for rx, ry, rot in ((r*2.3, r*1.45, -24), (r*1.55, r*2.25, 32)):
        layer = Image.new("RGBA", (int(rx*2.6), int(ry*2.6)), (0,0,0,0))
        ld = ImageDraw.Draw(layer)
        ld.ellipse((layer.width/2-rx, layer.height/2-ry, layer.width/2+rx, layer.height/2+ry), outline=(117,109,99,110), width=max(1,int(r*0.12)))
        layer = layer.rotate(rot, resample=Image.BICUBIC, expand=False)
        d._image.paste(layer, (int(cx-layer.width/2), int(cy-layer.height/2)), layer)
    d.ellipse((cx-r, cy-r, cx+r, cy+r), fill=ACCENT)
    d.ellipse((cx-r*0.68, cy-r*0.68, cx-r*0.1, cy-r*0.1), fill=(255,255,255,70))
    for (dx, dy, rr, color) in ((r*1.9, -r*0.9, r*0.34, DOTS[0]), (-r*1.7, r*1.15, r*0.3, DOTS[1]), (r*1.5, r*1.6, r*0.26, DOTS[2]), (-r*1.6, -r*0.8, r*0.2, DOTS[3])):
        d.ellipse((cx+dx-rr, cy+dy-rr, cx+dx+rr, cy+dy+rr), fill=color)

def render(size, maskable=False):
    work = max(size*4, 1024)
    img = Image.new("RGBA", (work, work), PAPER)
    d = ImageDraw.Draw(img)
    d._image = img
    if not maskable:
        m = work*0.055
        d.rounded_rectangle((m, m, work-m, work-m), radius=int(work*0.16), outline=(229,219,207,255), width=max(1,int(work*0.004)))
    draw_node(d, work*0.5, work*0.5, work*(0.105 if maskable else 0.12))
    mask = Image.new("L", (work, work), 0)
    radius = 0 if maskable else int(work*0.22)
    ImageDraw.Draw(mask).rounded_rectangle((0,0,work-1,work-1), radius=radius, fill=255)
    out = Image.new("RGBA", (work, work), (0,0,0,0))
    out.paste(img, (0,0), mask)
    return out.resize((size,size), Image.LANCZOS)

SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="麻薯">
  <rect width="64" height="64" rx="15" fill="#f7f3ec"/>
  <rect x="3.5" y="3.5" width="57" height="57" rx="12" fill="none" stroke="#e5dbcf" stroke-width="0.6"/>
  <g fill="none" stroke="#756d63" stroke-opacity=".42" stroke-width="0.7">
    <ellipse cx="32" cy="32" rx="16" ry="10" transform="rotate(-24 32 32)"/>
    <ellipse cx="32" cy="32" rx="10.5" ry="15.5" transform="rotate(32 32 32)"/>
  </g>
  <circle cx="32" cy="32" r="6.6" fill="#c8783f"/>
  <circle cx="43.5" cy="26" r="2.4" fill="#65788a"/>
  <circle cx="21" cy="39" r="2.1" fill="#627a4e"/>
  <circle cx="41.5" cy="43" r="1.9" fill="#9a7112"/>
  <circle cx="20.5" cy="25" r="1.4" fill="#b45d35"/>
</svg>
"""

def main():
    (OUT/"icon.svg").write_text(SVG, encoding="utf-8")
    for size in (180,192,512):
        render(size).save(OUT/f"icon-{size}.png")
    render(512, maskable=True).save(OUT/"icon-maskable-512.png")
    render(32).save(OUT.parent/"favicon.ico", sizes=[(32,32)])
    print("icons written")

if __name__ == "__main__": main()
