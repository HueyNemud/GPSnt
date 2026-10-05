// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Raw recording of the engine inputs, to replay a walk at the desk (scripts/replay.ts) and tune
 * the parameters.
 *
 * Compact events (arrays) to keep the JSON small:
 *   ['r', t, w, x, y, z]   rotation (device → ENU quaternion)
 *   ['a', t, ax, ay, az]   accelerometer (g)
 *   ['s', t, x, y]         start position (image pixels)
 *   ['c', t, x, y]         manual fix (image pixels)
 */

import { MapFrame } from './mapFrame';

export type RecordedEvent =
  | ['r', number, number, number, number, number]
  | ['a', number, number, number, number]
  | ['s', number, number, number]
  | ['c', number, number, number];

export interface Recording {
  version: 1;
  createdAt: string;
  /** Map the recording was made on (map pack id) */
  mapId?: string;
  frame: MapFrame;
  events: RecordedEvent[];
}

export class Recorder {
  private events: RecordedEvent[] = [];
  recording = false;

  start() {
    this.events = [];
    this.recording = true;
  }

  stop() {
    this.recording = false;
  }

  get size() {
    return this.events.length;
  }

  push(e: RecordedEvent) {
    if (this.recording) this.events.push(e);
  }

  toJSON(frame: MapFrame, mapId?: string): Recording {
    return { version: 1, createdAt: new Date().toISOString(), mapId, frame, events: this.events };
  }
}
