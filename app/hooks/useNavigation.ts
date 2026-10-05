// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useRef, useState } from 'react';
import { Accelerometer } from 'expo-sensors';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { RotationVector } from '../modules/rotation-vector';
import { NavigationEngine } from '../lib/nav/engine';
import { imageAngle } from '../lib/nav/mapFrame';
import { WallMask } from '../lib/nav/wallMask';
import { Recorder } from '../lib/nav/recording';
import { Quaternion } from '../lib/nav/orientation';
import { MAP } from '../lib/mapPack';
import { Settings } from './useSettings';

export interface Point { x: number; y: number; }

export interface NavState {
  position: Point | null;
  /** Direction shown on the image (rad, clockwise from the top), estimated bias included */
  displayAngle: number;
  /** Position uncertainty (pixels) */
  uncertaintyPx: number;
  particles: number[];
}

export interface DebugInfo {
  steps: number;
  /** Distance walked (m), learnt scale included */
  distance: number;
  headingDeg: number;
  headingAccuracyDeg: number;
  lastStepLength: number;
  biasDeg: number;
  stepScale: number;
  neff: number;
  mapConflicts: number;
}

export type WallsStatus = 'loading' | 'ready' | 'error';

const DEG = 180 / Math.PI;
const UI_INTERVAL_MS = 100;

async function loadWalls(): Promise<WallMask> {
  const asset = Asset.fromModule(require('../map-pack/walls.bin'));
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  return WallMask.decode(await new File(uri).bytes());
}

/**
 * Connects the sensors to the navigation engine (lib/nav) and exposes its state to the UI.
 * Sensors are subscribed once: changing a setting does not restart sampling.
 */
export default function useNavigation(settings: Settings) {
  const engine = useRef(new NavigationEngine()).current;
  const recorder = useRef(new Recorder()).current;

  const [started, setStarted] = useState(false);
  const [paused, setPausedState] = useState(false);
  const [nav, setNav] = useState<NavState>({ position: null, displayAngle: 0, uncertaintyPx: 0, particles: [] });
  const [path, setPath] = useState<Point[]>([]);
  const [compassDeg, setCompassDeg] = useState(0);
  const [magAccuracy, setMagAccuracy] = useState(3);
  const [sensorError, setSensorError] = useState<string | null>(null);
  const [wallsStatus, setWallsStatus] = useState<WallsStatus>('loading');
  const [recording, setRecording] = useState(false);
  const [debug, setDebug] = useState<DebugInfo>({
    steps: 0, distance: 0, headingDeg: 0, headingAccuracyDeg: -1, lastStepLength: 0, biasDeg: 0, stepScale: 1, neff: 0, mapConflicts: 0,
  });

  const walls = useRef<WallMask | null>(null);
  const mapConflicts = useRef(0);
  const distance = useRef(0);
  const headingAccuracy = useRef(-1);
  /** Last sensor timestamp (s): recorded user events use the same clock */
  const sensorTime = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // --- Settings → engine ---
  useEffect(() => {
    engine.frame = settings.frame;
    engine.steps.config.weinbergK = settings.stepK;
    engine.walls = settings.useWalls ? walls.current : null;
  }, [settings, engine, wallsStatus]);

  useEffect(() => {
    RotationVector.configure(!settings.useMagnetometer, 20);
  }, [settings.useMagnetometer]);

  // --- Wall mask ---
  useEffect(() => {
    loadWalls()
      .then((mask) => {
        walls.current = mask;
        setWallsStatus('ready');
      })
      .catch((e) => {
        console.warn('Wall mask unavailable', e);
        setWallsStatus('error');
      });
  }, []);

  const publishEstimate = useCallback(() => {
    const est = engine.filter.estimate();
    const heading = engine.heading.heading;
    setNav({
      position: { x: est.x, y: est.y },
      displayAngle: Number.isNaN(heading) ? 0 : imageAngle(engine.frame, heading) + est.headingBias,
      uncertaintyPx: est.stdPx,
      particles: settingsRef.current.showParticles ? engine.filter.sample() : [],
    });
    return est;
  }, [engine]);

  // --- Sensors ---
  useEffect(() => {
    if (!RotationVector.isAvailable(false)) {
      setSensorError('Android orientation fusion unavailable (native module missing: use a build, not Expo Go)');
      return;
    }
    let lastUi = 0;

    const rotSub = RotationVector.addRotationListener((e) => {
      const q: Quaternion = [e.w, e.x, e.y, e.z];
      engine.onRotation(q);
      headingAccuracy.current = e.headingAccuracy;
      sensorTime.current = e.timestamp;
      recorder.push(['r', e.timestamp, e.w, e.x, e.y, e.z]);
      const now = Date.now();
      if (now - lastUi > UI_INTERVAL_MS) {
        lastUi = now;
        const h = engine.heading.heading;
        if (!Number.isNaN(h)) setCompassDeg(((h * DEG) % 360 + 360) % 360);
        if (engine.filter.isInitialized) {
          const est = engine.filter.estimate();
          setNav((prev) => ({ ...prev, displayAngle: imageAngle(engine.frame, h) + est.headingBias }));
        }
      }
    });
    const accSub = RotationVector.addAccuracyListener((e) => setMagAccuracy(e.accuracy));

    Accelerometer.setUpdateInterval(20); // milliseconds → 50 Hz
    const accelSub = Accelerometer.addListener(({ x, y, z, timestamp }) => {
      sensorTime.current = timestamp;
      recorder.push(['a', timestamp, x, y, z]);
      const step = engine.onAccel(timestamp, x, y, z);
      if (!step) return;
      if (step.mapConflict) mapConflicts.current++;
      const est = publishEstimate();
      distance.current += step.length * est.stepScale;
      setPath((prev) => [...prev, { x: est.x, y: est.y }]);
      setDebug({
        steps: engine.stepCount,
        distance: distance.current,
        headingDeg: Math.round(((step.heading * DEG) % 360 + 360) % 360),
        headingAccuracyDeg: headingAccuracy.current >= 0 ? Math.round(headingAccuracy.current * DEG) : -1,
        lastStepLength: Math.round(step.length * est.stepScale * 100) / 100,
        biasDeg: Math.round(est.headingBias * DEG * 10) / 10,
        stepScale: Math.round(est.stepScale * 100) / 100,
        neff: Math.round(est.neff),
        mapConflicts: mapConflicts.current,
      });
    });

    return () => {
      rotSub?.remove();
      accSub?.remove();
      accelSub.remove();
    };
  }, [engine, recorder, publishEstimate]);

  // --- Actions ---
  const start = useCallback((p: Point) => {
    engine.start(p.x, p.y);
    engine.active = true;
    mapConflicts.current = 0;
    distance.current = 0;
    setDebug((d) => ({ ...d, steps: 0, distance: 0, mapConflicts: 0 }));
    recorder.push(['s', sensorTime.current, p.x, p.y]);
    setStarted(true);
    setPausedState(false);
    setPath([p]);
    publishEstimate();
  }, [engine, recorder, publishEstimate]);

  /** Manual fix: the position given by the user teaches the filter its bias and scale */
  const correct = useCallback((p: Point) => {
    const reinitialized = engine.correct(p.x, p.y);
    recorder.push(['c', sensorTime.current, p.x, p.y]);
    setPath((prev) => [...prev, p]);
    publishEstimate();
    return reinitialized;
  }, [engine, recorder, publishEstimate]);

  const setPaused = useCallback((value: boolean) => {
    engine.active = !value;
    setPausedState(value);
  }, [engine]);

  const reset = useCallback(() => {
    engine.active = true;
    setStarted(false);
    setPausedState(false);
    setPath([]);
    setNav({ position: null, displayAngle: 0, uncertaintyPx: 0, particles: [] });
  }, [engine]);

  const startRecording = useCallback(() => {
    recorder.start();
    // The current estimate is replayed as the starting point
    const est = engine.filter.isInitialized ? engine.filter.estimate() : null;
    if (est) recorder.push(['s', sensorTime.current, est.x, est.y]);
    setRecording(true);
  }, [engine, recorder]);

  const stopRecording = useCallback(() => {
    recorder.stop();
    setRecording(false);
    return recorder.toJSON(settingsRef.current.frame, MAP.id);
  }, [recorder]);

  return {
    started, paused, nav, path, compassDeg, magAccuracy, sensorError, wallsStatus, debug, recording,
    start, correct, setPaused, reset, startRecording, stopRecording,
  };
}
