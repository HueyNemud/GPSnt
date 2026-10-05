# SPDX-License-Identifier: AGPL-3.0-or-later
import json
import os

import numpy as np
import pytest
from PIL import Image

from gpsnt_mapkit import config, pack, walls


def test_wall_mask_roundtrip():
    rng = np.random.default_rng(1)
    mask = rng.random((37, 53)) < 0.3
    mask[0, 0] = True  # first run is a wall: encoded as an empty free run
    assert np.array_equal(walls.decode(walls.encode(mask)), mask)


def test_wall_mask_format_matches_app_test():
    # Same 4x2 example as app/lib/nav/nav.test.ts: row 0 = ..##, row 1 = #...
    mask = np.array([[0, 0, 1, 1], [1, 0, 0, 0]], dtype=bool)
    assert walls.encode(mask) == b"GWM1" + bytes([4, 0, 0, 0, 2, 0, 0, 0, 2, 3, 3])


def test_long_runs_use_varints():
    mask = np.zeros((1, 300), dtype=bool)
    assert walls.encode(mask)[12:] == bytes([300 & 0x7F | 0x80, 300 >> 7])


def test_color_rules():
    rgb = np.array([[[40, 110, 255], [95, 105, 100], [255, 255, 255]]], dtype=np.uint8)
    rules = [walls.ColorRule("blue", ["b > 200", "r < 80", "abs(g - b) > 50"])]
    assert walls.color_pixels(rgb, rules).tolist() == [[True, False, False]]


def test_color_rule_must_be_a_comparison():
    rgb = np.zeros((2, 2, 3), dtype=np.uint8)
    with pytest.raises(ValueError):
        walls.color_pixels(rgb, [walls.ColorRule("bad", ["r + 1"])])


def test_small_blobs_are_walls():
    rgb = np.zeros((100, 100, 3), dtype=np.uint8)
    rgb[50, 5:95] = (0, 0, 255)  # long corridor
    rgb[10:13, 10:13] = (0, 0, 255)  # speck (a letter, a symbol)
    mask = walls.walls_from_colors(rgb, [walls.ColorRule("blue", ["b > 200"])], min_size=40, margin=1)
    assert not mask[50, 50] and not mask[49, 50]
    assert mask[11, 11]


def _map_folder(tmp_path, cfg):
    img = np.zeros((300, 500, 3), dtype=np.uint8)
    img[150, 20:480] = (40, 110, 255)
    Image.fromarray(img).save(tmp_path / "map.png")
    (tmp_path / "map.config.json").write_text(json.dumps(cfg))
    return str(tmp_path)


BASE = {
    "id": "test-1",
    "image": "map.png",
    "pixelsPerMeter": 2,
    "walls": {"mode": "colors", "walkable": [{"all": ["b > 200"]}]},
}


def test_config_errors(tmp_path):
    folder = _map_folder(tmp_path, {**BASE, "id": "bad id"})
    with pytest.raises(config.ConfigError, match="id"):
        config.load(folder)
    (tmp_path / "map.config.json").write_text(json.dumps({**BASE, "walls": {"mode": "image", "image": "nope.png"}}))
    with pytest.raises(config.ConfigError, match="nope.png"):
        config.load(folder)


def test_build_pack(tmp_path):
    (tmp_path / "src").mkdir()
    folder = _map_folder(tmp_path / "src", BASE)
    out = str(tmp_path / "pack")
    cfg = config.load(folder)
    assert pack.build(cfg, out, log=lambda m: None)
    meta = json.load(open(os.path.join(out, "map.json")))
    assert (meta["width"], meta["height"], meta["maxZoom"]) == (500, 300, 1)
    assert meta["pixelsPerMeter"] == 2
    for layer in ("dark", "light", "walls"):
        assert os.path.isfile(os.path.join(out, "tiles", layer, "0", "0", "0.webp"))
        assert os.path.isfile(os.path.join(out, "tiles", layer, "1", "1", "1.webp"))
    mask = walls.decode(open(os.path.join(out, "walls.bin"), "rb").read())
    assert not mask[150, 250] and mask[50, 250]
    # Unchanged sources: nothing to do
    assert not pack.build(cfg, out, log=lambda m: None)


def test_refuses_to_overwrite_a_foreign_folder(tmp_path):
    (tmp_path / "src").mkdir()
    folder = _map_folder(tmp_path / "src", BASE)
    out = tmp_path / "precious"
    out.mkdir()
    (out / "thesis.tex").write_text("…")
    with pytest.raises(SystemExit):
        pack.build(config.load(folder), str(out), log=lambda m: None)
    assert (out / "thesis.tex").exists()
