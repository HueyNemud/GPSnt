// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react';
import { File, Paths } from 'expo-file-system';
import { MapFrame } from '../lib/nav/mapFrame';
import { DEFAULT_STEP_CONFIG } from '../lib/nav/step';
import { MAP, MAP_DEFAULT_FRAME } from '../lib/mapPack';

export interface Settings {
  /** Map `frame` was calibrated for */
  mapId: string;
  frame: MapFrame;
  /** Weinberg constant (step length) */
  stepK: number;
  /** false: fusion without magnetometer (relative heading, immune to magnetic disturbances) */
  useMagnetometer: boolean;
  /** Constrain the position with the walls extracted from the map */
  useWalls: boolean;
  showParticles: boolean;
  /** Overlay the walkable areas of the wall mask */
  showWalls: boolean;
  useDarkMap: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  mapId: MAP.id,
  frame: MAP_DEFAULT_FRAME,
  stepK: DEFAULT_STEP_CONFIG.weinbergK,
  useMagnetometer: true,
  useWalls: true,
  showParticles: true,
  showWalls: false,
  useDarkMap: true,
};

const settingsFile = () => new File(Paths.document, 'gpsnt-settings.json');

/** Settings persisted in a JSON file (calibration must not be redone at every launch) */
export default function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const file = settingsFile();
      if (file.exists) {
        const saved = JSON.parse(file.textSync());
        // Calibration (scale, north) of another map: meaningless for this one
        const frame = saved.mapId === MAP.id ? { ...MAP_DEFAULT_FRAME, ...saved.frame } : MAP_DEFAULT_FRAME;
        setSettings({ ...DEFAULT_SETTINGS, ...saved, mapId: MAP.id, frame });
      }
    } catch (e) {
      console.warn('Unreadable settings, using defaults', e);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      const file = settingsFile();
      if (!file.exists) file.create();
      file.write(JSON.stringify(settings));
    } catch (e) {
      console.warn('Could not save the settings', e);
    }
  }, [settings, loaded]);

  return [settings, setSettings] as const;
}
