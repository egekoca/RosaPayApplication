import {useEffect, useMemo, useRef, type ReactNode} from 'react';
import {Animated, Easing, StyleSheet, useWindowDimensions, type ViewStyle} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors, spacing} from '@rosapay/ui';

export function Screen({children, contentStyle}: {children: ReactNode; contentStyle?: ViewStyle}) {
  const {width} = useWindowDimensions();
  const horizontalPadding = width < 360 ? spacing.lg : width >= 600 ? spacing.xxl : spacing.xl;
  const contentFrame = useMemo(
    () => ({maxWidth: 720, paddingHorizontal: horizontalPadding, width: '100%' as const}),
    [horizontalPadding],
  );
  const progress = useRef(new Animated.Value(0)).current;
  const animate = process.env.NODE_ENV !== 'test';

  useEffect(() => {
    if (!animate) return;
    const animation = Animated.timing(progress, {
      duration: 360,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [animate, progress]);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        style={
          animate
            ? {
                opacity: progress,
                transform: [{translateY: progress.interpolate({inputRange: [0, 1], outputRange: [10, 0]})}],
              }
            : undefined
        }
        contentContainerStyle={[styles.content, contentFrame, contentStyle]}>
        {children}
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {backgroundColor: colors.canvas, flex: 1, overflow: 'hidden'},
  content: {alignSelf: 'center', flexGrow: 1, gap: spacing.lg, paddingBottom: spacing.xxl, paddingTop: spacing.lg, zIndex: 1},
});
