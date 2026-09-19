import {Check} from 'lucide-react-native';
import {Modal, Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, radius, spacing, typography} from '@rosapay/ui';
import {DISPLAY_CURRENCIES} from '../../shared/priceSource';

/**
 * Choosing the money a balance is read in.
 *
 * This replaced a control that cycled on every tap. Cycling is fine when there
 * are two of something and unusable at four: the options are invisible, getting
 * to the one you want means tapping past the ones you do not, and every tap
 * spends a rate lookup. Worse, nothing on screen ever said what the choices
 * were — someone who wanted euros had no way to know euros existed.
 *
 * So the options are shown and one is picked. Tapping outside changes nothing,
 * which is the other half of what a person means by "it should not change
 * unless I change it".
 */
export function CurrencyPicker({
  onClose,
  onSelect,
  selected,
  visible,
}: {
  onClose(): void;
  onSelect(code: string): void;
  selected: string;
  visible: boolean;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible={visible}>
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.scrim} testID="currency-picker-scrim">
        {/* Stops a tap inside the sheet from closing it. */}
        <Pressable onPress={() => undefined} style={styles.sheet}>
          <Text style={styles.title}>Show balance in</Text>
          {DISPLAY_CURRENCIES.map(currency => {
            const active = currency.code === selected;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{selected: active}}
                key={currency.code}
                onPress={() => {
                  onSelect(currency.code);
                  onClose();
                }}
                style={[styles.option, active && styles.optionSelected]}
                testID={`currency-option-${currency.code}`}>
                <Text style={styles.flag}>{currency.flag}</Text>
                <View style={styles.copy}>
                  <Text style={styles.code}>{currency.code}</Text>
                  <Text style={styles.name}>{currency.name}</Text>
                </View>
                {active ? <Check color={colors.goldBright} size={20} strokeWidth={2.6} /> : null}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
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
  flag: {fontSize: 26},
  copy: {flex: 1},
  code: {...typography.body, color: colors.ink, fontSize: 17, fontWeight: '600'},
  name: {...typography.body, color: colors.inkMuted, fontSize: 13},
});
