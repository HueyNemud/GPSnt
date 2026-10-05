# SPDX-License-Identifier: AGPL-3.0-or-later
"""
Map source configuration: ``map.config.json`` inside a map folder. See docs/map-packs.md.

    {
      "id": "demo-2026",                 change it whenever the map changes: the app then
                                         drops the calibration saved for the previous map
      "name": "Demo network",
      "attribution": "© …, licence …",
      "image": "demo.png",
      "theme": "dark",                   background of the source image: "dark" or "light"
      "pixelsPerMeter": 4.0,             map scale
      "northDeg": 0,                     direction of true north, clockwise from the image top
      "declinationDeg": 0,               magnetic declination at the map location, east positive
      "walls": {
        "mode": "colors",
        "walkable": [{"name": "corridors", "all": ["b > 170", "r < 100", "g < 140"]}],
        "minSize": 40,
        "margin": 2
      }
    }

or, for a hand-drawn wall mask, ``"walls": {"mode": "image", "image": "walls.png"}``.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field

from .walls import ColorRule


class ConfigError(ValueError):
    pass


@dataclass
class WallsConfig:
    mode: str
    walkable: list[ColorRule] = field(default_factory=list)
    min_size: int = 40
    margin: int = 2
    image: str | None = None


@dataclass
class MapConfig:
    folder: str
    id: str
    name: str
    image: str
    theme: str
    pixels_per_meter: float
    north_deg: float
    declination_deg: float
    walls: WallsConfig
    attribution: str = ""

    def path(self, name: str) -> str:
        return os.path.join(self.folder, name)

    @property
    def inputs(self) -> list[str]:
        """Source files the pack depends on."""
        files = [self.path("map.config.json"), self.path(self.image)]
        if self.walls.image:
            files.append(self.path(self.walls.image))
        return files


def _require(d: dict, key: str, kind: type | tuple[type, ...], where: str = ""):
    if key not in d:
        raise ConfigError(f"missing {where}{key!r}")
    value = d[key]
    if not isinstance(value, kind) or isinstance(value, bool):
        raise ConfigError(f"{where}{key!r} has the wrong type")
    return value


def load(folder: str) -> MapConfig:
    path = os.path.join(folder, "map.config.json")
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    except FileNotFoundError:
        raise ConfigError(f"{path} not found") from None
    except json.JSONDecodeError as e:
        raise ConfigError(f"{path}: {e}") from None

    map_id = _require(raw, "id", str)
    if not re.fullmatch(r"[A-Za-z0-9._-]+", map_id):
        raise ConfigError("'id' may only contain letters, digits, '.', '_' and '-'")
    theme = raw.get("theme", "dark")
    if theme not in ("dark", "light"):
        raise ConfigError("'theme' must be 'dark' or 'light'")
    ppm = float(_require(raw, "pixelsPerMeter", (int, float)))
    if not ppm > 0:
        raise ConfigError("'pixelsPerMeter' must be positive")

    w = _require(raw, "walls", dict)
    mode = _require(w, "mode", str, "walls.")
    if mode == "colors":
        rules = []
        for i, rule in enumerate(_require(w, "walkable", list, "walls.")):
            conds = _require(rule, "all", list, f"walls.walkable[{i}].")
            if not conds or not all(isinstance(c, str) for c in conds):
                raise ConfigError(f"walls.walkable[{i}].all must be a non-empty list of conditions")
            rules.append(ColorRule(name=rule.get("name", f"rule {i}"), all=conds))
        if not rules:
            raise ConfigError("walls.walkable must contain at least one colour rule")
        walls = WallsConfig(mode, walkable=rules, min_size=int(w.get("minSize", 40)), margin=int(w.get("margin", 2)))
    elif mode == "image":
        walls = WallsConfig(mode, image=_require(w, "image", str, "walls."))
    else:
        raise ConfigError("walls.mode must be 'colors' or 'image'")

    cfg = MapConfig(
        folder=folder,
        id=map_id,
        name=raw.get("name", map_id),
        image=_require(raw, "image", str),
        theme=theme,
        pixels_per_meter=ppm,
        north_deg=float(raw.get("northDeg", 0)),
        declination_deg=float(raw.get("declinationDeg", 0)),
        walls=walls,
        attribution=raw.get("attribution", ""),
    )
    for f in cfg.inputs:
        if not os.path.isfile(f):
            raise ConfigError(f"{f} not found")
    return cfg
