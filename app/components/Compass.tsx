// SPDX-License-Identifier: AGPL-3.0-or-later
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from './ui';

interface CompassProps {
  /** Phone heading (°, 0 = North, clockwise) */
  heading: number;
}

const CARDINALS: [string, number][] = [
  ['N', 0],
  ['E', 90],
  ['S', 180],
  ['W', 270],
];

const SIZE = 64;
const BORDER = 1;
const LETTER = 14;
const RADIUS = SIZE / 2 - 11;

/**
 * Rotating compass rose: the fixed mark at the top shows where the phone points, the red arrow
 * points north (like a hiking compass).
 */
export default function Compass({ heading }: CompassProps) {
  const c = SIZE / 2 - BORDER;
  return (
    <View style={styles.container}>
      <View style={styles.dial}>
        <View style={[styles.rose, { transform: [{ rotate: `${-heading}deg` }] }]}>
          <View style={[styles.needle, { left: c - 4, top: c - 13 }]} />
          {CARDINALS.map(([label, deg]) => {
            const a = (deg * Math.PI) / 180;
            return (
              <Text
                key={label}
                style={[
                  styles.cardinal,
                  label === 'N' && styles.north,
                  {
                    left: c + RADIUS * Math.sin(a) - LETTER / 2,
                    top: c - RADIUS * Math.cos(a) - LETTER / 2,
                    transform: [{ rotate: `${deg}deg` }],
                  },
                ]}
              >
                {label}
              </Text>
            );
          })}
        </View>
        <View style={styles.lubber} />
      </View>
      <Text style={styles.degrees}>{Math.round(heading) % 360}°</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  dial: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: BORDER,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    alignItems: 'center',
    elevation: 6,
  },
  rose: { position: 'absolute', left: 0, top: 0, width: SIZE - 2 * BORDER, height: SIZE - 2 * BORDER },
  lubber: { position: 'absolute', top: 2, width: 3, height: 7, borderRadius: 2, backgroundColor: theme.text },
  needle: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderBottomWidth: 13,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: theme.danger,
  },
  cardinal: {
    position: 'absolute',
    width: LETTER,
    height: LETTER,
    lineHeight: LETTER,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: theme.muted,
  },
  north: { color: theme.danger },
  degrees: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '600',
    color: theme.text,
    backgroundColor: theme.surface,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
});
