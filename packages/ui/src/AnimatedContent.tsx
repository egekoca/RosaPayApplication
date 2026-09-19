import {useEffect, useRef, type ReactNode} from 'react';
import {Animated, Easing, View, type StyleProp, type ViewStyle} from 'react-native';

type AnimatedContentProps = {
  children: ReactNode;
  delay?: number;
  distance?: number;
  duration?: number;
  scaleFrom?: number;
  style?: StyleProp<ViewStyle>;
};

export function AnimatedContent({children, delay = 0, distance = 12, duration = 420, scaleFrom = 1, style}: AnimatedContentProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const useNativeDriver = process.env.NODE_ENV !== 'test';

  useEffect(() => {
    if (!useNativeDriver) return;
    const animation = Animated.timing(progress, {
      delay,
      duration,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, duration, progress]);

  if (!useNativeDriver) return <View style={style}>{children}</View>;

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {translateY: progress.interpolate({inputRange: [0, 1], outputRange: [distance, 0]})},
            {scale: progress.interpolate({inputRange: [0, 1], outputRange: [scaleFrom, 1]})},
          ],
        },
      ]}>
      {children}
    </Animated.View>
  );
}
