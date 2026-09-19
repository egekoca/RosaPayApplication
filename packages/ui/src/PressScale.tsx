import {useRef, type ReactNode} from 'react';
import {Animated, Pressable, type AccessibilityRole, type StyleProp, type ViewStyle} from 'react-native';

type PressScaleProps = {
  children: ReactNode;
  disabled?: boolean;
  onPress?: () => void;
  role?: AccessibilityRole;
  style?: StyleProp<ViewStyle>;
};

export function PressScale({children, disabled = false, onPress, role = 'button', style}: PressScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (toValue: number) => Animated.spring(scale, {friction: 7, tension: 180, toValue, useNativeDriver: true}).start();

  return (
    <Pressable accessibilityRole={role} disabled={disabled} onPress={onPress} onPressIn={() => animate(0.975)} onPressOut={() => animate(1)}>
      <Animated.View style={[style, {transform: [{scale}]}]}>{children}</Animated.View>
    </Pressable>
  );
}
