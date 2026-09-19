import {useState} from 'react';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {ShieldCheck, Smartphone, Store} from 'lucide-react-native';
import {StyleSheet, Text, View} from 'react-native';
import {AnimatedContent, Button, colors, radius, spacing, SurfaceCard, TextField, typography} from '@rosapay/ui';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {logger} from '../../shared/logger';
import {createRandomBytes} from '../../shared/randomBytes';
import {useAppStore} from '../../state/appStore';
import {useCurrentAccount} from '../wallet/currentAccount';
import {createMerchantProfile, MerchantProfileError, requireBusinessEmail} from './merchantProfile';
import {registerMerchantForTestnet} from './merchantRegistration';
import {useTranslate} from '../../shared/i18n';

type Props = NativeStackScreenProps<RootStackParams, 'MerchantOnboarding'>;

// Nothing insecure may sign a real payment, so there is no fallback to allow.
const randomBytes = createRandomBytes({allowInsecureFallback: false});

export function MerchantOnboardingScreen({navigation}: Props) {
  const t = useTranslate();
  const {merchantProfile, saveMerchantProfile, setMerchantRegisteredOnChain} = useAppStore();
  const account = useCurrentAccount();
  const [displayName, setDisplayName] = useState(merchantProfile?.displayName ?? '');
  const [email, setEmail] = useState(merchantProfile?.email ?? '');
  const recipient = account?.address ?? '';
  const [errors, setErrors] = useState<{displayName?: string; email?: string; recipient?: string; general?: string}>({});
  const [registering, setRegistering] = useState(false);

  const submit = async () => {
    setErrors({});
    let profile;
    try {
      if (!account) throw new Error('Create or import a wallet before setting up your business');
      profile = merchantProfile
        ? {...merchantProfile, email: requireBusinessEmail(email)}
        : createMerchantProfile({displayName, email, recipient}, randomBytes);
    } catch (error) {
      if (error instanceof MerchantProfileError && (error.field === 'displayName' || error.field === 'recipient' || error.field === 'email')) {
        setErrors({[error.field]: error.message});
        return;
      }
      setErrors({general: error instanceof Error ? error.message : t('The merchant profile could not be created')});
      return;
    }

    saveMerchantProfile(profile);
    logger.info('merchant_profile_created', {merchantProfileId: profile.merchantProfileId});

    // Testnet settlement is rejected until the contract knows this merchant key.
    let registrationError: string | undefined;
    setRegistering(true);
    try {
      await registerMerchantForTestnet(profile);
      setMerchantRegisteredOnChain(true);
    } catch (error) {
      registrationError = error instanceof Error ? error.message : t('unknown error');
    } finally {
      setRegistering(false);
    }
    // The reason travels to the next screen rather than into state this replace
    // is about to discard, because that screen is where the retry lives.
    if (registrationError) {
      navigation.replace('MerchantRequest', {registrationError});
      return;
    }
    navigation.replace('Main');
  };

  return (
    <Screen>
      <AnimatedContent>
        <View style={styles.heading}>
          <View style={styles.icon}><Store color={colors.goldBright} size={22} /></View>
          <Text style={styles.eyebrow}>{t('GET PAID')}</Text>
          <Text style={styles.title}>{t('Set up your business')}</Text>
          <Text style={styles.subtitle}>{t('Customers see this name. You are paid into the wallet you already have.')}</Text>
        </View>
      </AnimatedContent>
      <AnimatedContent delay={80} scaleFrom={0.985}>
        <SurfaceCard accent="amber" style={styles.form}>
          <TextField
            label={t('BUSINESS NAME')}
            maxLength={80}
            editable={!merchantProfile}
            onChangeText={value => {
              setDisplayName(value);
              if (errors.displayName) setErrors(current => ({...current, displayName: undefined}));
            }}
            placeholder="Rose Coffee"
            testID="merchant-display-name"
            value={displayName}
            {...(errors.displayName ? {error: errors.displayName} : {})}
          />
          <TextField
            label={t('BUSINESS EMAIL')}
            autoCapitalize="none"
            keyboardType="email-address"
            maxLength={254}
            onChangeText={value => {
              setEmail(value);
              if (errors.email) setErrors(current => ({...current, email: undefined}));
            }}
            placeholder="hello@example.com"
            testID="merchant-email"
            value={email}
            {...(errors.email ? {error: errors.email} : {})}
          />
          <View style={styles.useWallet}>
            <Smartphone color={colors.goldBright} size={18} />
            <View style={styles.useWalletCopy}>
              <Text style={styles.useWalletTitle}>{t('Paid into this wallet')}</Text>
              <Text selectable style={styles.useWalletBody}>{recipient}</Text>
            </View>
          </View>
        </SurfaceCard>
      </AnimatedContent>
      <AnimatedContent delay={160}>
        <View style={styles.note}>
          <ShieldCheck color={colors.success} size={18} />
          <Text style={styles.noteText}>{t('The address is checked before it can ever appear on a payment request.')}</Text>
        </View>
      </AnimatedContent>
      {errors.general ? <Text style={styles.error}>{errors.general}</Text> : null}
      <AnimatedContent delay={220}>
        <Button loading={registering} onPress={() => void submit()} testID="merchant-save-profile">
          {registering ? t('Registering on Testnet') : t('Verify and continue')}
        </Button>
      </AnimatedContent>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {gap: spacing.xs},
  icon: {alignItems: 'center', backgroundColor: colors.goldSoft, borderColor: colors.goldDeep, borderRadius: radius.round, borderWidth: 1, height: 44, justifyContent: 'center', marginBottom: spacing.sm, width: 44},
  eyebrow: {...typography.overline, color: colors.goldBright, fontSize: 9, letterSpacing: 1.5},
  title: {...typography.title, color: colors.ink, fontSize: 26},
  subtitle: {color: colors.inkMuted, fontSize: 13, lineHeight: 19},
  form: {gap: spacing.lg},
  useWallet: {alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: radius.md, flexDirection: 'row', gap: spacing.sm, padding: spacing.md},
  useWalletCopy: {flex: 1, gap: 2},
  useWalletTitle: {color: colors.ink, fontSize: 14, fontWeight: '600'},
  useWalletBody: {color: colors.inkMuted, fontSize: 12, lineHeight: 17},
  note: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm},
  noteText: {color: colors.inkMuted, flex: 1, fontSize: 12, lineHeight: 17},
  error: {...typography.label, color: colors.danger},
});
