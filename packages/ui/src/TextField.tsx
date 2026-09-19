import {useState} from 'react';
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
  // A field that never changes when you tap it leaves you unsure it took focus.
  const [focused, setFocused] = useState(false);
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
        onBlur={() => setFocused(false)}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        placeholderTextColor={colors.inkMuted}
        style={[
          styles.input,
          mono && styles.mono,
          multiline && styles.multiline,
          focused && styles.inputFocused,
          !!error && styles.inputError,
        ]}
        testID={testID}
        value={value}
      />
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {gap: spacing.sm},
  label: {...typography.label, color: colors.inkMuted, fontSize: 12},
  input: {
    backgroundColor: colors.surfaceSunken,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 16,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  inputFocused: {backgroundColor: colors.surface, borderColor: colors.amber},
  inputError: {borderColor: colors.danger},
  multiline: {minHeight: 78, textAlignVertical: 'top'},
  mono: {...typography.mono, fontSize: 12},
  hint: {color: colors.inkMuted, fontSize: 12, lineHeight: 17},
  error: {...typography.label, color: colors.danger, fontSize: 12},
});
