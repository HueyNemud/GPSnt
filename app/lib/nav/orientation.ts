// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Phone orientation → walking heading.
 *
 * Conventions (Android's):
 *  - device frame: x to the right of the screen, y to the top of the screen, z out of the screen;
 *  - world frame ENU: x East, y (magnetic) North, z Up;
 *  - the quaternion q = [w, x, y, z] maps device to world: v_world = q · v_device · q*.
 *
 * Heading: radians from North, clockwise (0 = North, π/2 = East).
 */

export type Quaternion = [number, number, number, number];
export type Vec3 = [number, number, number];

/** Rotates a vector from the device frame to the world frame. */
export function rotateToWorld(q: Quaternion, v: Vec3): Vec3 {
  const [w, x, y, z] = q;
  const [vx, vy, vz] = v;
  // Rotation matrix R (columns = device axes expressed in the world frame)
  return [
    (1 - 2 * (y * y + z * z)) * vx + 2 * (x * y - w * z) * vy + 2 * (x * z + w * y) * vz,
    2 * (x * y + w * z) * vx + (1 - 2 * (x * x + z * z)) * vy + 2 * (y * z - w * x) * vz,
    2 * (x * z - w * y) * vx + 2 * (y * z + w * x) * vy + (1 - 2 * (x * x + y * y)) * vz,
  ];
}

/**
 * Horizontal walking direction (East, North components) for a phone held in front of the user,
 * in portrait, screen facing them.
 *
 * - While the phone is not too upright, forward is the horizontal projection of the y axis (top
 *   of the screen): exact even when the wrist rolls (rotation about y).
 * - Close to vertical, that projection vanishes. The x axis (left → right of the screen) then
 *   stays horizontal and perpendicular to the walk: forward is Up × x.
 * The blend between both goes smoothly from ~70° to ~80° of tilt: no singularity and no jump,
 * unlike Euler angles.
 */
export function walkingDirection(q: Quaternion): { east: number; north: number; reliability: number } {
  const [yE, yN] = rotateToWorld(q, [0, 1, 0]);
  const [xE, xN] = rotateToWorld(q, [1, 0, 0]);
  const yH = Math.hypot(yE, yN); // = cos(tilt)
  // (0, 0, 1) × (xE, xN, xU) = (−xN, xE, 0)
  const aE = -xN;
  const aN = xE;
  const aH = Math.hypot(aE, aN);
  const wy = Math.min(1, Math.max(0, (yH - 0.17) / 0.17));
  let east = 0;
  let north = 0;
  if (wy > 0) {
    east += (wy * yE) / yH;
    north += (wy * yN) / yH;
  }
  if (wy < 1 && aH > 1e-9) {
    east += ((1 - wy) * aE) / aH;
    north += ((1 - wy) * aN) / aH;
  }
  // ~1 in portrait; → 0 when the phone is held upright in landscape (heading undefined)
  const reliability = Math.max(Math.min(1, yH / 0.17), aH);
  return { east, north, reliability };
}

export function walkingHeading(q: Quaternion): number {
  const { east, north } = walkingDirection(q);
  return Math.atan2(east, north);
}

/** Wraps an angle into ]−π, π] */
export function wrapPi(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

export function toDegrees360(rad: number): number {
  const d = (rad * 180) / Math.PI;
  return ((d % 360) + 360) % 360;
}

/**
 * Accumulates the heading between two steps (circular mean of unit vectors), so that each step
 * gets the mean heading over its duration rather than an instantaneous value disturbed by the
 * arm swing.
 */
export class HeadingTracker {
  private sumE = 0;
  private sumN = 0;
  private current = NaN;
  private lastStepHeading = NaN;

  update(q: Quaternion) {
    const { east, north, reliability } = walkingDirection(q);
    if (reliability < 1e-3) return;
    this.sumE += east;
    this.sumN += north;
    this.current = Math.atan2(east, north);
  }

  /** Instantaneous heading (rad), NaN until an orientation has been received */
  get heading(): number {
    return this.current;
  }

  /** Mean heading since the previous step; resets the accumulator. */
  takeStepHeading(): number {
    if (this.sumE !== 0 || this.sumN !== 0) {
      this.lastStepHeading = Math.atan2(this.sumE, this.sumN);
    } else if (!Number.isNaN(this.current)) {
      this.lastStepHeading = this.current;
    }
    this.sumE = 0;
    this.sumN = 0;
    return this.lastStepHeading;
  }
}
