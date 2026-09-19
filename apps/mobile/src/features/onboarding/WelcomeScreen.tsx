import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {Fingerprint, LockKeyhole, ShieldCheck, Sparkles} from 'lucide-react-native';
import {Image, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import type {ReactNode} from 'react';
import {AnimatedContent, Button, colors, radius, spacing, StatusPill, SurfaceCard, typography} from '@rosapay/ui';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';

type Props = NativeStackScreenProps<RootStackParams, 'Welcome'>;

export function WelcomeScreen({navigation}: Props) {
  const {width} = useWindowDimensions();
  return (
    <Screen contentStyle={styles.screen}>
      <AnimatedContent><View style={styles.topline}><View style={styles.brand}><Image accessibilityLabel="Rosa Pay" source={require('../../assets/rosapay-logo.png')} style={styles.brandMark} /><Text style={styles.brandName}>Rosa Pay</Text></View><StatusPill tone="success">TESTNET</StatusPill></View></AnimatedContent>
      <AnimatedContent delay={90} distance={18} scaleFrom={0.98}><View style={styles.hero}><View accessible accessibilityLabel="Secure payment" style={styles.heroIcon}><Sparkles color={colors.amber} size={28} /></View><Text style={[styles.title, {maxWidth: Math.min(360, width - 48)}]}>Payments that feel certain.</Text><Text style={[styles.subtitle, {maxWidth: Math.min(420, width - 48)}]}>Approve the exact merchant, amount and destination. Your wallet stays protected by your device.</Text></View></AnimatedContent>
      <AnimatedContent delay={180}><SurfaceCard style={styles.securityCard}>
        <SecurityItem icon={<ShieldCheck color={colors.success} size={19} />} title="Non-custodial by design" body="Your signing material never leaves your device." />
        <SecurityItem icon={<LockKeyhole color={colors.amber} size={19} />} title="Verified before approval" body="Every QR payment is checked before you sign." />
      </SurfaceCard></AnimatedContent>
      <AnimatedContent delay={260} distance={10}><View style={styles.actions}><Button icon={<Fingerprint color={colors.black} size={20} />} onPress={() => navigation.replace('Main')}>Create your wallet</Button><Button tone="secondary" onPress={() => navigation.replace('Main')}>Sign in with passkey</Button></View></AnimatedContent>
      <AnimatedContent delay={340} distance={6}><Text style={styles.network}>STELLAR TESTNET · QR PAYMENTS</Text></AnimatedContent>
    </Screen>
  );
}

function SecurityItem({icon, title, body}: {icon: ReactNode; title: string; body: string}) {
  return <View style={styles.securityItem}><View style={styles.securityIcon}>{icon}</View><View style={styles.securityCopy}><Text style={styles.securityTitle}>{title}</Text><Text style={styles.securityBody}>{body}</Text></View></View>;
}

const styles = StyleSheet.create({
  screen: {justifyContent: 'center'},
  topline: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'},
  brand: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm},
  brandMark: {borderRadius: radius.sm, height: 38, width: 38},
  brandName: {...typography.title, color: colors.ink, fontSize: 19},
  hero: {gap: spacing.md, marginTop: spacing.xxl},
  heroIcon: {alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.amberSoft, borderRadius: radius.round, height: 54, justifyContent: 'center', width: 54},
  title: {color: colors.ink, fontSize: 34, fontWeight: '700', lineHeight: 40, maxWidth: 330},
  subtitle: {...typography.body, color: colors.inkMuted, maxWidth: 350},
  securityCard: {gap: spacing.lg, marginTop: spacing.lg},
  securityItem: {alignItems: 'center', flexDirection: 'row', gap: spacing.md},
  securityIcon: {alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: radius.round, height: 36, justifyContent: 'center', width: 36},
  securityCopy: {flex: 1, gap: 2},
  securityTitle: {...typography.label, color: colors.ink, fontSize: 13},
  securityBody: {color: colors.inkMuted, fontSize: 12, lineHeight: 17},
  actions: {gap: spacing.md, marginTop: spacing.lg},
  network: {...typography.label, color: colors.inkMuted, fontSize: 10, letterSpacing: 1, marginTop: spacing.sm, textAlign: 'center'},
});
