import type {ReactNode} from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import {colors, elevation, radius, spacing} from './theme';

type SurfaceCardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  accent?: 'none' | 'amber' | 'rose' | 'success';
};

export function SurfaceCard({children, style, padded = true, accent = 'none'}: SurfaceCardProps) {
  return <View style={[styles.card, padded && styles.padded, accent !== 'none' && styles[accent], style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.lineSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    ...elevation.card,
  },
  padded: {padding: spacing.xl},
  amber: {borderTopColor: colors.amber, borderTopWidth: 2},
  rose: {borderTopColor: colors.rose, borderTopWidth: 2},
  success: {borderTopColor: colors.success, borderTopWidth: 2},
});
