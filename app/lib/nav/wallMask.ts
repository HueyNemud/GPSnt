// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Wall mask: one bit per pixel of the map image.
 *
 * Binary format produced by the map kit (mapkit/gpsnt_mapkit/walls.py):
 *   "GWM1" | width u32 LE | height u32 LE | run lengths as varints (LEB128)
 * Runs alternate free / wall, starting with a free run, row after row.
 */

export class WallMask {
  readonly width: number;
  readonly height: number;
  private bits: Uint8Array;

  constructor(width: number, height: number, bits?: Uint8Array) {
    this.width = width;
    this.height = height;
    this.bits = bits ?? new Uint8Array(Math.ceil((width * height) / 8));
  }

  static decode(data: Uint8Array): WallMask {
    if (data.length < 12 || String.fromCharCode(data[0], data[1], data[2], data[3]) !== 'GWM1') {
      throw new Error('Invalid wall mask (missing GWM1 header)');
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const width = view.getUint32(4, true);
    const height = view.getUint32(8, true);
    const mask = new WallMask(width, height);
    const total = width * height;
    let pos = 0;
    let wall = false;
    let i = 12;
    while (i < data.length && pos < total) {
      let run = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = data[i++];
        run += (byte & 0x7f) * 2 ** shift;
        shift += 7;
      } while (byte & 0x80);
      if (wall) mask.fillRun(pos, Math.min(run, total - pos));
      pos += run;
      wall = !wall;
    }
    return mask;
  }

  private fillRun(start: number, length: number) {
    for (let p = start; p < start + length; p++) this.bits[p >> 3] |= 1 << (p & 7);
  }

  set(x: number, y: number) {
    const p = y * this.width + x;
    this.bits[p >> 3] |= 1 << (p & 7);
  }

  isWall(x: number, y: number): boolean {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return true;
    const p = y * this.width + x;
    return (this.bits[p >> 3] & (1 << (p & 7))) !== 0;
  }

  /**
   * Does the segment p0 → p1 cross a wall? 4-connected pixel traversal (no diagonal leak through
   * a one-pixel wall). The starting pixel is ignored: a particle lying on a line (inaccurate map)
   * must be able to leave it.
   */
  segmentCrossesWall(x0: number, y0: number, x1: number, y1: number): boolean {
    let cx = Math.floor(x0);
    let cy = Math.floor(y0);
    const ex = Math.floor(x1);
    const ey = Math.floor(y1);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    // Grid traversal (Amanatides & Woo)
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tMaxX = dx !== 0 ? (dx > 0 ? cx + 1 - x0 : x0 - cx) * tDeltaX : Infinity;
    let tMaxY = dy !== 0 ? (dy > 0 ? cy + 1 - y0 : y0 - cy) * tDeltaY : Infinity;
    let guard = Math.abs(ex - cx) + Math.abs(ey - cy) + 2;
    while ((cx !== ex || cy !== ey) && guard-- > 0) {
      if (tMaxX < tMaxY) {
        cx += stepX;
        tMaxX += tDeltaX;
      } else {
        cy += stepY;
        tMaxY += tDeltaY;
      }
      if (this.isWall(cx, cy)) return true;
    }
    return false;
  }
}
