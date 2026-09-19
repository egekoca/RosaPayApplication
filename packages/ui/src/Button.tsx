import type {ReactNode} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import {GoldFill} from './GoldFill';
import {colors, elevation, radius, spacing, typography} from './theme';

type ButtonProps = {
  children: ReactNode;
  onPress: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  tone?: 'primary' | 'secondary' | 'ghost';
  testID?: string;
};

export function Button({
  children,
  onPress,
  icon,
  disabled = false,
  loading = false,
  tone = 'primary',
  testID,
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      testID={testID}
      style={({pressed}) => [
        styles.base,
        styles[tone],
        pressed && styles.pressed,
        (disabled || loading) && styles.disabled,
      ]}>
      {tone === 'primary' ? <GoldFill /> : null}
      {loading ? <ActivityIndicator color={tone === 'primary' ? colors.black : colors.ink} /> : icon}
      <View style={styles.labelWrap}>
        <Text style={[styles.label, tone === 'primary' && styles.primaryLabel]}>{children}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: radius.lg,
    // The gold fill is an absolute child, so it has to be clipped to the corners.
    overflow: 'hidden',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.xl,
  },
  /*
   * A shadow, not a halo. The button used to cast its own colour outward at
   * 0.22, which puts a glow around it — the thing that separates a mockup from
   * a product. Gold on black is already the brightest object on the screen and
   * does not need help being found.
   */
  primary: {backgroundColor: colors.gold, ...elevation.card, shadowOpacity: 0.3},
  secondary: {backgroundColor: colors.surfaceRaised, borderColor: colors.line, borderWidth: 1},
  ghost: {backgroundColor: 'transparent'},
  // A press should feel like the control moved, not like it faded out.
  pressed: {opacity: 0.9, transform: [{scale: 0.985}]},
  disabled: {opacity: 0.4},
  labelWrap: {flexShrink: 1},
  label: {...typography.label, color: colors.ink, fontSize: 15, textAlign: 'center'},
  primaryLabel: {color: colors.black},
});
