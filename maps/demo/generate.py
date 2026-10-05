#!/usr/bin/env python3
# SPDX-License-Identifier: CC0-1.0
"""
Generates demo.png, the fictional map shipped with GPS'nt so that the app can be built and tried
without any third-party map. Deterministic: running it again gives the same image.

Legend: blue = walkable corridors and rooms, grey = closed galleries (treated as walls).
Scale: 4 px per metre (the scale bar is 100 m), north is up.

    python3 maps/demo/generate.py
"""

import math
import os
import random

from PIL import Image, ImageDraw, ImageFont

W, H = 2400, 1800
PPM = 4
BACKGROUND = (10, 10, 12)
WALKABLE = (40, 110, 255)
CLOSED = (95, 105, 100)
INK = (225, 225, 225)
COLS, ROWS, SPACING, MARGIN = 8, 6, 290, 180

rng = random.Random(2026)
img = Image.new("RGB", (W, H), BACKGROUND)
draw = ImageDraw.Draw(img)


def font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


# Jittered grid of junctions
nodes = {
    (c, r): (MARGIN + c * SPACING + rng.randint(-60, 60), MARGIN + r * SPACING * 0.86 + rng.randint(-50, 50))
    for c in range(COLS)
    for r in range(ROWS)
}


def corridor(a, b, color, width):
    # A slight bend halfway, as real galleries rarely run straight
    (x0, y0), (x1, y1) = a, b
    mx, my = (x0 + x1) / 2 + rng.randint(-35, 35), (y0 + y1) / 2 + rng.randint(-35, 35)
    draw.line([(x0, y0), (mx, my), (x1, y1)], fill=color, width=width, joint="curve")


edges = []
for (c, r) in nodes:
    for dc, dr in ((1, 0), (0, 1)):
        if (c + dc, r + dr) in nodes and rng.random() < 0.82:
            edges.append(((c, r), (c + dc, r + dr)))

for a, b in edges:
    closed = rng.random() < 0.14
    corridor(nodes[a], nodes[b], CLOSED if closed else WALKABLE, 7 if closed else 9)

# Rooms at some junctions
for (c, r), (x, y) in nodes.items():
    if rng.random() < 0.18:
        w, h = rng.randint(40, 90), rng.randint(30, 70)
        draw.rectangle([x - w / 2, y - h / 2, x + w / 2, y + h / 2], fill=WALKABLE)
    else:
        draw.ellipse([x - 7, y - 7, x + 7, y + 7], fill=WALKABLE)

# Gallery names
names = ["Mole Street", "Well Gallery", "Square Alley", "North Passage", "Great Vault", "Dry Corridor"]
for name in names:
    a, b = edges[rng.randrange(len(edges))]
    (x0, y0), (x1, y1) = nodes[a], nodes[b]
    draw.text(((x0 + x1) / 2 + 14, (y0 + y1) / 2 - 26), name, fill=INK, font=font(18))

# Scale bar: 100 m
x0, y0 = W - 160 - 100 * PPM, H - 70
draw.line([(x0, y0), (x0 + 100 * PPM, y0)], fill=INK, width=4)
for k in range(0, 101, 25):
    draw.line([(x0 + k * PPM, y0 - 8), (x0 + k * PPM, y0 + 8)], fill=INK, width=3)
draw.text((x0 + 100 * PPM + 16, y0 - 14), "100 m", fill=INK, font=font(26))

# North arrow
nx, ny = W - 90, 110
draw.polygon([(nx, ny - 50), (nx - 18, ny + 20), (nx, ny + 6), (nx + 18, ny + 20)], fill=INK)
draw.text((nx - 9, ny + 28), "N", fill=INK, font=font(28))

# Title and legend
draw.text((50, 40), "GPS'nt demo network", fill=INK, font=font(40))
draw.text((50, 92), "Fictional map, public domain (CC0)", fill=(150, 150, 150), font=font(20))
draw.rectangle([50, H - 100, 80, H - 88], fill=WALKABLE)
draw.text((92, H - 106), "corridor", fill=INK, font=font(20))
draw.rectangle([50, H - 66, 80, H - 54], fill=CLOSED)
draw.text((92, H - 72), "closed gallery", fill=INK, font=font(20))

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "demo.png")
img.save(out, optimize=True)
print(f"{out}: {W}x{H} px, {W / PPM:.0f} x {H / PPM:.0f} m")
