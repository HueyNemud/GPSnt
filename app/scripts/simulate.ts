// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Writes a synthetic sensor recording (see lib/nav/simulate.ts), to try the replay tool without
 * field data.
 *
 *   npm run simulate -- [--out walk.json] [--bias 8] [--fixes] [--path "x,y x,y …"] [--pack map-pack]
 *
 * The default path follows corridors of the demo map (maps/demo).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { simulateWalk } from '../lib/nav/simulate';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const DEMO_PATH = '1092,1176 1050,1010 1032,924 1032,760 1038,660 1164,658 1290,700 1444,698 1572,718';
const path = (opt('path') ?? DEMO_PATH).trim().split(/\s+/).map((p) => p.split(',').map(Number) as [number, number]);
const meta = JSON.parse(readFileSync(join(opt('pack') ?? 'map-pack', 'map.json'), 'utf8'));
const frame = { pixelsPerMeter: meta.pixelsPerMeter, mapNorthDeg: meta.northDeg, declinationDeg: meta.declinationDeg };

const { recording, truth } = simulateWalk({
  path,
  frame,
  compassBiasDeg: parseFloat(opt('bias') ?? '8'),
  fixAtWaypoints: args.includes('--fixes'),
  seed: 1,
});
recording.mapId = meta.id;
const out = opt('out') ?? 'gpsnt-simulated-walk.json';
writeFileSync(out, JSON.stringify(recording));
console.log(`${out}: ${truth.length - 1} steps on "${meta.id}"; replay it with: npm run replay -- ${out}`);
