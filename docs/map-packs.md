# Using your own map

GPS'nt is built with one map embedded. That map comes from a **map folder**: an image plus a small
configuration file. The **map kit** (`mapkit/`, Python) turns the folder into a **map pack** (tiles
for display and a wall mask for tracking), and `build.sh` puts that pack inside the app.

```
maps/my-map/                 →  python -m gpsnt_mapkit build  →  app/map-pack/       →  ./build.sh  →  dist/gpsnt-….apk
├── map.config.json                                              ├── map.json
├── my-map.png                                                   ├── walls.bin
└── walls.png (optional)                                         └── tiles/
```

Only `maps/demo/` is versioned: any other folder under `maps/` stays on your computer (see
`.gitignore`). This matters if your map is not yours to share.

## 1. Prepare the image

Any PNG or JPEG works, whatever its size (maps of 100 megapixels are fine). It should be:

* **to scale and not distorted**: a scan or a photo taken at an angle must be straightened first;
* **one level**: GPS'nt works in 2-D; if your map shows several levels, pick one or merge them;
* **readable on screen**: it is displayed as is, in a dark and a light version.

## 2. Write `map.config.json`

```json
{
  "id": "my-map-2026-01",
  "name": "My map",
  "attribution": "© the map authors, licence…",
  "image": "my-map.png",
  "theme": "dark",
  "pixelsPerMeter": 2.6,
  "northDeg": 0,
  "declinationDeg": 1.5,
  "walls": {
    "mode": "colors",
    "walkable": [
      { "name": "corridors", "all": ["b > 170", "r < 100", "g < 100"] }
    ],
    "minSize": 40,
    "margin": 2
  }
}
```

| key | meaning |
|---|---|
| `id` | Identifier of this version of the map (letters, digits, `.`, `_`, `-`). **Change it whenever the image changes**: the app then drops the calibration saved for the previous map. |
| `name`, `attribution` | Shown in the app settings (*About*). Credit the map authors here. |
| `image` | Image file, relative to the folder. |
| `theme` | `dark` if the image has a dark background, `light` otherwise. The other theme is generated. |
| `pixelsPerMeter` | Map scale (see below). |
| `northDeg` | Direction of true north on the map, in degrees clockwise from the top of the image. `0` for a north-up map, `90` if north points to the right. |
| `declinationDeg` | Magnetic declination at the map location, east positive. |
| `walls` | How to find the walls: see section 3. |

The user can still adjust scale, north and declination in the app settings; these values are
the defaults.

### Measuring the scale

Find the scale bar on the map, measure its length in pixels in any image editor, and divide by
its length in metres. For instance, a 160 m bar 416 px long gives `416 / 160 = 2.6` px/m.
Without a scale bar, measure the pixel distance between two points whose real distance you know.

### Finding the declination

Use the [NOAA calculator](https://www.ngdc.noaa.gov/geomag/calculators/magcalc.shtml) for the
location and year. Positive values point east. It is about +1.5° in Paris in 2026. An error of a
few degrees is not serious: the app learns the remaining heading bias.

## 3. Tell GPS'nt where the walls are

The **wall mask** marks every pixel where nobody can be. It is what corrects the drift (see the
[technical report](technical-report.md#7-map-constraints)), so it is worth a little care. There
are two ways to get it.

### `colors`: walkable areas have their own colours

Most maps draw corridors, galleries or rooms in a few recognisable colours. List them as rules: a
pixel is walkable if it satisfies **all** the conditions of **at least one** rule. Conditions are
comparisons on the pixel's `r`, `g`, `b` values (0–255), with arithmetic and `abs()`:

```json
"walkable": [
  { "name": "upper level (blue)", "all": ["b > 170", "r < 100", "g < 100"] },
  { "name": "lower level (cyan)", "all": ["r < 130", "g > 170", "b > 170", "abs(g - b) < 45"] }
]
```

Then:

* `minSize` (pixels, default 40): walkable blobs smaller than this across are dropped. Text and
  symbols printed in the same colour as the corridors are removed this way.
* `margin` (pixels, default 2): the walkable areas are widened by this much, because neither the
  drawing nor the position estimate is exact to the pixel.

Everything that matches no rule is a wall, including passages drawn in other colours (closed,
flooded, private…).

> The conditions are Python expressions evaluated by the map kit on your computer. Only use
> configuration files you wrote or trust.

### `image`: you draw the walls

```json
"walls": { "mode": "image", "image": "walls.png" }
```

Draw a PNG with **exactly the same size and alignment** as the map: walls and rock in black,
everything else in white (any pixel darker than mid-grey is a wall). The easiest way is to add a
layer on top of the map in an image editor, paint the walls, and export that layer alone. Walls
must be continuous lines at least 2 px thick: a particle can slip through a gap.

### Check the result

```bash
PYTHONPATH=mapkit python3 -m gpsnt_mapkit preview maps/my-map --out preview.png --scale 0.2
PYTHONPATH=mapkit python3 -m gpsnt_mapkit preview maps/my-map --out zoom.png --crop 6700,2450,700,600
```

The preview shows the map dimmed, with walkable areas in green. Check that every corridor is
green and continuous, and that nothing else is. In the app, *Settings → Walkable areas* shows the
same overlay.

## 4. Build

```bash
./build.sh --map maps/my-map           # standalone APK in dist/
./build.sh --map maps/my-map --dev     # development APK (see development.md)
```

The map kit is only re-run when the folder has changed. To build the pack alone:

```bash
PYTHONPATH=mapkit python3 -m gpsnt_mapkit build maps/my-map --out app/map-pack
```

(or `pip install ./mapkit` once, then `gpsnt-mapkit build …`). It needs Python ≥ 3.10 with
`numpy`, `pillow` and `scipy`.

> **Changing the map requires a new APK, for both the release and the development builds**: the
> tiles are packaged as native Android assets, which the development server cannot reload.

## Licensing your map

GPS'nt itself is free software, but **the map is not covered by GPS'nt's licence**. Before you
share an APK, make sure you are allowed to redistribute the map it contains. The demo map
(`maps/demo/`) is public domain (CC0) and generated by `maps/demo/generate.py`.
