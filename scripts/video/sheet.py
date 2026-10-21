"""Tile review stills into one contact sheet: sheet.py out.jpg a.jpg b.jpg ..."""
import sys
from PIL import Image, ImageDraw
files = sys.argv[2:]
ims = [Image.open(f) for f in files]
w, h = ims[0].size
cols = 2
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (w * cols, h * rows), "white")
d = ImageDraw.Draw(sheet)
for i, (f, im) in enumerate(zip(files, ims)):
    x, y = (i % cols) * w, (i // cols) * h
    sheet.paste(im, (x, y))
    d.rectangle([x, y, x + 150, y + 28], fill="black")
    d.text((x + 6, y + 6), f.split("/")[-1].split("\\")[-1], fill="yellow")
sheet.save(sys.argv[1], quality=85)
