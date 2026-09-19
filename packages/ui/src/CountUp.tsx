import {useEffect, useRef, useState} from 'react';
import {Animated, Text, type StyleProp, type TextStyle} from 'react-native';

type CountUpProps = {
  value: number;
  decimals?: number;
  duration?: number;
  suffix?: string;
  style?: StyleProp<TextStyle>;
};

export function CountUp({value, decimals = 0, duration = 700, suffix = '', style}: CountUpProps) {
  const animatedValue = useRef(new Animated.Value(0)).current;
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const listener = animatedValue.addListener(({value: next}) => setDisplayValue(next));
    const animation = Animated.timing(animatedValue, {duration, toValue: value, useNativeDriver: false});
    animation.start();
    return () => {
      animation.stop();
      animatedValue.removeListener(listener);
    };
  }, [animatedValue, duration, value]);

  return <Text style={style}>{displayValue.toFixed(decimals)}{suffix}</Text>;
}
