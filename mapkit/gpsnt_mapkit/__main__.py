# SPDX-License-Identifier: AGPL-3.0-or-later
"""
GPS'nt map kit.

  python -m gpsnt_mapkit build MAP_FOLDER [--out app/map-pack] [--force]
  python -m gpsnt_mapkit preview MAP_FOLDER --out preview.png [--crop x,y,w,h] [--scale 0.2]

`build` turns a map folder (image + map.config.json, see docs/map-packs.md) into the map pack
embedded by the app. `preview` only computes the wall mask and writes a control image (walkable
areas in green), to tune the colour rules quickly.
"""

from __future__ import annotations

import argparse
import sys

import numpy as np
from PIL import Image

from . import __version__, pack, walls
from .config import ConfigError, load


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="gpsnt-mapkit", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--version", action="version", version=__version__)
    sub = p.add_subparsers(dest="command", required=True)

    b = sub.add_parser("build", help="build a map pack")
    b.add_argument("map", help="map folder containing map.config.json")
    b.add_argument("--out", default="app/map-pack", help="output folder (default: app/map-pack)")
    b.add_argument("--force", action="store_true", help="rebuild even if the pack is up to date")

    v = sub.add_parser("preview", help="write a wall mask control image")
    v.add_argument("map", help="map folder containing map.config.json")
    v.add_argument("--out", required=True, help="PNG to write")
    v.add_argument("--crop", help="x,y,width,height of the area to show (map pixels)")
    v.add_argument("--scale", type=float, default=1.0, help="resize factor of the output image")

    args = p.parse_args(argv)
    try:
        cfg = load(args.map)
    except ConfigError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1

    if args.command == "build":
        pack.build(cfg, args.out, force=args.force)
    else:
        rgb = np.asarray(Image.open(cfg.path(cfg.image)).convert("RGB"))
        mask = pack.compute_walls(cfg, rgb)
        crop = tuple(int(c) for c in args.crop.split(",")) if args.crop else None
        walls.preview(rgb, mask, crop, args.scale).save(args.out)
        print(f"{args.out}: {mask.mean() * 100:.1f} % walls", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
