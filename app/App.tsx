// SPDX-License-Identifier: AGPL-3.0-or-later
import React, { useRef, useState } from 'react';
import { StyleSheet, View, Text, Alert, Pressable } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { MapViewHandle } from './components/MapView';
import Compass from './components/Compass';
import SettingsSheet from './components/SettingsSheet';
import { Card, IconButton, PillButton, theme } from './components/ui';
import useSettings from './hooks/useSettings';
import useNavigation, { Point } from './hooks/useNavigation';

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function Main() {
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useSettings();
  const [follow, setFollow] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const map = useRef<MapViewHandle>(null);
  const navigation = useNavigation(settings);
  const { started, paused, nav, path, debug, compassDeg } = navigation;
  const ppm = settings.frame.pixelsPerMeter;

  const handleMapTap = (p: Point) => {
    if (!started) {
      navigation.start(p);
      setFollow(true);
      return;
    }
    Alert.alert('Fix your position?', 'Are you here? Heading and step length will be adjusted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Fix',
        onPress: () => {
          if (navigation.correct(p)) {
            Alert.alert('Position reset', 'The error was too large: tracking restarts from this point.');
          }
        },
      },
    ]);
  };

  const handleStop = () => {
    Alert.alert('End this walk?', 'The displayed path will be cleared.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'End', style: 'destructive', onPress: navigation.reset },
    ]);
  };

  const warnings: string[] = [];
  if (navigation.sensorError) warnings.push(navigation.sensorError);
  if (settings.useMagnetometer && navigation.magAccuracy <= 1) {
    warnings.push('Compass poorly calibrated: wave the phone in a figure 8');
  }
  if (settings.useWalls && navigation.wallsStatus === 'error') warnings.push('Map walls unavailable');

  return (
    <View style={styles.root}>
      <StatusBar style={settings.useDarkMap ? 'light' : 'dark'} />

      <MapView
        ref={map}
        nav={nav}
        path={path}
        useDarkMap={settings.useDarkMap}
        showWalls={settings.showWalls}
        follow={follow}
        onFollowChange={setFollow}
        onMapTap={handleMapTap}
      />

      {/* Top: stats on the left, compass on the right */}
      <View style={[styles.top, { top: insets.top + 12 }]} pointerEvents="box-none">
        <View style={styles.topLeft} pointerEvents="box-none">
          {started && (
            <Pressable
              onPress={() => setShowDetails((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={showDetails ? 'Hide details' : 'Show details'}
              style={({ pressed }) => pressed && { opacity: 0.8 }}
            >
              <Card style={styles.stats}>
                <Text style={styles.distance}>{formatDistance(debug.distance)}</Text>
                <Text style={styles.statsSub}>
                  {debug.steps} steps · ±{(nav.uncertaintyPx / ppm).toFixed(1)} m
                </Text>
                {(paused || navigation.recording) && (
                  <View style={styles.chips}>
                    {paused && <Text style={[styles.chip, { color: theme.warning }]}>Paused</Text>}
                    {navigation.recording && <Text style={[styles.chip, { color: theme.danger }]}>● Rec.</Text>}
                  </View>
                )}
                {showDetails && (
                  <View style={styles.details}>
                    <Detail label="Heading" value={`${debug.headingDeg}°${debug.headingAccuracyDeg >= 0 ? ` ±${debug.headingAccuracyDeg}°` : ''}`} />
                    <Detail label="Last step" value={`${debug.lastStepLength} m`} />
                    <Detail label="Heading bias" value={`${debug.biasDeg}°`} />
                    <Detail label="Step scale" value={`×${debug.stepScale}`} />
                    <Detail label="Eff. particles" value={String(debug.neff)} />
                    {settings.useWalls && (
                      <Detail label="Walls" value={`${navigation.wallsStatus} · ${debug.mapConflicts} conflicts`} />
                    )}
                  </View>
                )}
              </Card>
            </Pressable>
          )}

          {warnings.map((w) => (
            <Text key={w} style={styles.warning} pointerEvents="none">
              {w}
            </Text>
          ))}
        </View>

        <View pointerEvents="none">
          <Compass heading={compassDeg} />
        </View>
      </View>

      {/* Right: zoom and re-centre */}
      <View style={[styles.side, { bottom: insets.bottom + 104 }]} pointerEvents="box-none">
        {started && !follow && (
          <IconButton icon="locate" onPress={() => setFollow(true)} accessibilityLabel="Re-centre" style={{ marginBottom: 12 }} />
        )}
        <Card style={styles.zoom}>
          <IconButton icon="plus" onPress={() => map.current?.zoom(1.6)} accessibilityLabel="Zoom in" style={styles.zoomButton} />
          <View style={styles.zoomDivider} />
          <IconButton icon="minus" onPress={() => map.current?.zoom(1 / 1.6)} accessibilityLabel="Zoom out" style={styles.zoomButton} />
        </Card>
      </View>

      {/* Bottom: start prompt or navigation controls */}
      <View style={[styles.bottom, { bottom: insets.bottom + 16 }]} pointerEvents="box-none">
        {!started ? (
          <Card style={styles.prompt}>
            <View style={{ flex: 1 }}>
              <Text style={styles.promptTitle}>Where are you?</Text>
              <Text style={styles.promptText}>Tap the map at your starting point.</Text>
            </View>
            <IconButton icon="settings" onPress={() => setSettingsOpen(true)} accessibilityLabel="Settings" style={styles.flat} />
          </Card>
        ) : (
          <View style={styles.controls}>
            <IconButton icon="settings" onPress={() => setSettingsOpen(true)} accessibilityLabel="Settings" style={styles.round} />
            {paused ? (
              <PillButton label="Resume" icon="play" onPress={() => navigation.setPaused(false)} style={styles.main} />
            ) : (
              <PillButton
                label="Pause"
                icon="pause"
                variant="secondary"
                onPress={() => navigation.setPaused(true)}
                style={styles.main}
              />
            )}
            {paused ? (
              <IconButton icon="stop" onPress={handleStop} accessibilityLabel="End walk" style={[styles.round, styles.stop]} />
            ) : (
              <View style={styles.round} />
            )}
          </View>
        )}
      </View>

      <SettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        setSettings={setSettings}
        path={path}
        recording={navigation.recording}
        startRecording={navigation.startRecording}
        stopRecording={navigation.stopRecording}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0B0D' },

  top: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  topLeft: { flex: 1, alignItems: 'flex-start', gap: 8 },
  stats: { paddingHorizontal: 16, paddingVertical: 10 },
  distance: { color: theme.text, fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statsSub: { color: theme.muted, fontSize: 13, marginTop: 1, fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', gap: 10, marginTop: 6 },
  chip: { fontSize: 12, fontWeight: '600' },
  warning: {
    color: '#1C1917',
    backgroundColor: theme.warning,
    fontSize: 13,
    fontWeight: '500',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    overflow: 'hidden',
    maxWidth: 280,
  },
  details: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.15)',
    gap: 3,
    minWidth: 190,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  detailLabel: { color: theme.muted, fontSize: 12 },
  detailValue: { color: theme.text, fontSize: 12, fontWeight: '500', fontVariant: ['tabular-nums'] },

  side: { position: 'absolute', right: 16, alignItems: 'center' },
  zoom: { borderRadius: 24, overflow: 'hidden' },
  zoomButton: { backgroundColor: 'transparent', borderWidth: 0, elevation: 0, shadowOpacity: 0 },
  zoomDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.15)' },

  bottom: { position: 'absolute', left: 16, right: 16 },
  prompt: { flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 8, paddingVertical: 14 },
  promptTitle: { color: theme.text, fontSize: 17, fontWeight: '700' },
  promptText: { color: theme.muted, fontSize: 14, marginTop: 2 },
  flat: { backgroundColor: theme.surfaceRaised, borderWidth: 0, elevation: 0, shadowOpacity: 0 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  round: { width: 52, height: 52, borderRadius: 26 },
  main: { flex: 1 },
  stop: { backgroundColor: theme.danger },
});
