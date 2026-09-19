import {QrCode, ScanLine} from 'lucide-react-native';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, radius, spacing, typography} from '@rosapay/ui';
import {useAppStore, type AppMode} from '../state/appStore';

export function ModeSwitcher() {
  const {mode, merchantProfile, setMode} = useAppStore();
  const options: AppMode[] = ['customer', 'merchant'];

  if (!merchantProfile) {
    return null;
  }
  return (
    <View accessibilityRole="tablist" style={styles.container}>
      {options.map(option => {
        const selected = option === mode;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{selected}}
            accessibilityLabel={option === 'customer' ? 'Pay' : 'Get paid'}
            key={option}
            onPress={() => setMode(option)}
            style={[styles.option, selected && styles.selected]}
            testID={`mode-${option}`}>
            <View style={[styles.icon, selected && styles.selectedIcon]}>
              {option === 'customer' ? (
                <ScanLine color={selected ? colors.goldBright : colors.inkMuted} size={17} />
              ) : (
                <QrCode color={selected ? colors.goldBright : colors.inkMuted} size={17} />
              )}
            </View>
            <Text style={[styles.label, selected && styles.selectedLabel]}>
              {option === 'customer' ? 'Pay' : 'Get paid'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: 4,
  },
  option: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  selected: {backgroundColor: colors.goldSoft, borderColor: colors.goldDeep},
  icon: {alignItems: 'center', justifyContent: 'center'},
  selectedIcon: {transform: [{scale: 1.05}]},
  label: {...typography.label, color: colors.inkMuted, fontSize: 13},
  selectedLabel: {color: colors.goldBright},
});
