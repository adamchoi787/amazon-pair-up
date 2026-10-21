"""Generate the Alexa+ add-on listing images into public/addon/.

Alexa+ requires light icons at 72, 64, 88, 126, 180 and 241 px and at least one
600x900 carousel image, served over HTTPS. Re-run after design changes:

    python3 scripts/make-addon-assets.py      (needs Pillow)
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "public" / "addon"
BLUE = (10, 124, 255)
DEEP = (6, 72, 170)
WHITE = (255, 255, 255)
FONT = "C:/Windows/Fonts/segoeui.ttf" if Path("C:/Windows/Fonts/segoeui.ttf").exists() else "/System/Library/Fonts/Helvetica.ttc"


def font(size, bold=True):
    try:
        return ImageFont.truetype(FONT, size, index=1 if bold else 0)
    except OSError:
        return ImageFont.load_default(size)


def gradient(w, h):
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        t = y / max(h - 1, 1)
        row = tuple(round(BLUE[i] * (1 - t) + DEEP[i] * t) for i in range(3))
        for x in range(w):
            px[x, y] = row
    return img


def icon(size):
    s = 4 * size  # draw large, downsample for smooth edges
    img = gradient(s, s)
    d = ImageDraw.Draw(img)
    # Speech bubble
    pad = s * 0.18
    d.rounded_rectangle([pad, pad, s - pad, s - pad * 1.55], radius=s * 0.14, fill=WHITE)
    d.polygon([(s * 0.34, s - pad * 1.6), (s * 0.30, s * 0.86), (s * 0.50, s - pad * 1.6)], fill=WHITE)
    # Price tag mark inside the bubble
    f = font(int(s * 0.36))
    cx, cy = s / 2, (pad + s - pad * 1.55) / 2
    d.text((cx, cy), "$", font=f, fill=BLUE, anchor="mm")
    return img.resize((size, size), Image.LANCZOS)


def carousel():
    w, h = 600, 900
    img = gradient(w, h)
    d = ImageDraw.Draw(img)
    big = icon(180)
    mask = Image.new("L", big.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, 179, 179], radius=40, fill=255)
    img.paste(big, ((w - 180) // 2, 110), mask)
    d.rounded_rectangle([(w - 180) // 2, 110, (w + 180) // 2 - 1, 289], radius=40, outline=(255, 255, 255, 90), width=2)
    d.text((w / 2, 360), "PairUp", font=font(56), fill=WHITE, anchor="mm")
    d.text((w / 2, 410), "Buy and sell with other people, just by asking", font=font(22, False), fill=WHITE, anchor="mm")
    phrases = [
        "“Sell my TI-84 for $20.”",
        "“I need a graphing calculator,",
        "max $18.”",
        "“Got it for $18. Confirm?”",
    ]
    y = 520
    for i, line in enumerate(phrases):
        d.text((w / 2, y), line, font=font(28, i != 1 and i != 2), fill=WHITE, anchor="mm")
        y += 56 if i != 1 else 40
    d.text((w / 2, 830), "Your price limits stay private.", font=font(20, False), fill=WHITE, anchor="mm")
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (72, 64, 88, 126, 180, 241):
        icon(size).save(OUT / f"icon-{size}.png", optimize=True)
    carousel().save(OUT / "carousel-600x900.png", optimize=True)
    print(f"Wrote images to {OUT}")


if __name__ == "__main__":
    main()
