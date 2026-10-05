# SPDX-License-Identifier: AGPL-3.0-or-later
"""
Wall mask: one bit per map pixel telling where a walker cannot be.

The particle filter (app/lib/nav/particleFilter.ts) heavily penalises any hypothesis whose last
step crosses a wall pixel. Two ways to obtain the mask:

  colors  the map draws walkable areas in recognisable colours (corridors, galleries, rooms).
          Pixels matching one of the configured colour rules are walkable; small blobs (text,
          symbols) are dropped; the result is widened by a tolerance margin. Everything else
          is a wall.
  image   a hand-drawn black-and-white PNG, same size and alignment as the map: walls in black,
          everything else in white (luminance < 128 = wall).

Binary format (decoded by app/lib/nav/wallMask.ts):

  b"GWM1" | width u32 LE | height u32 LE | run lengths as LEB128 varints

Runs alternate free / wall, starting with a free run, row after row.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

import numpy as np
from PIL import Image
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None

MAGIC = b"GWM1"


@dataclass
class ColorRule:
    """A walkable colour: every condition must hold, e.g. ``["b > 170", "abs(g - b) < 45"]``."""

    name: str
    all: list[str]


def _eval_condition(expr: str, r: np.ndarray, g: np.ndarray, b: np.ndarray) -> np.ndarray:
    # Conditions come from the map author's own config file. They are evaluated with numpy
    # arrays as r, g, b (0-255) and no builtins: arithmetic, comparisons and abs() only.
    result = eval(compile(expr, "<color rule>", "eval"), {"__builtins__": {}}, {"r": r, "g": g, "b": b, "abs": np.abs})
    result = np.asarray(result)
    if result.dtype != bool or result.shape != r.shape:
        raise ValueError(f"colour condition {expr!r} must compare pixel values (e.g. 'b > 170')")
    return result


def color_pixels(rgb: np.ndarray, rules: list[ColorRule]) -> np.ndarray:
    """Pixels matching at least one colour rule."""
    r, g, b = (rgb[..., i].astype(np.int16) for i in range(3))
    out = np.zeros(rgb.shape[:2], dtype=bool)
    for rule in rules:
        match = np.ones(rgb.shape[:2], dtype=bool)
        for cond in rule.all:
            match &= _eval_condition(cond, r, g, b)
        out |= match
    return out


def walls_from_colors(rgb: np.ndarray, rules: list[ColorRule], min_size: int = 40, margin: int = 2) -> np.ndarray:
    """Wall mask (True = wall) from a map whose walkable areas are drawn in known colours."""
    # Close small gaps first, so that a thin dashed line stays in one piece
    walkable = ndimage.binary_dilation(color_pixels(rgb, rules), iterations=2)
    # Drop small components (letters, pictograms): keep shapes at least `min_size` px across
    labels, count = ndimage.label(walkable, structure=np.ones((3, 3), dtype=bool))
    keep = np.zeros(count + 1, dtype=bool)
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        if sl is not None:
            keep[i] = max(sl[0].stop - sl[0].start, sl[1].stop - sl[1].start) >= min_size
    walkable = keep[labels]
    if margin > 0:
        # Tolerance: neither the map drawing nor the position estimate is exact to the pixel
        walkable = ndimage.binary_dilation(
            walkable, structure=ndimage.generate_binary_structure(2, 1), iterations=margin
        )
    return ~walkable


def walls_from_image(gray: np.ndarray) -> np.ndarray:
    """Wall mask from a black-and-white drawing: dark pixels are walls."""
    return gray < 128


def encode(walls: np.ndarray) -> bytes:
    h, w = walls.shape
    flat = walls.reshape(-1).astype(np.int8)
    # Indices where the value changes; the first run is "free" by convention
    changes = np.flatnonzero(np.diff(flat)) + 1
    bounds = np.concatenate(([0], changes, [flat.size]))
    runs = np.diff(bounds).tolist()
    if flat.size and flat[0] == 1:
        runs.insert(0, 0)
    out = bytearray(MAGIC)
    out += struct.pack("<II", w, h)
    for r in runs:
        while True:
            byte = r & 0x7F
            r >>= 7
            if r:
                out.append(byte | 0x80)
            else:
                out.append(byte)
                break
    return bytes(out)


def decode(data: bytes) -> np.ndarray:
    """Inverse of :func:`encode` (True = wall)."""
    if data[:4] != MAGIC:
        raise ValueError("invalid wall mask (missing GWM1 header)")
    w, h = (int(v) for v in np.frombuffer(data[4:12], dtype="<u4"))
    runs, run, shift = [], 0, 0
    for byte in data[12:]:
        run |= (byte & 0x7F) << shift
        shift += 7
        if not byte & 0x80:
            runs.append(run)
            run, shift = 0, 0
    values = np.arange(len(runs)) % 2 == 1  # alternating free / wall runs
    flat = np.repeat(values, runs)
    flat = np.concatenate([flat, np.zeros(max(0, w * h - flat.size), dtype=bool)])
    return flat[: w * h].reshape(h, w)


def preview(rgb: np.ndarray, walls: np.ndarray, crop: tuple[int, int, int, int] | None = None, scale: float = 1.0) -> Image.Image:
    """Control image: dimmed map with walkable areas in green."""
    out = (rgb * 0.45).astype(np.uint8)
    out[~walls] = (0, 220, 90)
    img = Image.fromarray(out)
    if crop:
        x, y, w, h = crop
        img = img.crop((x, y, x + w, y + h))
    if scale != 1:
        img = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)
    return img
