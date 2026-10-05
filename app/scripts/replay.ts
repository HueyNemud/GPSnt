// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Replays a sensor recording (exported from the app, or made by `npm run simulate`) through the
 * same engine as the phone, to tune the parameters at the desk.
 *
 *   npm run replay -- gpsnt-recording-XXXX.json [--pack map-pack] [--no-walls] [--k 0.5]
 *                     [--ppm 2.6] [--north 0] [--decl 1.5] [--seed 1] [--out trace.json]
 *
 * Prints a summary (steps, distance, learnt bias and scale, error at each manual fix) and writes
 * the estimated trace.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NavigationEngine } from '../lib/nav/engine';
import { WallMask } from '../lib/nav/wallMask';
import type { Recording } from '../lib/nav/recording';

const args = process.argv.slice(2);
const VALUE_OPTIONS = ['--pack', '--k', '--ppm', '--north', '--decl', '--seed', '--out'];
const file = args.find((a, i) => !a.startsWith('--') && !VALUE_OPTIONS.includes(args[i - 1]));
if (!file) {
  console.error('usage: npm run replay -- <recording.json> [options]');
  process.exit(1);
}
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const num = (name: string) => (opt(name) !== undefined ? parseFloat(opt(name)!) : undefined);

const rec: Recording = JSON.parse(readFileSync(file, 'utf8'));
const engine = new NavigationEngine({ seed: num('seed') ?? 1, step: num('k') ? { weinbergK: num('k') } : {} });
engine.frame = {
  pixelsPerMeter: num('ppm') ?? rec.frame.pixelsPerMeter,
  mapNorthDeg: num('north') ?? rec.frame.mapNorthDeg,
  declinationDeg: num('decl') ?? rec.frame.declinationDeg,
};
if (!args.includes('--no-walls')) {
  const pack = opt('pack') ?? 'map-pack';
  const meta = JSON.parse(readFileSync(join(pack, 'map.json'), 'utf8'));
  if (rec.mapId && rec.mapId !== meta.id) {
    console.warn(`warning: recorded on map "${rec.mapId}", replayed on "${meta.id}" (use --pack or --no-walls)`);
  }
  const wallsFile = join(pack, 'walls.bin');
  if (!existsSync(wallsFile)) throw new Error(`${wallsFile} not found: build a map pack first (see docs/map-packs.md)`);
  engine.walls = WallMask.decode(new Uint8Array(readFileSync(wallsFile)));
}

const DEG = 180 / Math.PI;
const ppm = engine.frame.pixelsPerMeter;
const trace: { t: number; x: number; y: number; heading: number; conflict: boolean }[] = [];
let distance = 0;
let conflicts = 0;

for (const e of rec.events) {
  switch (e[0]) {
    case 'r':
      engine.onRotation([e[2], e[3], e[4], e[5]]);
      break;
    case 'a': {
      const s = engine.onAccel(e[1], e[2], e[3], e[4]);
      if (s) {
        distance += s.length * s.estimate.stepScale;
        if (s.mapConflict) conflicts++;
        trace.push({ t: s.time, x: s.estimate.x, y: s.estimate.y, heading: s.heading * DEG, conflict: s.mapConflict });
      }
      break;
    }
    case 's':
      engine.start(e[2], e[3]);
      trace.push({ t: e[1], x: e[2], y: e[3], heading: NaN, conflict: false });
      break;
    case 'c': {
      const before = engine.filter.estimate();
      const err = Math.hypot(before.x - e[2], before.y - e[3]) / ppm;
      const reinit = engine.correct(e[2], e[3]);
      const after = engine.filter.estimate();
      console.log(
        `fix t=${e[1].toFixed(1)}s: error ${err.toFixed(1)} m${reinit ? ' (reinitialised)' : ''}` +
          ` → bias ${(after.headingBias * DEG).toFixed(1)}°, scale ×${after.stepScale.toFixed(2)}`,
      );
      trace.push({ t: e[1], x: e[2], y: e[3], heading: NaN, conflict: false });
      break;
    }
  }
}

const est = engine.filter.estimate();
console.log(`${engine.stepCount} steps, ${distance.toFixed(1)} m, ${conflicts} map conflicts`);
console.log(`final bias ${(est.headingBias * DEG).toFixed(1)}°, scale ×${est.stepScale.toFixed(2)}, ±${(est.stdPx / ppm).toFixed(1)} m`);

const out = opt('out') ?? file.replace(/\.json$/, '') + '.trace.json';
writeFileSync(out, JSON.stringify({ frame: engine.frame, trace }, null, 1));
console.log(`trace: ${out}`);
