import {useEffect, useMemo, useRef} from 'react';
import {Animated, Easing, StyleSheet, Text, View, type StyleProp, type TextStyle} from 'react-native';

type SplitTextProps = {
  text: string;
  delay?: number;
  stagger?: number;
  duration?: number;
  distance?: number;
  splitBy?: 'character' | 'word';
  style?: StyleProp<TextStyle>;
};

/**
 * React Bits' SplitText, ported to React Native: each character or word enters
 * with a staggered rise. Falls back to plain text when animation is disabled so
 * screen readers and tests always see one string.
 */
export function SplitText({
  text,
  delay = 0,
  stagger = 26,
  duration = 420,
  distance = 10,
  splitBy = 'character',
  style,
}: SplitTextProps) {
  const animate = process.env.NODE_ENV !== 'test';
  const pieces = useMemo(
    () => (splitBy === 'word' ? text.split(/(\s+)/) : Array.from(text)),
    [splitBy, text],
  );
  const progress = useRef(pieces.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!animate) return;
    const animations = progress.map((value, index) =>
      Animated.timing(value, {
        delay: delay + index * stagger,
        duration,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
    );
    const group = Animated.parallel(animations);
    group.start();
    return () => group.stop();
  }, [animate, delay, duration, progress, stagger]);

  if (!animate) {
    return <Text style={style}>{text}</Text>;
  }

  return (
    <View accessibilityLabel={text} accessible style={styles.row}>
      {pieces.map((piece, index) => (
        <Animated.Text
          // Pieces are positional, so the index is the identity here.
          key={`${piece}-${index}`}
          style={[
            style,
            {
              opacity: progress[index],
              transform: [
                {
                  translateY:
                    progress[index]?.interpolate({inputRange: [0, 1], outputRange: [distance, 0]}) ?? 0,
                },
              ],
            },
          ]}>
          {piece}
        </Animated.Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', flexWrap: 'wrap'},
});
