import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {ArrowRight, Nfc, ScanLine, ShieldCheck} from 'lucide-react-native';
import {Image, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import type {ReactNode} from 'react';
import {AnimatedContent, Button, colors, radius, spacing, typography} from '@rosapay/ui';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';

type Props = NativeStackScreenProps<RootStackParams, 'Welcome'>;

export function WelcomeScreen({navigation}: Props) {
  const {width} = useWindowDimensions();
  const measure = Math.min(400, width - 48);

  return (
    <Screen contentStyle={styles.screen}>
      <AnimatedContent>
        <View style={styles.brand}>
          <Image accessibilityLabel="Rosa Pay" source={require('../../assets/rosapay-logo.png')} style={styles.brandMark} />
          <Text style={styles.brandName}>Rosa Pay</Text>
        </View>
      </AnimatedContent>

      <AnimatedContent delay={90} distance={20} scaleFrom={0.98}>
        <View style={styles.hero}>
          <Text style={[styles.title, {maxWidth: measure}]}>Pay by scanning.{'\n'}Get paid by showing.</Text>
          <Text style={[styles.subtitle, {maxWidth: measure}]}>
            One app for both sides of the counter. Your money moves on Stellar, and only this phone can approve it.
          </Text>
        </View>
      </AnimatedContent>

      <AnimatedContent delay={180}>
        <View style={styles.points}>
          <Point icon={<ScanLine color={colors.amber} size={18} />} text="Scan a merchant's code to pay" />
          <Point icon={<Nfc color={colors.amber} size={18} />} text="Or hold the two phones together" />
          <Point icon={<ShieldCheck color={colors.success} size={18} />} text="Approved with your face or fingerprint" />
        </View>
      </AnimatedContent>

      <AnimatedContent delay={280} distance={10}>
        <View style={styles.actions}>
          <Button
            icon={<ArrowRight color={colors.black} size={20} />}
            onPress={() => navigation.navigate('CreateAccount')}
            testID="get-started">
            Get started
          </Button>
          <Text style={styles.footnote}>
            Takes about a minute. No email or password — this phone is the account.
          </Text>
        </View>
      </AnimatedContent>
    </Screen>
  );
}

function Point({icon, text}: {icon: ReactNode; text: string}) {
  return (
    <View style={styles.point}>
      <View style={styles.pointIcon}>{icon}</View>
      <Text style={styles.pointText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {justifyContent: 'center', gap: spacing.xl},
  brand: {alignItems: 'center', flexDirection: 'row', gap: spacing.md},
  brandMark: {borderRadius: radius.sm, height: 40, width: 40},
  brandName: {...typography.title, color: colors.ink, fontSize: 20},
  hero: {gap: spacing.lg},
  title: {...typography.display, color: colors.ink},
  subtitle: {...typography.body, color: colors.inkMuted},
  points: {gap: spacing.lg},
  point: {alignItems: 'center', flexDirection: 'row', gap: spacing.md},
  pointIcon: {alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: radius.round, height: 40, justifyContent: 'center', width: 40},
  pointText: {...typography.body, color: colors.ink, flex: 1, fontSize: 15},
  actions: {gap: spacing.lg},
  footnote: {color: colors.inkFaint, fontSize: 13, lineHeight: 19, textAlign: 'center'},
});
