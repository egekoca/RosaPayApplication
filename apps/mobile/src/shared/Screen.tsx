import type {ReactNode} from 'react';
import {ScrollView, StyleSheet, useWindowDimensions, View, type ViewStyle} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors, spacing} from '@rosapay/ui';

export function Screen({children, contentStyle}: {children: ReactNode; contentStyle?: ViewStyle}) {
  const {width} = useWindowDimensions();
  const horizontalPadding = width < 360 ? spacing.lg : width >= 600 ? spacing.xxl : spacing.xl;
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, {maxWidth: 720, paddingHorizontal: horizontalPadding, width: '100%'}, contentStyle]}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {backgroundColor: colors.canvas, flex: 1, overflow: 'hidden'},
  content: {alignSelf: 'center', flexGrow: 1, gap: spacing.lg, paddingBottom: spacing.xxl, paddingTop: spacing.lg, zIndex: 1},
});
