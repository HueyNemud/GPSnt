// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Theme and UI primitives (buttons, icons, floating cards).
 * Icons are drawn with Views: no icon font and no extra native module.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle, StyleProp } from 'react-native';

export const theme = {
  // Opaque: on Android the shadow (elevation) shows through a translucent background
  surface: '#1C1C21',
  surfaceSolid: '#18181C',
  surfaceRaised: '#232329',
  border: 'rgba(255,255,255,0.08)',
  text: '#F4F4F5',
  muted: '#A1A1AA',
  accent: '#3B82F6',
  danger: '#EF4444',
  warning: '#F59E0B',
  radius: 18,
};

/** Floating card above the map */
export function Card({ style, children }: { style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

type IconName = 'plus' | 'minus' | 'pause' | 'play' | 'stop' | 'locate' | 'settings';

export function Icon({ name, color = theme.text, size = 22 }: { name: IconName; color?: string; size?: number }) {
  const s = size;
  const box = { width: s, height: s, alignItems: 'center', justifyContent: 'center' } as const;
  const bar = (w: number, h: number, extra: ViewStyle = {}) => (
    <View style={[{ width: w, height: h, borderRadius: Math.min(w, h) / 2, backgroundColor: color }, extra]} />
  );
  switch (name) {
    case 'plus':
      return (
        <View style={box}>
          {bar(s * 0.7, 2)}
          {bar(2, s * 0.7, { position: 'absolute' })}
        </View>
      );
    case 'minus':
      return <View style={box}>{bar(s * 0.7, 2)}</View>;
    case 'pause':
      return (
        <View style={[box, { flexDirection: 'row', gap: s * 0.2 }]}>
          {bar(s * 0.2, s * 0.65)}
          {bar(s * 0.2, s * 0.65)}
        </View>
      );
    case 'play':
      return (
        <View style={box}>
          <View
            style={{
              marginLeft: s * 0.12,
              borderLeftWidth: s * 0.55,
              borderTopWidth: s * 0.34,
              borderBottomWidth: s * 0.34,
              borderLeftColor: color,
              borderTopColor: 'transparent',
              borderBottomColor: 'transparent',
            }}
          />
        </View>
      );
    case 'stop':
      return (
        <View style={box}>
          <View style={{ width: s * 0.55, height: s * 0.55, borderRadius: 3, backgroundColor: color }} />
        </View>
      );
    case 'locate':
      return (
        <View style={box}>
          {bar(s, 2, { position: 'absolute' })}
          {bar(2, s, { position: 'absolute' })}
          <View
            style={{
              width: s * 0.66,
              height: s * 0.66,
              borderRadius: s,
              borderWidth: 2,
              borderColor: color,
              backgroundColor: theme.surfaceSolid,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {bar(s * 0.22, s * 0.22)}
          </View>
        </View>
      );
    case 'settings':
      // Three sliders
      return (
        <View style={[box, { gap: s * 0.16 }]}>
          {[0.25, 0.65, 0.4].map((k, i) => (
            <View key={i} style={{ width: s * 0.8, height: s * 0.2, justifyContent: 'center' }}>
              {bar(s * 0.8, 2)}
              <View
                style={{
                  position: 'absolute',
                  left: s * 0.8 * k - s * 0.1,
                  width: s * 0.2,
                  height: s * 0.2,
                  borderRadius: s,
                  backgroundColor: color,
                }}
              />
            </View>
          ))}
        </View>
      );
  }
}

/** Round button (icon only) */
export function IconButton({
  icon,
  onPress,
  style,
  accessibilityLabel,
}: {
  icon: IconName;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed, style]}
    >
      <Icon name={icon} />
    </Pressable>
  );
}

/** Pill button with a label */
export function PillButton({
  label,
  icon,
  onPress,
  variant = 'primary',
  style,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  style?: StyleProp<ViewStyle>;
}) {
  const bg = variant === 'primary' ? theme.accent : variant === 'danger' ? theme.danger : theme.surfaceRaised;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.pill, { backgroundColor: bg }, pressed && styles.pressed, style]}
    >
      {icon && <Icon name={icon} size={18} color="#fff" />}
      <Text style={styles.pillText}>{label}</Text>
    </Pressable>
  );
}

const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.35,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 6,
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    ...shadow,
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  pill: {
    height: 52,
    paddingHorizontal: 22,
    borderRadius: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    ...shadow,
  },
  pillText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
});
