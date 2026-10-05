// SPDX-License-Identifier: AGPL-3.0-or-later
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Switch,
  Modal,
  StyleSheet,
  Alert,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Directory, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { Settings } from '../hooks/useSettings';
import type { Point } from '../hooks/useNavigation';
import type { Recording } from '../lib/nav/recording';
import { MAP } from '../lib/mapPack';
import { expo as appConfig } from '../app.json';
import { PillButton, theme } from './ui';

const REPOSITORY = 'https://github.com/HueyNemud/GPSnt';

interface SettingsSheetProps {
  visible: boolean;
  onClose: () => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  path: Point[];
  recording: boolean;
  startRecording: () => void;
  stopRecording: () => Recording;
}

/** Writes a JSON file to documents/gpsnt-exports and offers to share it */
async function exportJson(prefix: string, data: unknown) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${prefix}-${timestamp}.json`;
  const dir = new Directory(Paths.document, 'gpsnt-exports');
  if (!dir.exists) dir.create();
  const file = dir.createFile(filename, 'application/json');
  file.write(JSON.stringify(data));
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: filename, UTI: 'public.json' });
  } else {
    Alert.alert('Saved', `${filename}\n\n${file.uri}`);
  }
}

const NUMERIC_FIELDS = [
  { key: 'pixelsPerMeter', section: 'map', label: 'Scale', unit: 'px/m', min: 0.01, max: 1000 },
  { key: 'mapNorthDeg', section: 'map', label: 'Map north', unit: '°', min: -180, max: 180 },
  { key: 'declinationDeg', section: 'map', label: 'Magnetic declination', unit: '°', min: -30, max: 30 },
  { key: 'stepK', section: 'walk', label: 'Step constant K', unit: '', min: 0.1, max: 1.5 },
] as const;

type NumericKey = (typeof NUMERIC_FIELDS)[number]['key'];
type SwitchKey = 'useMagnetometer' | 'useWalls' | 'showParticles' | 'showWalls' | 'useDarkMap';

function getNumeric(s: Settings, key: NumericKey): number {
  return key === 'stepK' ? s.stepK : s.frame[key];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.group}>{children}</View>
    </View>
  );
}

function Row({ label, hint, children, last }: { label: string; hint?: string; children: React.ReactNode; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowDivider]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint && <Text style={styles.rowHint}>{hint}</Text>}
      </View>
      {children}
    </View>
  );
}

/**
 * Settings panel (bottom sheet). Switches apply immediately; numeric values are applied by
 * "Done" and discarded if the sheet is closed any other way.
 */
export default function SettingsSheet({
  visible,
  onClose,
  settings,
  setSettings,
  path,
  recording,
  startRecording,
  stopRecording,
}: SettingsSheetProps) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<Record<NumericKey, string>>({} as Record<NumericKey, string>);

  useEffect(() => {
    if (!visible) return;
    const d = {} as Record<NumericKey, string>;
    for (const f of NUMERIC_FIELDS) d[f.key] = String(getNumeric(settings, f.key));
    setDraft(d);
    // The draft is only reloaded when the sheet opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleDone = () => {
    const next: Settings = { ...settings, frame: { ...settings.frame } };
    for (const f of NUMERIC_FIELDS) {
      const v = parseFloat((draft[f.key] ?? '').replace(',', '.'));
      if (isNaN(v) || v < f.min || v > f.max) {
        Alert.alert('Invalid value', `${f.label}: expected a number between ${f.min} and ${f.max}.`);
        return;
      }
      if (f.key === 'stepK') next.stepK = v;
      else next.frame[f.key] = v;
    }
    setSettings(next);
    onClose();
  };

  const toggle = (key: SwitchKey) => (value: boolean) => setSettings({ ...settings, [key]: value });

  const run = (fn: () => Promise<void>) => () =>
    fn().catch((error: any) => Alert.alert('Error', `Export failed: ${error?.message ?? String(error)}`));

  const handleExportPath = run(() =>
    exportJson('gpsnt-path', { timestamp: new Date().toISOString(), mapId: MAP.id, frame: settings.frame, pointCount: path.length, path }),
  );

  const handleRecording = recording ? run(() => exportJson('gpsnt-recording', stopRecording())) : startRecording;

  const numericRow = (section: 'map' | 'walk') => {
    const fields = NUMERIC_FIELDS.filter((f) => f.section === section);
    return fields.map((f, i) => (
      <Row key={f.key} label={f.label} last={i === fields.length - 1}>
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            value={draft[f.key]}
            onChangeText={(t) => setDraft({ ...draft, [f.key]: t })}
            keyboardType="numbers-and-punctuation"
            selectTextOnFocus
          />
          {f.unit !== '' && <Text style={styles.unit}>{f.unit}</Text>}
        </View>
      </Row>
    ));
  };

  const switchRow = (key: SwitchKey, label: string, hint?: string, last?: boolean) => (
    <Row label={label} hint={hint} last={last}>
      <Switch
        value={settings[key]}
        onValueChange={toggle(key)}
        trackColor={{ false: '#3F3F46', true: theme.accent }}
        thumbColor="#fff"
      />
    </Row>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Settings</Text>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
            <Section title="Map">{numericRow('map')}</Section>
            <Section title="Walk">{numericRow('walk')}</Section>
            <Section title="Navigation">
              {switchRow('useMagnetometer', 'Magnetic compass', 'Turn off if the heading is disturbed')}
              {switchRow('useWalls', 'Constrain with walls', undefined, true)}
            </Section>
            <Section title="Display">
              {switchRow('useDarkMap', 'Dark map')}
              {switchRow('showWalls', 'Walkable areas', 'Wall mask used for tracking, in green')}
              {switchRow('showParticles', 'Particle cloud', undefined, true)}
            </Section>
            <Section title="Data">
              <Pressable
                onPress={handleExportPath}
                disabled={path.length === 0}
                style={({ pressed }) => [styles.action, styles.rowDivider, pressed && { opacity: 0.6 }]}
              >
                <Text style={[styles.actionText, path.length === 0 && { color: theme.muted }]}>
                  Export path
                </Text>
                <Text style={styles.rowHint}>{path.length} points</Text>
              </Pressable>
              <Pressable onPress={handleRecording} style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}>
                <Text style={[styles.actionText, recording && { color: theme.danger }]}>
                  {recording ? 'Stop and export recording' : 'Record sensors'}
                </Text>
                {recording && <View style={styles.recDot} />}
              </Pressable>
            </Section>
            <Section title="About">
              <Row label="Map" hint={MAP.attribution || undefined}>
                <Text style={styles.value}>{MAP.name}</Text>
              </Row>
              <Pressable
                onPress={() => Linking.openURL(REPOSITORY)}
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionText}>GPSn't {appConfig.version}</Text>
                  <Text style={styles.rowHint}>Free software under the GNU AGPL v3 · source code on GitHub</Text>
                </View>
              </Pressable>
            </Section>
          </ScrollView>

          <PillButton label="Done" onPress={handleDone} style={{ marginTop: 8 }} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    maxHeight: '88%',
    backgroundColor: theme.surfaceSolid,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#3F3F46', marginBottom: 8 },
  header: { paddingHorizontal: 4, paddingVertical: 8 },
  title: { color: theme.text, fontSize: 22, fontWeight: '700' },
  section: { marginTop: 14 },
  sectionTitle: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 6,
    marginLeft: 4,
  },
  group: { backgroundColor: theme.surfaceRaised, borderRadius: 14, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingVertical: 8, gap: 12 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.1)' },
  rowLabel: { color: theme.text, fontSize: 15 },
  rowHint: { color: theme.muted, fontSize: 12, marginTop: 2 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: {
    minWidth: 72,
    color: theme.text,
    fontSize: 15,
    textAlign: 'right',
    backgroundColor: '#2E2E35',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  unit: { color: theme.muted, fontSize: 13, minWidth: 30 },
  value: { color: theme.muted, fontSize: 15 },
  action: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52 },
  actionText: { color: theme.accent, fontSize: 15, fontWeight: '500' },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.danger },
});
