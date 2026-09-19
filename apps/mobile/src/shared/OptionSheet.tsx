import {Check} from 'lucide-react-native';
import {Modal, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {colors, radius, spacing, typography} from '@rosapay/ui';

export type SheetOption = {
  /** What is passed back on selection, and what marks the current choice. */
  value: string;
  /** The short form: a currency code, an asset code. */
  label: string;
  /** What it means, one line. */
  detail?: string;
  /** A flag or symbol carried beside the label. */
  glyph?: string;
};

/**
 * Picking one of a handful of things, shown rather than cycled.
 *
 * A control that cycles on every tap is fine for two options and unusable at
 * six: the choices are invisible, reaching the one you want means tapping past
 * the ones you do not, and on a priced request every tap spends a rate lookup.
 * Worse, nothing on screen ever says what the choices are — someone who wanted
 * euros had no way to learn that euros existed.
 *
 * Tapping outside changes nothing, which is the other half of what a person
 * means by "it should not change unless I change it". The list scrolls because
 * the number of options is not fixed: it is however many currencies something
 * will quote today, plus the assets this deployment settles.
 */
export function OptionSheet({
  onClose,
  onSelect,
  options,
  selected,
  testIDPrefix,
  title,
  visible,
}: {
  onClose(): void;
  onSelect(value: string): void;
  options: readonly SheetOption[];
  selected: string;
  testIDPrefix: string;
  title: string;
  visible: boolean;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible={visible}>
      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        style={styles.scrim}
        testID={`${testIDPrefix}-scrim`}>
        {/* Stops a tap inside the sheet from closing it. */}
        <Pressable onPress={() => undefined} style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView bounces={false} style={styles.list}>
            {options.map(option => {
              const active = option.value === selected;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{selected: active}}
                  key={option.value}
                  onPress={() => {
                    onSelect(option.value);
                    onClose();
                  }}
                  style={[styles.option, active && styles.optionSelected]}
                  testID={`${testIDPrefix}-option-${option.value}`}>
                  {option.glyph ? <Text style={styles.glyph}>{option.glyph}</Text> : null}
                  <View style={styles.copy}>
                    <Text style={styles.code}>{option.label}</Text>
                    {option.detail ? <Text style={styles.name}>{option.detail}</Text> : null}
                  </View>
                  {active ? <Check color={colors.goldBright} size={20} strokeWidth={2.6} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** The closed control that opens the sheet, showing what is currently chosen. */
export function OptionField({
  glyph,
  label,
  onPress,
  testID,
  value,
}: {
  glyph?: string;
  label: string;
  onPress(): void;
  testID: string;
  value: string;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable accessibilityRole="button" onPress={onPress} style={styles.field} testID={testID}>
        {glyph ? <Text style={styles.fieldGlyph}>{glyph}</Text> : null}
        <Text style={styles.fieldValue}>{value}</Text>
        <Text style={styles.chevron}>⌄</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {backgroundColor: 'rgba(0,0,0,0.62)', flex: 1, justifyContent: 'flex-end'},
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    gap: spacing.xs,
    paddingBottom: spacing.huge,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  // Tall enough to show the options without the sheet owning the whole screen.
  list: {maxHeight: 420},
  title: {...typography.label, color: colors.inkMuted, marginBottom: spacing.xs},
  option: {
    alignItems: 'center',
    borderRadius: radius.lg,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 60,
    paddingHorizontal: spacing.md,
  },
  optionSelected: {backgroundColor: colors.goldSoft},
  glyph: {fontSize: 26},
  copy: {flex: 1},
  code: {...typography.body, color: colors.ink, fontSize: 17, fontWeight: '600'},
  name: {...typography.body, color: colors.inkMuted, fontSize: 13},

  fieldWrap: {gap: spacing.xs},
  fieldLabel: {...typography.overline, color: colors.inkMuted, fontSize: 10, letterSpacing: 1.2},
  field: {
    alignItems: 'center',
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 54,
    paddingHorizontal: spacing.md,
  },
  fieldGlyph: {fontSize: 20},
  fieldValue: {...typography.body, color: colors.ink, flex: 1, fontSize: 16, fontWeight: '600'},
  chevron: {color: colors.inkMuted, fontSize: 20, lineHeight: 20},
});
