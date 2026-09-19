import {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, Text, View} from 'react-native';
import {colors, radius, spacing, typography} from './theme';

export type StepperStep = {
  key: string;
  label: string;
};

type StepperProps = {
  steps: readonly StepperStep[];
  /** Index of the step in progress; every earlier step reads as complete. */
  activeIndex: number;
  failed?: boolean;
};

/**
 * React Bits' Stepper, ported to React Native: shows where a multi-stage
 * operation actually is, so a payment never looks stalled or finished early.
 */
export function Stepper({steps, activeIndex, failed = false}: StepperProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const animate = process.env.NODE_ENV !== 'test';
  const ratio = steps.length <= 1 ? 1 : Math.min(Math.max(activeIndex, 0), steps.length - 1) / (steps.length - 1);

  useEffect(() => {
    if (!animate) return;
    const animation = Animated.timing(progress, {
      duration: 320,
      easing: Easing.out(Easing.cubic),
      toValue: ratio,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [animate, progress, ratio]);

  const width = animate
    ? progress.interpolate({inputRange: [0, 1], outputRange: ['0%', '100%']})
    : (`${ratio * 100}%` as const);

  return (
    <View style={styles.container}>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, failed && styles.fillFailed, {width}]} />
      </View>
      <View style={styles.labels}>
        {steps.map((step, index) => {
          const complete = index < activeIndex;
          const active = index === activeIndex;
          return (
            <View key={step.key} style={styles.step}>
              <View
                style={[
                  styles.dot,
                  complete && styles.dotComplete,
                  active && (failed ? styles.dotFailed : styles.dotActive),
                ]}
              />
              <Text
                numberOfLines={2}
                style={[styles.label, (complete || active) && styles.labelActive, active && failed && styles.labelFailed]}>
                {step.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {gap: spacing.sm},
  track: {backgroundColor: colors.surfaceRaised, borderRadius: radius.round, height: 4, overflow: 'hidden'},
  fill: {backgroundColor: colors.amber, height: 4},
  fillFailed: {backgroundColor: colors.danger},
  labels: {flexDirection: 'row', justifyContent: 'space-between'},
  step: {alignItems: 'center', flex: 1, gap: spacing.xs},
  dot: {backgroundColor: colors.line, borderRadius: radius.round, height: 8, width: 8},
  dotComplete: {backgroundColor: colors.success},
  dotActive: {backgroundColor: colors.amber},
  dotFailed: {backgroundColor: colors.danger},
  label: {...typography.label, color: colors.inkMuted, fontSize: 10, textAlign: 'center'},
  labelActive: {color: colors.ink},
  labelFailed: {color: colors.danger},
});
