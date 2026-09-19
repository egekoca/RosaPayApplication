import {useEffect, useRef, type ReactNode} from 'react';
import {Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import Svg, {Defs, LinearGradient, Path, Rect, Stop} from 'react-native-svg';
import {radius, spacing} from './theme';

type GoldCardSurfaceProps = {
  children: ReactNode;
  width: number;
  height: number;
  contentStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  idSuffix?: string;
  animated?: boolean;
};

/**
 * Shared material treatment for the wallet and merchant cards.
 *
 * The broad curves make the card feel like one piece of anodised metal. The
 * sheen is deliberately slow and quiet so the surface stays useful first.
 */
export function GoldCardSurface({
  children,
  width,
  height,
  contentStyle,
  style,
  idSuffix = 'default',
  animated = true,
}: GoldCardSurfaceProps) {
  const sweep = useRef(new Animated.Value(0)).current;
  const animate = animated && process.env.NODE_ENV !== 'test';

  useEffect(() => {
    if (!animate) return;

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, {
          duration: 2_700,
          easing: Easing.inOut(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.delay(4_200),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [animate, sweep]);

  const translateX = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-width * 0.9, width * 1.5],
  });
  const baseId = `gold-card-${idSuffix}`;

  return (
    <View style={[styles.stage, style]}>
      <View style={[styles.card, {height, width}]}>
        <Svg
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          height="100%"
          preserveAspectRatio="none"
          viewBox="0 0 100 63"
          width="100%">
          <Defs>
            <LinearGradient id={`${baseId}-base`} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#7A4F0B" />
              <Stop offset="0.22" stopColor="#C68C22" />
              <Stop offset="0.42" stopColor="#F3CB74" />
              <Stop offset="0.55" stopColor="#FFE7AE" />
              <Stop offset="0.7" stopColor="#D9A238" />
              <Stop offset="0.86" stopColor="#8A5E10" />
              <Stop offset="1" stopColor="#5E3B06" />
            </LinearGradient>
            <LinearGradient id={`${baseId}-light`} x1="0" y1="0" x2="1" y2="0.4">
              <Stop offset="0" stopColor="#FFF3D2" stopOpacity="0" />
              <Stop offset="0.45" stopColor="#FFF3D2" stopOpacity="0.9" />
              <Stop offset="1" stopColor="#FFF3D2" stopOpacity="0" />
            </LinearGradient>
            <LinearGradient id={`${baseId}-dark`} x1="0" y1="0" x2="1" y2="0.6">
              <Stop offset="0" stopColor="#5E3B06" stopOpacity="0" />
              <Stop offset="0.5" stopColor="#5E3B06" stopOpacity="0.8" />
              <Stop offset="1" stopColor="#5E3B06" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100" height="63" fill={`url(#${baseId}-base)`} />
          <Path
            d="M-8 44 C 16 30, 30 46, 52 30 S 84 6, 112 14 L112 26 C 84 20, 70 40, 50 44 S 18 44, -8 56 Z"
            fill={`url(#${baseId}-light)`}
            opacity={0.5}
          />
          <Path
            d="M-8 20 C 20 12, 34 26, 58 14 S 88 -2, 112 2 L112 9 C 88 6, 74 20, 54 24 S 20 22, -8 30 Z"
            fill={`url(#${baseId}-dark)`}
            opacity={0.34}
          />
          <Path
            d="M-8 58 C 18 50, 40 62, 62 48 S 92 30, 112 36 L112 44 C 92 40, 74 56, 52 60 S 16 66, -8 66 Z"
            fill={`url(#${baseId}-dark)`}
            opacity={0.26}
          />
          <Path
            d="M-8 36 C 14 34, 28 40, 46 34 S 80 22, 112 28 L112 31 C 80 26, 62 38, 44 40 S 12 40, -8 40 Z"
            fill={`url(#${baseId}-light)`}
            opacity={0.36}
          />
        </Svg>

        {animate ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.sweep,
              {
                height: height * 2.2,
                transform: [{translateX}, {rotate: '18deg'}],
              },
            ]}>
            <Svg height="100%" width="100%">
              <Defs>
                <LinearGradient id={`${baseId}-shine`} x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
                  <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.42" />
                  <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${baseId}-shine)`} />
            </Svg>
          </Animated.View>
        ) : null}

        <View style={[styles.content, contentStyle]}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignItems: 'center',
    transform: [{perspective: 1600}, {rotateX: '3deg'}, {rotateY: '-4deg'}],
  },
  card: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: {width: 0, height: 22},
    shadowOpacity: 0.55,
    shadowRadius: 34,
    elevation: 14,
  },
  content: {flex: 1, padding: spacing.lg},
  sweep: {position: 'absolute', top: '-60%', width: 90},
});
