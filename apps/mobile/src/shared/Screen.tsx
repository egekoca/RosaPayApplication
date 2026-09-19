import type {ReactNode} from 'react';
import {ScrollView, StyleSheet, type ViewStyle} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors, spacing} from '@rosapay/ui';

export function Screen({children, contentStyle}: {children: ReactNode; contentStyle?: ViewStyle}) {
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, contentStyle]}>{children}</ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.canvas},
  content: {flexGrow: 1, gap: spacing.lg, paddingBottom: spacing.xxl, paddingHorizontal: spacing.xl, paddingTop: spacing.lg},
});
