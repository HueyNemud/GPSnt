# SPDX-License-Identifier: AGPL-3.0-or-later
"""
Map pack: everything the app embeds about one map.

    <pack>/map.json     metadata read by the app (size, zoom levels, default calibration)
    <pack>/walls.bin    wall mask (see walls.py)
    <pack>/tiles/       display tiles (see tiles.py)
    <pack>/.stamp       fingerprint of the sources, to skip rebuilding an up-to-date pack
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image

from . import __version__, tiles, walls
from .config import MapConfig

PACK_FORMAT = 1


def fingerprint(cfg: MapConfig) -> str:
    h = hashlib.sha256(f"gpsnt-mapkit {__version__} format {PACK_FORMAT}\n".encode())
    for f in cfg.inputs:
        st = os.stat(f)
        h.update(f"{os.path.abspath(f)} {st.st_size} {st.st_mtime_ns}\n".encode())
    return h.hexdigest()


def is_up_to_date(cfg: MapConfig, out: str) -> bool:
    try:
        with open(os.path.join(out, ".stamp")) as f:
            return f.read().strip() == fingerprint(cfg)
    except FileNotFoundError:
        return False


def compute_walls(cfg: MapConfig, rgb: np.ndarray) -> np.ndarray:
    if cfg.walls.mode == "colors":
        return walls.walls_from_colors(rgb, cfg.walls.walkable, cfg.walls.min_size, cfg.walls.margin)
    gray = np.asarray(Image.open(cfg.path(cfg.walls.image)).convert("L"))
    if gray.shape != rgb.shape[:2]:
        raise SystemExit(
            f"{cfg.walls.image}: {gray.shape[1]}x{gray.shape[0]} px, the map is {rgb.shape[1]}x{rgb.shape[0]} px"
        )
    return walls.walls_from_image(gray)


def _safe_to_replace(path: str) -> bool:
    """Only ever delete a folder that is empty or already looks like a map pack."""
    if not os.path.exists(path):
        return True
    return os.path.isdir(path) and (not os.listdir(path) or os.path.exists(os.path.join(path, "map.json")))


def build(cfg: MapConfig, out: str, force: bool = False, log=lambda m: print(m, file=sys.stderr)) -> bool:
    """Build the pack for `cfg` into `out`. Returns False if it was already up to date."""
    if not force and is_up_to_date(cfg, out):
        log(f"{out}: up to date ({cfg.id})")
        return False
    if not _safe_to_replace(out):
        raise SystemExit(f"{out} exists and is not a map pack: refusing to overwrite it")

    tmp = out.rstrip("/") + ".tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)

    log(f"{cfg.id}: reading {cfg.image}")
    rgb = np.asarray(Image.open(cfg.path(cfg.image)).convert("RGB"))
    h, w = rgb.shape[:2]

    log(f"{cfg.id}: wall mask ({cfg.walls.mode})")
    mask = compute_walls(cfg, rgb)
    data = walls.encode(mask)
    with open(os.path.join(tmp, "walls.bin"), "wb") as f:
        f.write(data)
    log(f"  {mask.mean() * 100:.1f} % walls, {len(data) / 1e6:.2f} MB")

    log(f"{cfg.id}: tiles")
    max_zoom, count = tiles.build_tiles(rgb, cfg.theme, mask, os.path.join(tmp, "tiles"))
    del rgb, mask

    meta = {
        "format": PACK_FORMAT,
        "id": cfg.id,
        "name": cfg.name,
        "attribution": cfg.attribution,
        "width": w,
        "height": h,
        "tileSize": tiles.TILE,
        "maxZoom": max_zoom,
        "pixelsPerMeter": cfg.pixels_per_meter,
        "northDeg": cfg.north_deg,
        "declinationDeg": cfg.declination_deg,
    }
    with open(os.path.join(tmp, "map.json"), "w") as f:
        json.dump(meta, f, indent=2)
        f.write("\n")
    with open(os.path.join(tmp, ".stamp"), "w") as f:
        f.write(fingerprint(cfg) + "\n")

    shutil.rmtree(out, ignore_errors=True)
    os.replace(tmp, out)
    size = sum(os.path.getsize(os.path.join(r, n)) for r, _, ns in os.walk(out) for n in ns)
    log(f"{out}: {w}x{h} px, zoom 0-{max_zoom}, {count} tiles, {size / 1e6:.1f} MB")
    return True
