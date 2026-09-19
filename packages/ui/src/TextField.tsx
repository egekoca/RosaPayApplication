import {StyleSheet, Text, TextInput, View, type KeyboardTypeOptions} from 'react-native';
import {colors, radius, spacing, typography} from './theme';

type TextFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  autoCapitalize?: 'none' | 'characters' | 'words' | 'sentences';
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  mono?: boolean;
  multiline?: boolean;
  testID?: string;
};

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  autoCapitalize = 'sentences',
  keyboardType,
  maxLength,
  mono = false,
  multiline = false,
  testID,
}: TextFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        maxLength={maxLength}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.inkMuted}
        style={[styles.input, mono && styles.mono, multiline && styles.multiline, !!error && styles.inputError]}
        testID={testID}
        value={value}
      />
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {gap: spacing.xs},
  label: {...typography.label, color: colors.inkMuted, fontSize: 12},
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 16,
    minHeight: 50,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  inputError: {borderColor: colors.danger},
  multiline: {minHeight: 78, textAlignVertical: 'top'},
  mono: {...typography.mono, fontSize: 12},
  hint: {color: colors.inkMuted, fontSize: 12, lineHeight: 17},
  error: {...typography.label, color: colors.danger, fontSize: 12},
});
