import {useEffect, useRef, type ReactNode} from 'react';
import {Animated, Easing, View, type StyleProp, type ViewStyle} from 'react-native';

type PulseProps = {
  active?: boolean;
  children: ReactNode;
  duration?: number;
  style?: StyleProp<ViewStyle>;
};

export function Pulse({active = true, children, duration = 1400, style}: PulseProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const useNativeDriver = process.env.NODE_ENV !== 'test';

  useEffect(() => {
    if (!useNativeDriver) return;
    if (!active) {
      progress.stopAnimation();
      progress.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {duration: duration / 2, easing: Easing.inOut(Easing.quad), toValue: 1, useNativeDriver}),
        Animated.timing(progress, {duration: duration / 2, easing: Easing.inOut(Easing.quad), toValue: 0, useNativeDriver}),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [active, duration, progress]);

  if (!useNativeDriver) return <View style={style}>{children}</View>;

  return <Animated.View style={[style, {opacity: progress.interpolate({inputRange: [0, 1], outputRange: [0.72, 1]})}]}>{children}</Animated.View>;
}
