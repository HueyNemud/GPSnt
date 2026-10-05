// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Map frame: coordinates in image pixels, origin at the top-left corner, y pointing down.
 *
 * A magnetic heading h (rad, clockwise from magnetic north) becomes a direction in the image:
 *     θ = h + declination + mapNorth
 * where `declinationDeg` is the angle from true north to magnetic north (east positive, about
 * +1.5° in Paris in 2026) and `mapNorthDeg` the direction of true north on the map, measured
 * clockwise from the top of the image (0 for a north-up map).
 */

export interface MapFrame {
  pixelsPerMeter: number;
  mapNorthDeg: number;
  declinationDeg: number;
}

export const DEFAULT_MAP_FRAME: MapFrame = {
  pixelsPerMeter: 1,
  mapNorthDeg: 0,
  declinationDeg: 0,
};

const DEG = Math.PI / 180;

/** Direction in the image (rad, clockwise from the image top) of a magnetic heading */
export function imageAngle(frame: MapFrame, magneticHeading: number): number {
  return magneticHeading + (frame.declinationDeg + frame.mapNorthDeg) * DEG;
}

/** Displacement in pixels of a `length` metre step in image direction `theta` */
export function stepDelta(frame: MapFrame, length: number, theta: number): { dx: number; dy: number } {
  const d = length * frame.pixelsPerMeter;
  return { dx: d * Math.sin(theta), dy: -d * Math.cos(theta) };
}
