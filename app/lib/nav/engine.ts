// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Navigation engine: orientation + steps + particle filter.
 * No React Native dependency: used as is by the app hook and by the replay tool (scripts/replay.ts).
 */

import { HeadingTracker, Quaternion } from './orientation';
import { StepDetector, StepDetectorConfig } from './step';
import { ParticleFilter, ParticleFilterConfig, Estimate } from './particleFilter';
import { MapFrame, DEFAULT_MAP_FRAME } from './mapFrame';
import { WallMask } from './wallMask';

export interface EngineStep {
  time: number;
  length: number;
  /** Magnetic heading of the step (rad) */
  heading: number;
  estimate: Estimate;
  mapConflict: boolean;
}

export interface EngineConfig {
  step?: Partial<StepDetectorConfig>;
  filter?: Partial<ParticleFilterConfig>;
  seed?: number;
}

export class NavigationEngine {
  readonly heading = new HeadingTracker();
  readonly steps: StepDetector;
  readonly filter: ParticleFilter;
  frame: MapFrame = { ...DEFAULT_MAP_FRAME };
  walls: WallMask | null = null;
  /** Steps only move the position while the engine is active (not paused) */
  active = true;
  stepCount = 0;

  constructor(config: EngineConfig = {}) {
    this.steps = new StepDetector(config.step);
    this.filter = new ParticleFilter(config.filter, config.seed ?? 1);
  }

  start(x: number, y: number) {
    this.filter.init(x, y, 0);
    this.stepCount = 0;
    this.heading.takeStepHeading(); // the first step must not average the heading since the app was opened
  }

  onRotation(q: Quaternion) {
    this.heading.update(q);
  }

  onAccel(t: number, ax: number, ay: number, az: number): EngineStep | null {
    const step = this.steps.update(t, ax, ay, az);
    if (!step) return null;
    const heading = this.heading.takeStepHeading();
    if (!this.active || !this.filter.isInitialized || Number.isNaN(heading)) return null;
    const { mapConflict } = this.filter.step(step.length, heading, this.frame, this.walls);
    this.stepCount++;
    return { time: step.time, length: step.length, heading, estimate: this.filter.estimate(), mapConflict };
  }

  /** Manual fix; returns true if the whole cloud had to be re-placed */
  correct(x: number, y: number): boolean {
    return this.filter.correct(x, y, this.frame);
  }
}
