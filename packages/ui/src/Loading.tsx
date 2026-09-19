import {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import {colors, radius, spacing} from './theme';

type LoadingDotsProps = {
  active?: boolean;
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

export function LoadingDots({active = true, color = colors.goldBright, size = 5, style}: LoadingDotsProps) {
  const progress = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  const animate = active && process.env.NODE_ENV !== 'test';

  useEffect(() => {
    if (!animate) {
      progress.forEach(value => value.setValue(0));
      return;
    }

    const animations = progress.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 140),
          Animated.timing(value, {
            duration: 520,
            easing: Easing.inOut(Easing.quad),
            toValue: 1,
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            duration: 520,
            easing: Easing.inOut(Easing.quad),
            toValue: 0,
            useNativeDriver: true,
          }),
          Animated.delay((2 - index) * 140),
        ]),
      ),
    );
    animations.forEach(animation => animation.start());
    return () => animations.forEach(animation => animation.stop());
  }, [animate, progress]);

  return (
    <View accessibilityLabel="Loading" accessibilityRole="progressbar" style={[styles.dots, style]}>
      {progress.map((value, index) => (
        <Animated.View
          key={index}
          style={[
            styles.dot,
            {
              backgroundColor: color,
              height: size,
              opacity: animate ? value.interpolate({inputRange: [0, 1], outputRange: [0.35, 1]}) : 0.75,
              transform: animate
                ? [{scale: value.interpolate({inputRange: [0, 1], outputRange: [0.82, 1.18]})}]
                : undefined,
              width: size,
            },
          ]}
        />
      ))}
    </View>
  );
}

type LoadingBarProps = {
  active?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function LoadingBar({active = true, style}: LoadingBarProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const animate = active && process.env.NODE_ENV !== 'test';

  useEffect(() => {
    if (!animate) {
      progress.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          duration: 1_300,
          easing: Easing.inOut(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.delay(180),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [animate, progress]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-80, 220],
  });

  return (
    <View style={[styles.track, style]}>
      <Animated.View style={[styles.bar, {transform: [{translateX}]}]} />
    </View>
  );
}

const styles = StyleSheet.create({
  dots: {alignItems: 'center', flexDirection: 'row', gap: spacing.xs, height: 18},
  dot: {borderRadius: radius.round},
  track: {backgroundColor: colors.goldSoft, borderRadius: radius.round, height: 3, overflow: 'hidden', width: '76%'},
  bar: {backgroundColor: colors.goldBright, borderRadius: radius.round, height: 3, width: 80},
});
