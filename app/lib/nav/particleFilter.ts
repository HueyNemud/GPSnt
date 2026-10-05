// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Particle filter for map-constrained dead reckoning.
 *
 * Each particle carries a hypothesis of position (image pixels), heading bias (rad: slow compass
 * error + map orientation error) and step scale factor.
 *  - On every step, particles move forward with noise; those crossing a wall are heavily
 *    penalised. If the map rules out almost every hypothesis, walls are ignored for that step
 *    ("map conflict"): an imperfect map never blocks navigation.
 *  - A manual fix (tap on the map) weights particles by their distance to the tapped point: those
 *    whose bias and scale "were right" survive, so the filter learns these parameters fix after
 *    fix.
 */

import { Random } from './random';
import { MapFrame, imageAngle, stepDelta } from './mapFrame';
import { WallMask } from './wallMask';

export interface ParticleFilterConfig {
  count: number;
  /** Per-step heading noise (deg) */
  headingNoiseDeg: number;
  /** Per-step length noise (m) */
  stepLengthNoise: number;
  /** Initial spread of the heading bias (deg) */
  initialBiasDeg: number;
  /** Random walk of the bias at each step (deg) */
  biasWalkDeg: number;
  /** Initial spread of the step scale factor */
  initialScaleStd: number;
  scaleWalk: number;
  /** Factor applied to the weight of a particle that crosses a wall */
  wallPenalty: number;
  /**
   * If the fraction of weight left after the wall check is below this threshold, the map
   * contradicts almost every hypothesis: walls are ignored for this step (conflict reported).
   */
  conflictThreshold: number;
  /** Standard deviation of a manual fix (m) */
  correctionSigma: number;
}

export const DEFAULT_PF_CONFIG: ParticleFilterConfig = {
  count: 500,
  headingNoiseDeg: 4,
  stepLengthNoise: 0.05,
  initialBiasDeg: 8,
  biasWalkDeg: 0.3,
  initialScaleStd: 0.1,
  scaleWalk: 0.003,
  wallPenalty: 0.001,
  conflictThreshold: 0.05,
  correctionSigma: 2,
};

export interface Estimate {
  x: number;
  y: number;
  /** Position standard deviation (pixels), mean of both axes */
  stdPx: number;
  headingBias: number; // rad
  stepScale: number;
  /** Effective number of particles */
  neff: number;
}

export interface StepOutcome {
  /** The map contradicted every hypothesis: walls ignored for this step */
  mapConflict: boolean;
}

const DEG = Math.PI / 180;

export class ParticleFilter {
  readonly config: ParticleFilterConfig;
  private rng: Random;
  private n: number;
  private x: Float64Array;
  private y: Float64Array;
  private bias: Float64Array;
  private scale: Float64Array;
  private w: Float64Array;
  private px: Float64Array;
  private py: Float64Array;
  private initialized = false;

  constructor(config: Partial<ParticleFilterConfig> = {}, seed = 1) {
    this.config = { ...DEFAULT_PF_CONFIG, ...config };
    this.rng = new Random(seed);
    this.n = this.config.count;
    this.x = new Float64Array(this.n);
    this.y = new Float64Array(this.n);
    this.bias = new Float64Array(this.n);
    this.scale = new Float64Array(this.n);
    this.w = new Float64Array(this.n);
    this.px = new Float64Array(this.n);
    this.py = new Float64Array(this.n);
  }

  get isInitialized() {
    return this.initialized;
  }

  /** Places all particles around (x, y); resets bias and scale. */
  init(x: number, y: number, spreadPx = 0) {
    const c = this.config;
    for (let i = 0; i < this.n; i++) {
      this.x[i] = x + this.rng.gaussian(0, spreadPx);
      this.y[i] = y + this.rng.gaussian(0, spreadPx);
      this.bias[i] = this.rng.gaussian(0, c.initialBiasDeg * DEG);
      this.scale[i] = 1 + this.rng.gaussian(0, c.initialScaleStd);
      this.w[i] = 1 / this.n;
    }
    this.initialized = true;
  }

  /**
   * Propagates the particles by one step.
   * @param length measured length (m); @param heading measured magnetic heading (rad)
   */
  step(length: number, heading: number, frame: MapFrame, walls: WallMask | null): StepOutcome {
    if (!this.initialized) return { mapConflict: false };
    const c = this.config;
    const theta0 = imageAngle(frame, heading);
    for (let i = 0; i < this.n; i++) {
      this.bias[i] += this.rng.gaussian(0, c.biasWalkDeg * DEG);
      this.scale[i] = Math.max(0.5, this.scale[i] + this.rng.gaussian(0, c.scaleWalk));
      const theta = theta0 + this.bias[i] + this.rng.gaussian(0, c.headingNoiseDeg * DEG);
      const l = Math.max(0, length * this.scale[i] + this.rng.gaussian(0, c.stepLengthNoise));
      const { dx, dy } = stepDelta(frame, l, theta);
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      this.x[i] += dx;
      this.y[i] += dy;
    }

    let mapConflict = false;
    if (walls) {
      let before = 0;
      let after = 0;
      const penalized = new Float64Array(this.n);
      for (let i = 0; i < this.n; i++) {
        before += this.w[i];
        const crosses = walls.segmentCrossesWall(this.px[i], this.py[i], this.x[i], this.y[i]);
        penalized[i] = crosses ? this.w[i] * c.wallPenalty : this.w[i];
        after += penalized[i];
      }
      if (after / before < c.conflictThreshold) {
        mapConflict = true; // keep the previous weights: the map is not trusted for this step
      } else {
        this.w.set(penalized);
      }
    }

    this.normalizeAndMaybeResample();
    return { mapConflict };
  }

  /**
   * Manual fix: the user tells where they are (image pixels).
   * Particles are weighted by their likelihood, resampled, then the cloud is re-centred on the
   * given point (the user knows where they are). If no particle was plausible, the cloud is
   * placed around the point again, keeping the learnt bias and scale.
   * @returns true if the particles had to be re-placed for lack of a plausible hypothesis
   */
  correct(x: number, y: number, frame: MapFrame, sigmaMeters = this.config.correctionSigma): boolean {
    const sigma = sigmaMeters * frame.pixelsPerMeter;
    if (!this.initialized) {
      this.init(x, y, sigma / 2);
      return true;
    }
    let maxLik = 0;
    for (let i = 0; i < this.n; i++) {
      const d2 = (this.x[i] - x) ** 2 + (this.y[i] - y) ** 2;
      const lik = Math.exp(-d2 / (2 * sigma * sigma));
      this.w[i] *= lik;
      maxLik = Math.max(maxLik, lik);
    }
    // No particle within ~3σ: the error exceeds what the model can explain
    const reinitialized = maxLik < Math.exp(-4.5);
    if (reinitialized) this.w.fill(1 / this.n);
    this.normalize();
    this.resample();

    if (reinitialized) {
      for (let i = 0; i < this.n; i++) {
        this.x[i] = x + this.rng.gaussian(0, sigma / 2);
        this.y[i] = y + this.rng.gaussian(0, sigma / 2);
      }
    } else {
      const est = this.estimate();
      for (let i = 0; i < this.n; i++) {
        this.x[i] += x - est.x;
        this.y[i] += y - est.y;
      }
    }
    return reinitialized;
  }

  estimate(): Estimate {
    let sx = 0, sy = 0, sb = 0, ss = 0, sw2 = 0;
    for (let i = 0; i < this.n; i++) {
      const w = this.w[i];
      sx += w * this.x[i];
      sy += w * this.y[i];
      sb += w * this.bias[i];
      ss += w * this.scale[i];
      sw2 += w * w;
    }
    let vx = 0, vy = 0;
    for (let i = 0; i < this.n; i++) {
      vx += this.w[i] * (this.x[i] - sx) ** 2;
      vy += this.w[i] * (this.y[i] - sy) ** 2;
    }
    return {
      x: sx,
      y: sy,
      stdPx: Math.sqrt((vx + vy) / 2),
      headingBias: sb,
      stepScale: ss,
      neff: sw2 > 0 ? 1 / sw2 : 0,
    };
  }

  /** Subsample of the positions for display: [x0, y0, x1, y1, ...] */
  sample(max = 150): number[] {
    const out: number[] = [];
    const stride = Math.max(1, Math.floor(this.n / max));
    for (let i = 0; i < this.n; i += stride) out.push(this.x[i], this.y[i]);
    return out;
  }

  private normalize() {
    let sum = 0;
    for (let i = 0; i < this.n; i++) sum += this.w[i];
    if (!(sum > 0)) {
      this.w.fill(1 / this.n);
      return;
    }
    for (let i = 0; i < this.n; i++) this.w[i] /= sum;
  }

  private normalizeAndMaybeResample() {
    this.normalize();
    let sw2 = 0;
    for (let i = 0; i < this.n; i++) sw2 += this.w[i] * this.w[i];
    if (1 / sw2 < this.n / 2) this.resample();
  }

  /** Systematic resampling (O(n)), weights reset to 1/n */
  private resample() {
    const n = this.n;
    const nx = new Float64Array(n);
    const ny = new Float64Array(n);
    const nb = new Float64Array(n);
    const ns = new Float64Array(n);
    const u0 = this.rng.next() / n;
    let cum = this.w[0];
    let j = 0;
    for (let i = 0; i < n; i++) {
      const u = u0 + i / n;
      while (u > cum && j < n - 1) cum += this.w[++j];
      nx[i] = this.x[j];
      ny[i] = this.y[j];
      nb[i] = this.bias[j];
      ns[i] = this.scale[j];
    }
    this.x = nx;
    this.y = ny;
    this.bias = nb;
    this.scale = ns;
    this.w.fill(1 / n);
  }
}
