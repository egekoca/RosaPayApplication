import {useEffect, useRef, type ReactNode} from 'react';
import {Animated, Easing, View, type StyleProp, type ViewStyle} from 'react-native';

type FadeContentProps = {
  children: ReactNode;
  delay?: number;
  duration?: number;
  blurFrom?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * React Bits' FadeContent, ported to React Native: a plain opacity entrance with
 * an optional scale settle. `blurFrom` stands in for the web version's blur,
 * which React Native cannot do without a native module.
 */
export function FadeContent({children, delay = 0, duration = 400, blurFrom = 0.985, style}: FadeContentProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const animate = process.env.NODE_ENV !== 'test';

  useEffect(() => {
    if (!animate) return;
    const animation = Animated.timing(progress, {
      delay,
      duration,
      easing: Easing.out(Easing.quad),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [animate, delay, duration, progress]);

  if (!animate) return <View style={style}>{children}</View>;

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [{scale: progress.interpolate({inputRange: [0, 1], outputRange: [blurFrom, 1]})}],
        },
      ]}>
      {children}
    </Animated.View>
  );
}
