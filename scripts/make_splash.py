#!/usr/bin/env python3
"""Generate warm, calm iOS splash screens for 麻薯 (Mochi Node mark).

Run with: npm run splash
"""
from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "public" / "splash"
OUT.mkdir(parents=True, exist_ok=True)
SIZES = [(1290,2796,"iphone-15-pro-max"),(1284,2778,"iphone-14-plus"),(1179,2556,"iphone-15-pro"),(1170,2532,"iphone-6.1"),(1125,2436,"iphone-x"),(828,1792,"iphone-xr"),(750,1334,"iphone-se")]
TOP=(250,246,238); BOTTOM=(241,234,225); INK=(44,41,37); MUTED=(117,109,99); ACCENT=(200,120,63)
FONT=["/System/Library/Fonts/STHeiti Medium.ttc",1]

def font(size):
    try: return ImageFont.truetype(FONT[0], size=size, index=FONT[1])
    except Exception: return ImageFont.load_default()

def render(w,h):
    img=Image.new("RGB",(w,h),TOP); d=ImageDraw.Draw(img)
    for y in range(h):
        t=y/max(h-1,1); d.line([(0,y),(w,y)],fill=tuple(round(TOP[i]+(BOTTOM[i]-TOP[i])*t) for i in range(3)))
    # soft warm glow, very low contrast
    glow=Image.new("RGBA",(w,h),(0,0,0,0)); gd=ImageDraw.Draw(glow); r=int(w*0.55)
    gd.ellipse((w*0.5-r,h*0.42-r,w*0.5+r,h*0.42+r),fill=(255,236,213,90)); glow=glow.filter(ImageFilter.GaussianBlur(int(w*0.12)))
    img=Image.alpha_composite(img.convert("RGBA"),glow).convert("RGB"); d=ImageDraw.Draw(img)
    cx,cy=w/2,h*0.44; R=w*0.085
    for rx,ry,rot in ((R*2.3,R*1.45,-24),(R*1.55,R*2.25,32)):
        layer=Image.new("RGBA",(int(rx*2.6),int(ry*2.6)),(0,0,0,0)); ld=ImageDraw.Draw(layer)
        ld.ellipse((layer.width/2-rx,layer.height/2-ry,layer.width/2+rx,layer.height/2+ry),outline=(117,109,99,110),width=max(1,int(R*0.12)))
        layer=layer.rotate(rot,resample=Image.BICUBIC); img.paste(layer,(int(cx-layer.width/2),int(cy-layer.height/2)),layer)
    d.ellipse((cx-R,cy-R,cx+R,cy+R),fill=ACCENT); d.ellipse((cx-R*0.68,cy-R*0.68,cx-R*0.1,cy-R*0.1),fill=(255,255,255,70))
    for dx,dy,rr,color in ((R*1.9,-R*0.9,R*0.34,(101,120,138)),(-R*1.7,R*1.15,R*0.3,(98,122,78)),(R*1.5,R*1.6,R*0.26,(154,113,18)),(-R*1.6,-R*0.8,R*0.2,(180,93,53))):
        d.ellipse((cx+dx-rr,cy+dy-rr,cx+dx+rr,cy+dy+rr),fill=color)
    tf=font(int(w*0.1)); title="麻薯"; box=d.textbbox((0,0),title,font=tf); ty=cy+R*2.5
    d.text((cx-(box[2]-box[0])/2-box[0],ty),title,font=tf,fill=INK)
    sf=font(int(w*0.027)); sub="记录 · 连接 · 理解"; box2=d.textbbox((0,0),sub,font=sf)
    d.text((cx-(box2[2]-box2[0])/2-box2[0],ty+(box[3]-box[1])*1.3),sub,font=sf,fill=MUTED)
    return img

if __name__ == "__main__":
    for w,h,name in SIZES:
        render(w,h).save(OUT/f"{name}.png",optimize=True); print("✓",name)
