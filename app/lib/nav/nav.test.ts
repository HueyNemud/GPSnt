// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { HeadingTracker, Quaternion, walkingHeading, wrapPi } from './orientation';
import { StepDetector } from './step';
import { stepDelta, MapFrame } from './mapFrame';
import { WallMask } from './wallMask';
import { ParticleFilter } from './particleFilter';
import { Random } from './random';
import { NavigationEngine } from './engine';
import { devicePose, simulateWalk } from './simulate';

const DEG = Math.PI / 180;

/** Phone whose top points to `headingDeg` (clockwise from north), tilted up by `pitchDeg` */
function pose(headingDeg: number, pitchDeg: number, rollDeg = 0): Quaternion {
  return devicePose(headingDeg * DEG, pitchDeg * DEG, rollDeg * DEG);
}

describe('orientation', () => {
  it.each([0, 45, 90, 180, 270, 333])('heading %i° whatever the tilt', (h) => {
    for (const pitch of [0, 30, 45, 60, 80, 89, 90, 100, -30]) {
      const err = wrapPi(walkingHeading(pose(h, pitch)) - h * DEG);
      expect(Math.abs(err)).toBeLessThan(1e-6);
    }
  });

  it('no jump close to vertical', () => {
    let prev = walkingHeading(pose(120, 85));
    for (let p = 85; p <= 95; p += 0.5) {
      const cur = walkingHeading(pose(120, p));
      expect(Math.abs(wrapPi(cur - prev))).toBeLessThan(0.01);
      prev = cur;
    }
  });

  it('roll does not change the heading (phone tilted up to 70°)', () => {
    for (const pitch of [0, 40, 70]) {
      for (const roll of [-20, 15, 30]) {
        const err = wrapPi(walkingHeading(pose(200, pitch, roll)) - 200 * DEG);
        expect(Math.abs(err)).toBeLessThan(1e-6);
      }
    }
  });

  it('circular mean between two steps around 0/360°', () => {
    const t = new HeadingTracker();
    t.update(pose(350, 30));
    t.update(pose(10, 30));
    expect(Math.abs(wrapPi(t.takeStepHeading()))).toBeLessThan(1e-6);
  });
});

describe('step detector', () => {
  function simulate(freq: number, amp: number, seconds: number, noise = 0.02) {
    const rng = new Random(42);
    const det = new StepDetector();
    const steps = [];
    for (let i = 0; i < seconds * 50; i++) {
      const t = 1000 + i / 50 + rng.gaussian(0, 0.001);
      const m = 1 + amp * Math.sin(2 * Math.PI * freq * (i / 50)) + rng.gaussian(0, noise);
      // Gravity spread over the axes (tilted phone)
      const s = det.update(t, 0.3 * m, 0.6 * m, Math.sqrt(1 - 0.45) * m);
      if (s) steps.push(s);
    }
    return steps;
  }

  it('counts the steps of a 1.8 Hz walk', () => {
    const steps = simulate(1.8, 0.25, 10);
    expect(steps.length).toBeGreaterThanOrEqual(17);
    expect(steps.length).toBeLessThanOrEqual(18);
    for (const s of steps) {
      expect(s.length).toBeGreaterThan(0.5);
      expect(s.length).toBeLessThan(1.0);
    }
  });

  it('counts nothing when standing still', () => {
    expect(simulate(1.8, 0, 10)).toHaveLength(0);
  });

  it('longer steps when the amplitude grows', () => {
    const small = simulate(1.8, 0.15, 5);
    const big = simulate(1.8, 0.5, 5);
    expect(big[2].length).toBeGreaterThan(small[2].length);
  });
});

describe('map frame', () => {
  const frame: MapFrame = { pixelsPerMeter: 10, mapNorthDeg: 0, declinationDeg: 0 };
  it('north = image top, east = right', () => {
    const n = stepDelta(frame, 1, 0);
    expect(n.dx).toBeCloseTo(0);
    expect(n.dy).toBeCloseTo(-10);
    const e = stepDelta(frame, 1, Math.PI / 2);
    expect(e.dx).toBeCloseTo(10);
    expect(e.dy).toBeCloseTo(0);
  });
});

/** Horizontal corridor from y=95 to y=105 */
function corridor(): WallMask {
  const m = new WallMask(3000, 200);
  for (let x = 0; x < 3000; x++) {
    m.set(x, 95);
    m.set(x, 105);
  }
  return m;
}

describe('wall mask', () => {
  const m = corridor();
  it('detects a crossing', () => {
    expect(m.segmentCrossesWall(10.5, 100.5, 10.5, 90.5)).toBe(true);
    expect(m.segmentCrossesWall(10.5, 100.5, 60.5, 103.5)).toBe(false);
  });

  it('no diagonal leak through a one-pixel wall', () => {
    const d = new WallMask(10, 10);
    for (let i = 0; i < 10; i++) d.set(i, 9 - i); // anti-diagonal
    expect(d.segmentCrossesWall(2.5, 2.5, 7.5, 7.5)).toBe(true);
  });

  it('decodes the RLE format', () => {
    // 4×2: row 0 = ..##, row 1 = #... (same example as mapkit/tests/test_mapkit.py)
    const header = [0x47, 0x57, 0x4d, 0x31, 4, 0, 0, 0, 2, 0, 0, 0];
    const runs = [2, 3, 3];
    const mask = WallMask.decode(new Uint8Array([...header, ...runs]));
    expect([0, 1, 2, 3].map((x) => mask.isWall(x, 0))).toEqual([false, false, true, true]);
    expect([0, 1, 2, 3].map((x) => mask.isWall(x, 1))).toEqual([true, false, false, false]);
  });
});

describe('particle filter', () => {
  const frame: MapFrame = { pixelsPerMeter: 10, mapNorthDeg: 0, declinationDeg: 0 };
  const trueBias = 10 * DEG; // the compass reads 10° less than the truth

  it('corridor walls correct a heading bias', () => {
    const pf = new ParticleFilter({ count: 800, initialBiasDeg: 10 }, 7);
    pf.init(100, 100, 1);
    const walls = corridor();
    for (let i = 0; i < 150; i++) pf.step(0.7, Math.PI / 2 - trueBias, frame, walls);
    const e = pf.estimate();
    expect(Math.abs(e.y - 100)).toBeLessThan(5);
    expect(e.x).toBeGreaterThan(100 + 150 * 7 * 0.8);
    expect(Math.abs(e.headingBias - trueBias)).toBeLessThan(4 * DEG);
  });

  it('without walls, manual fixes learn bias and scale', () => {
    const pf = new ParticleFilter({ count: 800, initialBiasDeg: 10 }, 3);
    let x = 100, y = 1000;
    pf.init(x, y, 0);
    for (let leg = 0; leg < 6; leg++) {
      const trueHeading = (leg * 70 * DEG) % (2 * Math.PI);
      for (let i = 0; i < 40; i++) {
        pf.step(0.7, trueHeading - trueBias, frame, null);
        // real steps 10 % longer than measured
        x += 0.77 * 10 * Math.sin(trueHeading);
        y -= 0.77 * 10 * Math.cos(trueHeading);
      }
      pf.correct(x, y, frame);
    }
    const e = pf.estimate();
    expect(Math.abs(e.headingBias - trueBias)).toBeLessThan(3 * DEG);
    expect(e.stepScale).toBeGreaterThan(1.03);
    expect(Math.hypot(e.x - x, e.y - y)).toBeLessThan(1e-6);
  });

  it('reports a conflict when the map blocks everything', () => {
    const pf = new ParticleFilter({ count: 200 }, 1);
    pf.init(100, 100, 0);
    // Walking due north in a horizontal corridor: impossible according to the map
    const r = pf.step(1.5, 0, frame, corridor());
    expect(r.mapConflict).toBe(true);
  });
});

describe('end to end', () => {
  const frame: MapFrame = { pixelsPerMeter: 10, mapNorthDeg: 0, declinationDeg: 0 };

  function run(walk: ReturnType<typeof simulateWalk>, walls: WallMask | null) {
    const engine = new NavigationEngine({ seed: 5 });
    engine.frame = frame;
    engine.walls = walls;
    for (const e of walk.recording.events) {
      if (e[0] === 'r') engine.onRotation([e[2], e[3], e[4], e[5]]);
      else if (e[0] === 'a') engine.onAccel(e[1], e[2], e[3], e[4]);
      else if (e[0] === 's') engine.start(e[2], e[3]);
      else engine.correct(e[2], e[3]);
    }
    return engine;
  }

  it('follows a simulated walk along a corridor despite a compass bias', () => {
    const walk = simulateWalk({ path: [[100, 100], [2600, 100]], frame, compassBiasDeg: 8, seed: 2 });
    const engine = run(walk, corridor());
    const end = walk.truth[walk.truth.length - 1];
    expect(engine.stepCount).toBeGreaterThan(walk.truth.length * 0.9);
    // Without the walls an 8° bias would put the walker ~35 m off the corridor axis
    expect(Math.abs(engine.filter.estimate().y - end.y)).toBeLessThan(5 * frame.pixelsPerMeter);
  });

  it('manual fixes learn the compass bias on a walk with turns', () => {
    const path: [number, number][] = [[1000, 1000], [1000, 600], [1400, 600], [1400, 1000], [1000, 1000], [1000, 600]];
    const walk = simulateWalk({ path, frame, compassBiasDeg: 8, fixAtWaypoints: true, seed: 3 });
    const engine = run(walk, null);
    expect(engine.filter.estimate().headingBias / DEG).toBeGreaterThan(4);
  });
});
