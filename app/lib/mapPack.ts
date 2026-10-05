// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The map embedded in this build: app/map-pack, produced by the map kit (docs/map-packs.md).
 * Its tiles are copied into the Android assets by plugins/withMapAssets.js; its wall mask is
 * bundled by Metro (see hooks/useNavigation.ts).
 */

import type { MapFrame } from './nav/mapFrame';
import pack from '../map-pack/map.json';

export interface MapPack {
  format: number;
  /** Changes with the map: the calibration saved for another map is then dropped */
  id: string;
  name: string;
  attribution: string;
  width: number;
  height: number;
  tileSize: number;
  /** Zoom level of the full-resolution tiles */
  maxZoom: number;
  pixelsPerMeter: number;
  northDeg: number;
  declinationDeg: number;
}

export const MAP: MapPack = pack;

/** Calibration provided by the map author, used until the user changes it */
export const MAP_DEFAULT_FRAME: MapFrame = {
  pixelsPerMeter: MAP.pixelsPerMeter,
  mapNorthDeg: MAP.northDeg,
  declinationDeg: MAP.declinationDeg,
};
