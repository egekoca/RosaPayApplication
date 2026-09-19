import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {ArrowRight, Nfc, ScanLine, ShieldCheck} from 'lucide-react-native';
import {Pressable, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import type {ReactNode} from 'react';
import {AnimatedContent, Button, colors, radius, spacing, typography} from '@rosapay/ui';
import type {RootStackParams} from '../../app/navigation';
import {LumenadeMark, LumenadeWordmark} from '../../shared/LumenadeMark';
import {Screen} from '../../shared/Screen';

type Props = NativeStackScreenProps<RootStackParams, 'Welcome'>;

export function WelcomeScreen({navigation}: Props) {
  const {width} = useWindowDimensions();
  const measure = Math.min(400, width - 48);

  return (
    <Screen contentStyle={styles.screen}>
      <AnimatedContent>
        <View style={styles.brand}>
          <LumenadeMark motion="float" showOrbit size={82} />
          <LumenadeWordmark />
          <View style={styles.originBadge}>
            <Text style={styles.originText}>LUMEN</Text>
            <Text style={styles.originSymbol}>×</Text>
            <Text style={styles.originText}>LEMONADE</Text>
          </View>
        </View>
      </AnimatedContent>

      <AnimatedContent delay={90} distance={20} scaleFrom={0.98}>
        <View style={styles.hero}>
          <Text style={[styles.title, {maxWidth: measure}]}>Pay by scanning.{'\n'}<Text style={styles.titleAccent}>Settle on Stellar.</Text></Text>
          <Text style={[styles.subtitle, {maxWidth: measure}]}>One app for both sides of the counter. Your money moves on Stellar, and only this phone can approve it.</Text>
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
            onPress={() => navigation.navigate('CreateAccount', {intent: 'create'})}
            testID="get-started">
            Create a new wallet
          </Button>
          {/*
            Quiet rather than hidden. Most people arriving here have no Stellar
            account, so this is not the main road — but someone who does has one
            already and should not be made to create a second.
          */}
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('CreateAccount', {intent: 'import'})}
            testID="restore-wallet">
            <Text style={styles.restore}>I already have a wallet</Text>
          </Pressable>
          <Text style={styles.footnote}>
            No password to remember. Twelve words are your wallet, and they are what lets you add money in lira.
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
  screen: {justifyContent: 'center', gap: spacing.xl, paddingTop: spacing.xxl},
  brand: {alignItems: 'center', gap: spacing.sm},
  originBadge: {alignItems: 'center', backgroundColor: colors.lemonSoft, borderColor: 'rgba(224,180,93,0.24)', borderRadius: radius.round, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: 6},
  originText: {...typography.overline, color: colors.lemon, fontSize: 9, letterSpacing: 1.4},
  originSymbol: {color: colors.white, fontSize: 10},
  hero: {alignItems: 'center', gap: spacing.lg},
  title: {...typography.display, color: colors.ink, textAlign: 'center'},
  titleAccent: {color: colors.lemon},
  subtitle: {...typography.body, color: colors.inkMuted, textAlign: 'center'},
  points: {gap: spacing.sm},
  point: {alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.lineSoft, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', gap: spacing.md, padding: spacing.md},
  pointIcon: {alignItems: 'center', backgroundColor: colors.lemonSoft, borderRadius: radius.round, height: 40, justifyContent: 'center', width: 40},
  pointText: {...typography.body, color: colors.ink, flex: 1, fontSize: 15},
  actions: {gap: spacing.lg},
  restore: {...typography.body, color: colors.gold, textAlign: 'center'},
  footnote: {color: colors.inkFaint, fontSize: 13, lineHeight: 19, textAlign: 'center'},
});
