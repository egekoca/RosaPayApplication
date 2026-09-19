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
  /**
   * A field that shows a value the customer cannot change - an address the
   * wallet already decided, say. It stays readable rather than being hidden,
   * because the value is the point.
   */
  editable?: boolean;
  /**
   * Off everywhere by default. Autocorrect turns an address or an email into
   * something that looks almost right, which is the worst way for either to be
   * wrong, so a caller has to ask for it deliberately.
   */
  autoCorrect?: boolean;
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
  editable = true,
  autoCorrect = false,
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
        autoCorrect={autoCorrect}
        editable={editable}
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
          !editable && styles.inputReadOnly,
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
  // Dimmed rather than greyed out: the value still has to be readable, because
  // it is usually the thing the screen is asking the customer to check.
  inputReadOnly: {color: colors.inkMuted},
  inputError: {borderColor: colors.danger},
  multiline: {minHeight: 78, textAlignVertical: 'top'},
  mono: {...typography.mono, fontSize: 12},
  hint: {color: colors.inkMuted, fontSize: 12, lineHeight: 17},
  error: {...typography.label, color: colors.danger, fontSize: 12},
});
