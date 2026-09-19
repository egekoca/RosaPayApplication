import type {ReactNode} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, radius, spacing, typography} from './theme';

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
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  primary: {backgroundColor: colors.amber},
  secondary: {backgroundColor: colors.surface, borderColor: colors.amber, borderWidth: 1},
  ghost: {backgroundColor: 'transparent'},
  pressed: {opacity: 0.82},
  disabled: {opacity: 0.45},
  labelWrap: {flexShrink: 1},
  label: {...typography.label, color: colors.ink, textAlign: 'center'},
  primaryLabel: {color: colors.black},
});
