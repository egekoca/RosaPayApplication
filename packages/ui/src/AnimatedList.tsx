import {Children, type ReactNode} from 'react';
import {View, type StyleProp, type ViewStyle} from 'react-native';
import {AnimatedContent} from './AnimatedContent';

type AnimatedListProps = {
  children: ReactNode;
  delay?: number;
  stagger?: number;
  distance?: number;
  style?: StyleProp<ViewStyle>;
};

/** React Bits' AnimatedList, ported to React Native: children enter in sequence. */
export function AnimatedList({children, delay = 0, stagger = 70, distance = 10, style}: AnimatedListProps) {
  return (
    <View style={style}>
      {Children.map(children, (child, index) => (
        <AnimatedContent delay={delay + index * stagger} distance={distance}>
          {child}
        </AnimatedContent>
      ))}
    </View>
  );
}
