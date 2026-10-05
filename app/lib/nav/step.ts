// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Step detection on the accelerometer norm (in g) + step length (Weinberg).
 *
 * Pipeline: |a| − 1 g → 2nd-order Butterworth low-pass (~3 Hz) → peak then valley search with
 * hysteresis. A step is accepted if the peak-to-valley amplitude is large enough and the interval
 * since the previous step is plausible. Times are sensor timestamps (seconds).
 */

export interface StepDetectorConfig {
  cutoffHz: number;
  /** Minimum peak-to-valley amplitude (g) of the filtered signal for a step */
  minAmplitude: number;
  /** Minimum height of a peak above 1 g */
  minPeak: number;
  /** Hysteresis (g) to confirm an extremum */
  hysteresis: number;
  minStepInterval: number; // s
  /** Weinberg constant: L = K · (amax − amin in m/s²)^¼ */
  weinbergK: number;
  minStepLength: number; // m
  maxStepLength: number; // m
}

export const DEFAULT_STEP_CONFIG: StepDetectorConfig = {
  cutoffHz: 3,
  minAmplitude: 0.12,
  minPeak: 0.04,
  hysteresis: 0.03,
  minStepInterval: 0.25,
  weinbergK: 0.5,
  minStepLength: 0.3,
  maxStepLength: 1.2,
};

export interface StepEvent {
  /** Time of the peak (s, sensor clock) */
  time: number;
  /** Estimated length (m) */
  length: number;
  /** Filtered peak-to-valley amplitude (g) */
  amplitude: number;
}

const G = 9.80665;

/** Butterworth low-pass biquad (transposed direct form II) */
class LowPass {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;
  private fs = 0;
  private primed = false;

  constructor(private cutoff: number) {}

  configure(fs: number) {
    if (this.fs && Math.abs(fs - this.fs) / this.fs < 0.1) return;
    this.fs = fs;
    const k = Math.tan((Math.PI * Math.min(this.cutoff, fs * 0.45)) / fs);
    const q = Math.SQRT1_2;
    const norm = 1 / (1 + k / q + k * k);
    this.b0 = k * k * norm;
    this.b1 = 2 * this.b0;
    this.b2 = this.b0;
    this.a1 = 2 * (k * k - 1) * norm;
    this.a2 = (1 - k / q + k * k) * norm;
  }

  filter(x: number): number {
    if (!this.primed) {
      // Start in steady state to avoid a transient (false step at launch)
      this.primed = true;
      this.z1 = x * (1 - this.b0);
      this.z2 = x * (this.b2 - this.a2);
    }
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  reset() {
    this.primed = false;
    this.z1 = this.z2 = 0;
  }
}

export class StepDetector {
  readonly config: StepDetectorConfig;
  private lp: LowPass;
  private lastTime = NaN;
  private dtAvg = 0.02;

  private seekingPeak = true;
  private peakValue = -Infinity;
  private peakTime = 0;
  private valleyValue = Infinity;
  private lastStepTime = -Infinity;

  /** Last filtered value (for debugging) */
  filtered = 0;

  constructor(config: Partial<StepDetectorConfig> = {}) {
    this.config = { ...DEFAULT_STEP_CONFIG, ...config };
    this.lp = new LowPass(this.config.cutoffHz);
  }

  /** @param t sensor timestamp (s); a* in g. Returns a step when one has just been accepted. */
  update(t: number, ax: number, ay: number, az: number): StepEvent | null {
    if (!Number.isNaN(this.lastTime)) {
      const dt = t - this.lastTime;
      if (dt <= 0) return null; // duplicated or out-of-order sample
      if (dt < 0.5) this.dtAvg += 0.05 * (dt - this.dtAvg);
    }
    this.lastTime = t;
    this.lp.configure(1 / this.dtAvg);

    const v = this.lp.filter(Math.sqrt(ax * ax + ay * ay + az * az) - 1);
    this.filtered = v;
    const c = this.config;

    if (this.seekingPeak) {
      if (v > this.peakValue) {
        this.peakValue = v;
        this.peakTime = t;
      } else if (this.peakValue >= c.minPeak && v < this.peakValue - c.hysteresis) {
        this.seekingPeak = false;
        this.valleyValue = v;
      }
      return null;
    }

    // Looking for the valley that follows the peak
    if (v < this.valleyValue) {
      this.valleyValue = v;
      return null;
    }
    if (v <= this.valleyValue + c.hysteresis) return null;

    // Valley confirmed: accept (or not) the step, then look for the next peak
    const amplitude = this.peakValue - this.valleyValue;
    const peakTime = this.peakTime;
    this.seekingPeak = true;
    this.peakValue = v;
    this.peakTime = t;

    if (amplitude < c.minAmplitude) return null;
    if (peakTime - this.lastStepTime < c.minStepInterval) return null;
    this.lastStepTime = peakTime;

    const length = Math.min(c.maxStepLength, Math.max(c.minStepLength, c.weinbergK * Math.pow(amplitude * G, 0.25)));
    return { time: peakTime, length, amplitude };
  }

  reset() {
    this.lp.reset();
    this.lastTime = NaN;
    this.seekingPeak = true;
    this.peakValue = -Infinity;
    this.valleyValue = Infinity;
    this.lastStepTime = -Infinity;
  }
}
