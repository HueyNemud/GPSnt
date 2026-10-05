# SPDX-License-Identifier: AGPL-3.0-or-later
"""
Map tiling for display (Leaflet, see app/components/MapView.tsx).

A large map (100 Mpx and more) cannot be shown in one piece inside a WebView: it is cut into
256 px WebP tiles over several zoom levels and the app only loads the visible ones. Two colour
themes are produced from the single source image:

  dark   dark background (the source itself if it is dark, else its lightness-inverted version)
  light  light background (likewise)

plus a transparent "walls" layer showing the walkable areas of the wall mask in green, which can
be drawn on top of either theme.

Layout: <out>/<layer>/<z>/<x>/<y>.webp with z = 0 (whole map in one tile) up to max_zoom (full
resolution). Edge tiles are padded with the layer's background colour.
"""

from __future__ import annotations

import math
import os
from concurrent.futures import ProcessPoolExecutor

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

TILE = 256
QUALITY = 80
BACKGROUND = {"dark": (0, 0, 0), "light": (255, 255, 255), "walls": (0, 0, 0, 0)}
WALKABLE_RGBA = (0, 230, 110, 120)


def clean_dark(a: np.ndarray) -> np.ndarray:
    """Uniform black background: JPEG noise in the background is expensive to compress."""
    a = a.copy()
    a[a.max(axis=-1) <= 12] = 0
    return a


def invert_lightness(a: np.ndarray) -> np.ndarray:
    """Swap light and dark while keeping hue and saturation (HSL lightness L → 1 − L)."""
    a = a.astype(np.float32)
    return 255 - a.max(-1, keepdims=True) - a.min(-1, keepdims=True) + a


def dark_to_light(a: np.ndarray) -> np.ndarray:
    out = invert_lightness(a)
    # Yellow, cyan… would become unreadable on white: darken bright saturated colours
    mx, mn = a.max(-1, keepdims=True).astype(np.float32), a.min(-1, keepdims=True).astype(np.float32)
    lum = (0.299 * out[..., 0] + 0.587 * out[..., 1] + 0.114 * out[..., 2])[..., None]
    sat = (mx - mn) / 255
    k = np.where(lum > 150, 1 - (1 - 150 / np.maximum(lum, 1)) * np.clip(sat * 2, 0, 1), 1)
    return np.clip(out * k, 0, 255).astype(np.uint8)


def light_to_dark(a: np.ndarray) -> np.ndarray:
    return clean_dark(np.clip(invert_lightness(a), 0, 255).astype(np.uint8))


def themes(src: np.ndarray, source_theme: str) -> dict[str, np.ndarray]:
    if source_theme == "dark":
        return {"dark": clean_dark(src), "light": dark_to_light(src)}
    return {"dark": light_to_dark(src), "light": src}


def walls_overlay(walls: np.ndarray) -> Image.Image:
    rgba = np.zeros(walls.shape + (4,), dtype=np.uint8)
    rgba[~walls] = WALKABLE_RGBA
    return Image.fromarray(rgba, "RGBA")


def max_zoom_for(width: int, height: int) -> int:
    return max(0, math.ceil(math.log2(max(width, height) / TILE)))


def _write_level(job: tuple[str, int, str, str]) -> int:
    layer, z, level_path, out_dir = job
    img = Image.open(level_path)
    w, h = img.size
    count = 0
    for x in range(math.ceil(w / TILE)):
        d = os.path.join(out_dir, layer, str(z), str(x))
        os.makedirs(d, exist_ok=True)
        for y in range(math.ceil(h / TILE)):
            box = (x * TILE, y * TILE, min(w, (x + 1) * TILE), min(h, (y + 1) * TILE))
            tile = img.crop(box)
            if tile.size != (TILE, TILE):
                padded = Image.new(img.mode, (TILE, TILE), BACKGROUND[layer])
                padded.paste(tile)
                tile = padded
            tile.save(os.path.join(d, f"{y}.webp"), "WEBP", quality=QUALITY, method=6)
            count += 1
    return count


def build_tiles(src: np.ndarray, source_theme: str, walls: np.ndarray, out_dir: str) -> tuple[int, int]:
    """Write all tile layers into `out_dir`. Returns (max_zoom, tile count)."""
    h, w = src.shape[:2]
    max_zoom = max_zoom_for(w, h)
    tmp = os.path.join(out_dir, ".levels")
    os.makedirs(tmp, exist_ok=True)

    layers = {name: Image.fromarray(a) for name, a in themes(src, source_theme).items()}
    layers["walls"] = walls_overlay(walls)

    jobs = []
    for name, full in layers.items():
        for z in range(max_zoom, -1, -1):
            f = 2 ** (max_zoom - z)
            level = full if f == 1 else full.resize((math.ceil(w / f), math.ceil(h / f)), Image.LANCZOS)
            path = os.path.join(tmp, f"{name}-{z}.png")
            level.save(path, compress_level=1)
            jobs.append((name, z, path, out_dir))
    del layers

    with ProcessPoolExecutor() as pool:
        total = sum(pool.map(_write_level, jobs))
    for _, _, path, _ in jobs:
        os.remove(path)
    os.rmdir(tmp)
    return max_zoom, total
