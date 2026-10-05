// SPDX-License-Identifier: AGPL-3.0-or-later
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { EventSubscription } from 'expo-modules-core';

export interface RotationEvent {
  /** Device → world ENU quaternion (x East, y magnetic North, z Up) */
  w: number;
  x: number;
  y: number;
  z: number;
  /** Estimated heading accuracy in radians, -1 if unavailable */
  headingAccuracy: number;
  /** true if the fusion does not use the magnetometer (relative heading) */
  game: boolean;
  /** Sensor timestamp in seconds */
  timestamp: number;
}

export interface AccuracyEvent {
  /** 0 unreliable, 1 low, 2 medium, 3 high */
  accuracy: number;
}

interface NativeRotationVector {
  isAvailable(game: boolean): boolean;
  configure(game: boolean, periodMs: number): void;
  addListener(event: 'onRotation', listener: (e: RotationEvent) => void): EventSubscription;
  addListener(event: 'onAccuracy', listener: (e: AccuracyEvent) => void): EventSubscription;
}

// Missing on iOS / web / Expo Go: the hook then shows an error message.
const native = requireOptionalNativeModule<NativeRotationVector>('GpsntRotationVector');

export const RotationVector = {
  isAvailable(game = false): boolean {
    return native?.isAvailable(game) ?? false;
  },
  configure(game: boolean, periodMs = 20) {
    native?.configure(game, periodMs);
  },
  addRotationListener(listener: (e: RotationEvent) => void): EventSubscription | null {
    return native?.addListener('onRotation', listener) ?? null;
  },
  addAccuracyListener(listener: (e: AccuracyEvent) => void): EventSubscription | null {
    return native?.addListener('onAccuracy', listener) ?? null;
  },
};
