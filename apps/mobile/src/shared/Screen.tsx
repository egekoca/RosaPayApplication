import type {ReactNode} from 'react';
import {ScrollView, StyleSheet, useWindowDimensions, View, type ViewStyle} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors, spacing} from '@rosapay/ui';

export function Screen({children, contentStyle}: {children: ReactNode; contentStyle?: ViewStyle}) {
  const {width} = useWindowDimensions();
  const horizontalPadding = width < 360 ? spacing.lg : width >= 600 ? spacing.xxl : spacing.xl;
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
      <View pointerEvents="none" style={styles.brandAura}>
        <View style={styles.auraRingLarge} />
        <View style={styles.auraRingSmall} />
        <View style={styles.auraDot} />
      </View>
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
  brandAura: {height: 230, position: 'absolute', right: -100, top: -72, width: 230},
  auraRingLarge: {borderColor: 'rgba(255,176,0,0.11)', borderRadius: 115, borderWidth: 1, height: 230, position: 'absolute', width: 230},
  auraRingSmall: {borderColor: 'rgba(255,255,255,0.045)', borderRadius: 82, borderWidth: 1, height: 164, left: 33, position: 'absolute', top: 33, width: 164},
  auraDot: {backgroundColor: colors.lemon, borderRadius: 4, height: 7, left: 26, position: 'absolute', top: 100, width: 7},
  content: {alignSelf: 'center', flexGrow: 1, gap: spacing.lg, paddingBottom: spacing.xxl, paddingTop: spacing.lg, zIndex: 1},
});
