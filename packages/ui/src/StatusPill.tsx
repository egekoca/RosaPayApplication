import {StyleSheet, Text, View} from 'react-native';
import {colors, radius, spacing, typography} from './theme';

type StatusPillProps = {
  children: string;
  tone?: 'success' | 'pending' | 'danger' | 'neutral';
};

export function StatusPill({children, tone = 'neutral'}: StatusPillProps) {
  return (
    <View style={[styles.pill, styles[`${tone}Pill`]]}>
      <View style={[styles.dot, styles[`${tone}Dot`]]} />
      <Text style={[styles.text, styles[`${tone}Text`]]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {alignItems: 'center', borderRadius: radius.round, flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 5},
  dot: {borderRadius: radius.round, height: 6, width: 6},
  text: {...typography.label, fontSize: 11, lineHeight: 14},
  successPill: {backgroundColor: colors.successSoft},
  successDot: {backgroundColor: colors.success},
  successText: {color: colors.success},
  pendingPill: {backgroundColor: colors.amberSoft},
  pendingDot: {backgroundColor: colors.amber},
  pendingText: {color: colors.amber},
  dangerPill: {backgroundColor: colors.dangerSoft},
  dangerDot: {backgroundColor: colors.danger},
  dangerText: {color: colors.danger},
  neutralPill: {backgroundColor: colors.surfaceRaised},
  neutralDot: {backgroundColor: colors.inkMuted},
  neutralText: {color: colors.inkMuted},
});
