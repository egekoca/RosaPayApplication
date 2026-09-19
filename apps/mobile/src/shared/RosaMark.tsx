import {useEffect, useRef} from 'react';
import {
  Animated,
  Easing,
  Modal,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {colors, elevation, LoadingBar, radius, spacing, typography} from '@rosapay/ui';

type MarkMotion = 'none' | 'enter' | 'float' | 'spin';

type RosaMarkProps = {
  motion?: MarkMotion;
  showOrbit?: boolean;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

export function RosaMark({motion = 'none', showOrbit = false, size = 48, style}: RosaMarkProps) {
  const rotation = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(motion === 'enter' ? 0 : 1)).current;
  const animatedMotion = process.env.NODE_ENV === 'test' ? 'none' : motion;

  useEffect(() => {
    rotation.stopAnimation();
    pulse.stopAnimation();

    let animation: Animated.CompositeAnimation | undefined;
    if (animatedMotion === 'spin') {
      rotation.setValue(0);
      pulse.setValue(1);
      animation = Animated.parallel([
        Animated.loop(
          Animated.timing(rotation, {
            duration: 2_600,
            easing: Easing.linear,
            toValue: 1,
            useNativeDriver: true,
          }),
        ),
        Animated.loop(
          Animated.sequence([
            Animated.timing(pulse, {duration: 900, toValue: 1.045, useNativeDriver: true}),
            Animated.timing(pulse, {duration: 900, toValue: 1, useNativeDriver: true}),
          ]),
        ),
      ]);
    } else if (animatedMotion === 'float') {
      rotation.setValue(0);
      pulse.setValue(1);
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(rotation, {duration: 1_800, easing: Easing.inOut(Easing.sin), toValue: 1, useNativeDriver: true}),
          Animated.timing(rotation, {duration: 1_800, easing: Easing.inOut(Easing.sin), toValue: 0, useNativeDriver: true}),
        ]),
      );
    } else if (animatedMotion === 'enter') {
      rotation.setValue(0);
      pulse.setValue(0);
      animation = Animated.parallel([
        Animated.timing(rotation, {duration: 650, easing: Easing.out(Easing.cubic), toValue: 1, useNativeDriver: true}),
        Animated.spring(pulse, {friction: 7, tension: 80, toValue: 1, useNativeDriver: true}),
      ]);
    } else {
      rotation.setValue(0);
      pulse.setValue(1);
    }

    animation?.start();
    return () => animation?.stop();
  }, [animatedMotion, pulse, rotation]);

  const rotate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange:
      animatedMotion === 'float'
        ? ['-2deg', '2deg']
        : animatedMotion === 'enter'
          ? ['-12deg', '0deg']
          : ['0deg', '360deg'],
  });
  const opacity = animatedMotion === 'enter' ? pulse : 1;
  const orbitSize = size + Math.max(14, size * 0.22);

  return (
    <View
      accessibilityLabel="Rosa Pay"
      style={[styles.markShell, {height: orbitSize, width: orbitSize}, style]}>
      {showOrbit ? (
        <>
          <View style={[styles.orbit, {borderRadius: orbitSize / 2, height: orbitSize, width: orbitSize}]} />
          <View style={[styles.orbitDot, {right: Math.max(1, size * 0.02), top: size * 0.16}]} />
        </>
      ) : null}
      <Animated.Image
        source={require('../assets/rosapay-logo.png')}
        style={[
          styles.mark,
          {
            borderRadius: Math.max(radius.sm, size * 0.23),
            height: size,
            opacity,
            transform: [{rotate}, {scale: pulse}],
            width: size,
          },
        ]}
      />
    </View>
  );
}

/**
 * `hero` is for the one screen where the name is the subject rather than a
 * label: the first thing a new customer sees. Everywhere else the wordmark sits
 * above content and stays out of its way.
 */
export function RosaWordmark({
  compact = false,
  hero = false,
}: {
  compact?: boolean;
  hero?: boolean;
}) {
  return (
    <Text style={[styles.wordmark, compact && styles.wordmarkCompact, hero && styles.wordmarkHero]}>
      Rosa <Text style={styles.wordmarkAccent}>Pay</Text>
    </Text>
  );
}

export function RosaLoader({label = 'Loading Rosa Pay'}: {label?: string}) {
  return (
    <View accessibilityLiveRegion="polite" accessibilityRole="progressbar" style={styles.loader}>
      <RosaMark motion="spin" showOrbit size={78} />
      <Text style={styles.loaderLabel}>{label}</Text>
      <Text style={styles.loaderCaption}>LUMEN × ROSE</Text>
    </View>
  );
}

export function RosaLoadingOverlay({detail, title, visible}: {detail?: string; title: string; visible: boolean}) {
  return (
    <Modal animationType="fade" onRequestClose={() => undefined} statusBarTranslucent transparent visible={visible}>
      <View style={styles.overlay}>
        <View style={styles.overlayCard}>
          <RosaMark motion="spin" showOrbit size={70} />
          <Text style={styles.overlayTitle}>{title}</Text>
          {detail ? <Text style={styles.overlayDetail}>{detail}</Text> : null}
          <LoadingBar style={styles.progressTrack} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  markShell: {alignItems: 'center', justifyContent: 'center'},
  orbit: {borderColor: 'rgba(224,180,93,0.34)', borderWidth: 1, position: 'absolute'},
  orbitDot: {backgroundColor: colors.lemon, borderRadius: radius.round, height: 7, position: 'absolute', width: 7},
  mark: {...elevation.card, shadowOpacity: 0.32},
  wordmark: {...typography.title, color: colors.white, fontSize: 21},
  wordmarkCompact: {fontSize: 18},
  // Tightened tracking as the size goes up: display-size type set at body
  // spacing reads as though the letters are drifting apart.
  wordmarkHero: {fontSize: 34, letterSpacing: -0.6, lineHeight: 40},
  wordmarkAccent: {color: colors.lemon},
  loader: {alignItems: 'center', gap: spacing.md},
  loaderLabel: {...typography.label, color: colors.white, fontSize: 15, marginTop: spacing.sm},
  loaderCaption: {...typography.overline, color: colors.lemon, fontSize: 9, letterSpacing: 1.8},
  overlay: {alignItems: 'center', backgroundColor: 'rgba(5,5,5,0.92)', flex: 1, justifyContent: 'center', padding: spacing.xl},
  overlayCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radius.xl,
    borderWidth: 1,
    gap: spacing.md,
    maxWidth: 360,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.huge,
    width: '100%',
    ...elevation.raised,
  },
  overlayTitle: {...typography.title, color: colors.white, fontSize: 20, marginTop: spacing.sm, textAlign: 'center'},
  overlayDetail: {...typography.body, color: colors.inkMuted, fontSize: 13, lineHeight: 19, textAlign: 'center'},
  progressTrack: {marginTop: spacing.md, width: '76%'},
});
