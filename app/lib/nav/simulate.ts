// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Synthetic walks: generates the sensor stream (orientation + accelerometer) a phone would see
 * along a polyline, as a Recording that the engine or the replay tool can consume.
 *
 * The model is deliberately simple: constant cadence, sinusoidal vertical acceleration, phone
 * held in portrait at a fixed tilt, and a constant compass bias. It is enough to exercise the
 * whole pipeline end to end without field data.
 */

import { Random } from './random';
import { MapFrame } from './mapFrame';
import { Quaternion, rotateToWorld } from './orientation';
import type { RecordedEvent, Recording } from './recording';

const DEG = Math.PI / 180;

export interface WalkOptions {
  /** Waypoints in image pixels; the walker starts on the first one */
  path: [number, number][];
  frame: MapFrame;
  /** True step length (m) */
  stepLength?: number;
  /** Steps per second */
  cadenceHz?: number;
  /** Amplitude of the vertical acceleration (g) */
  accelAmplitude?: number;
  /** Phone tilt above horizontal (deg) */
  pitchDeg?: number;
  /** Compass error (deg): the phone reports heading − bias */
  compassBiasDeg?: number;
  /** Sensor noise (g) */
  noise?: number;
  /** Add a manual fix ('c' event) at each waypoint after the first */
  fixAtWaypoints?: boolean;
  sampleHz?: number;
  seed?: number;
}

export interface Walk {
  recording: Recording;
  /** True position after each step (image pixels) */
  truth: { x: number; y: number }[];
}

function quatMul(a: Quaternion, b: Quaternion): Quaternion {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

/** Device → ENU quaternion of a phone whose top points to `heading` (rad, clockwise from north) */
export function devicePose(heading: number, pitch: number, roll = 0): Quaternion {
  const yaw = -heading; // rotation about z is counter-clockwise: clockwise heading = negative
  const qYaw: Quaternion = [Math.cos(yaw / 2), 0, 0, Math.sin(yaw / 2)];
  const qPitch: Quaternion = [Math.cos(pitch / 2), Math.sin(pitch / 2), 0, 0]; // top of the screen goes up
  const qRoll: Quaternion = [Math.cos(roll / 2), 0, Math.sin(roll / 2), 0];
  return quatMul(quatMul(qYaw, qPitch), qRoll);
}

export function simulateWalk(o: WalkOptions): Walk {
  const stepLength = o.stepLength ?? 0.75;
  const cadence = o.cadenceHz ?? 1.8;
  const amp = o.accelAmplitude ?? 0.25;
  const pitch = (o.pitchDeg ?? 35) * DEG;
  const bias = (o.compassBiasDeg ?? 0) * DEG;
  const noise = o.noise ?? 0.02;
  const fs = o.sampleHz ?? 50;
  const rng = new Random(o.seed ?? 1);
  const ppm = o.frame.pixelsPerMeter;
  const imageToMagnetic = (o.frame.declinationDeg + o.frame.mapNorthDeg) * DEG;

  const events: RecordedEvent[] = [];
  const truth: { x: number; y: number }[] = [];
  let t = 1000;
  let [x, y] = o.path[0];

  const emit = (heading: number, phase: number) => {
    const q = devicePose(heading - bias, pitch);
    events.push(['r', t, ...q]);
    // Specific force in the device frame: gravity plus the vertical bounce of the gait
    const m = 1 + amp * Math.sin(phase) + rng.gaussian(0, noise);
    const qInv: Quaternion = [q[0], -q[1], -q[2], -q[3]];
    const [ax, ay, az] = rotateToWorld(qInv, [0, 0, m]);
    events.push(['a', t, ax, ay, az]);
    t += 1 / fs;
  };

  // Stand still for a second so that the filters settle, then start
  for (let i = 0; i < fs; i++) emit(0, 0);
  events.push(['s', t, x, y]);
  truth.push({ x, y });

  let phase = 0;
  for (let w = 1; w < o.path.length; w++) {
    const [tx, ty] = o.path[w];
    const heading = Math.atan2(tx - x, -(ty - y)) - imageToMagnetic;
    const steps = Math.max(1, Math.round(Math.hypot(tx - x, ty - y) / ppm / stepLength));
    const dx = (tx - x) / steps;
    const dy = (ty - y) / steps;
    for (let s = 0; s < steps; s++) {
      const samples = Math.round(fs / cadence);
      for (let i = 0; i < samples; i++) {
        phase += (2 * Math.PI) / samples;
        emit(heading, phase);
      }
      x += dx;
      y += dy;
      truth.push({ x, y });
    }
    if (o.fixAtWaypoints) events.push(['c', t, tx, ty]);
  }
  for (let i = 0; i < fs; i++) emit(0, 0);

  return {
    recording: { version: 1, createdAt: new Date(0).toISOString(), mapId: undefined, frame: o.frame, events },
    truth,
  };
}
