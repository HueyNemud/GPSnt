// SPDX-License-Identifier: AGPL-3.0-or-later
/** Seeded pseudo-random generator (mulberry32): deterministic replays. */
export class Random {
  private state: number;
  private spare: number | null = null;

  constructor(seed = 1) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1) */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Normal N(mean, std²) by Box-Muller (polar method) */
  gaussian(mean = 0, std = 1): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return mean + std * s;
    }
    let u: number, v: number, r: number;
    do {
      u = 2 * this.next() - 1;
      v = 2 * this.next() - 1;
      r = u * u + v * v;
    } while (r >= 1 || r === 0);
    const f = Math.sqrt((-2 * Math.log(r)) / r);
    this.spare = v * f;
    return mean + std * u * f;
  }
}
