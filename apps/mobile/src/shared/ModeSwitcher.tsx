import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, radius, spacing, typography} from '@rosapay/ui';
import {useAppStore, type AppMode} from '../state/appStore';

export function ModeSwitcher() {
  const {mode, merchantEnabled, setMode} = useAppStore();
  const options: AppMode[] = ['customer', 'merchant'];

  if (!merchantEnabled) {
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
            key={option}
            onPress={() => setMode(option)}
            style={[styles.option, selected && styles.selected]}>
            <Text style={[styles.label, selected && styles.selectedLabel]}>
              {option === 'customer' ? 'Wallet' : 'Merchant'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {alignSelf: 'flex-start', backgroundColor: colors.surfaceRaised, borderColor: colors.line, borderRadius: radius.round, borderWidth: 1, flexDirection: 'row', padding: 3},
  option: {alignItems: 'center', borderRadius: radius.round, justifyContent: 'center', minHeight: 30, paddingHorizontal: spacing.md},
  selected: {backgroundColor: colors.amberSoft},
  label: {...typography.label, color: colors.inkMuted, fontSize: 11},
  selectedLabel: {color: colors.amber},
});
