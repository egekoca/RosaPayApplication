import {useState} from 'react';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {ShieldCheck, Store} from 'lucide-react-native';
import {StyleSheet, Text, View} from 'react-native';
import {Button, colors, radius, spacing, SurfaceCard, TextField, typography} from '@rosapay/ui';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {logger} from '../../shared/logger';
import {createRandomBytes} from '../../shared/randomBytes';
import {useAppStore} from '../../state/appStore';
import {createMerchantProfile, MerchantProfileError} from './merchantProfile';
import {registerMerchantForTestnet} from './merchantRegistration';

type Props = NativeStackScreenProps<RootStackParams, 'MerchantOnboarding'>;

// Nothing insecure may sign a real payment, so there is no fallback to allow.
const randomBytes = createRandomBytes({allowInsecureFallback: false});

export function MerchantOnboardingScreen({navigation}: Props) {
  const {saveMerchantProfile, setMerchantRegisteredOnChain} = useAppStore();
  const [displayName, setDisplayName] = useState('');
  const [recipient, setRecipient] = useState('');
  const [errors, setErrors] = useState<{displayName?: string; recipient?: string; general?: string}>({});
  const [registering, setRegistering] = useState(false);

  const submit = async () => {
    setErrors({});
    let profile;
    try {
      profile = createMerchantProfile({displayName, recipient}, randomBytes);
    } catch (error) {
      if (error instanceof MerchantProfileError && (error.field === 'displayName' || error.field === 'recipient')) {
        setErrors({[error.field]: error.message});
        return;
      }
      setErrors({general: error instanceof Error ? error.message : 'The merchant profile could not be created'});
      return;
    }

    saveMerchantProfile(profile);
    logger.info('merchant_profile_created', {merchantProfileId: profile.merchantProfileId});

    // Testnet settlement is rejected until the contract knows this merchant key.
    {
      setRegistering(true);
      try {
        await registerMerchantForTestnet(profile);
        setMerchantRegisteredOnChain(true);
      } catch (error) {
        setErrors({
          general: `Profile saved, but Testnet registration failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }. You can retry it from the payment request screen.`,
        });
      } finally {
        setRegistering(false);
      }
    }
    navigation.replace('MerchantRequest');
  };

  return (
    <Screen>
      <View style={styles.heading}>
        <View style={styles.icon}><Store color={colors.amber} size={22} /></View>
        <Text style={styles.title}>Set up your business</Text>
        <Text style={styles.subtitle}>Customers see this name and pay the address you verify here.</Text>
      </View>
      <SurfaceCard style={styles.form}>
        <TextField
          label="BUSINESS NAME"
          maxLength={80}
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
          autoCapitalize="characters"
          hint="Stellar account or contract address that receives payments"
          label="RECEIVING ADDRESS"
          maxLength={56}
          mono
          multiline
          onChangeText={value => {
            setRecipient(value);
            if (errors.recipient) setErrors(current => ({...current, recipient: undefined}));
          }}
          placeholder="GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57"
          testID="merchant-recipient"
          value={recipient}
          {...(errors.recipient ? {error: errors.recipient} : {})}
        />
      </SurfaceCard>
      <View style={styles.note}>
        <ShieldCheck color={colors.success} size={18} />
        <Text style={styles.noteText}>The address is checked before it can ever appear on a payment request.</Text>
      </View>
      {errors.general ? <Text style={styles.error}>{errors.general}</Text> : null}
      <Button loading={registering} onPress={() => void submit()} testID="merchant-save-profile">
        {registering ? 'Registering on Testnet' : 'Verify and continue'}
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {gap: spacing.xs},
  icon: {alignItems: 'center', backgroundColor: colors.amberSoft, borderRadius: radius.round, height: 44, justifyContent: 'center', marginBottom: spacing.sm, width: 44},
  title: {...typography.title, color: colors.ink, fontSize: 26},
  subtitle: {color: colors.inkMuted, fontSize: 13, lineHeight: 19},
  form: {gap: spacing.lg},
  note: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm},
  noteText: {color: colors.inkMuted, flex: 1, fontSize: 12, lineHeight: 17},
  error: {...typography.label, color: colors.danger},
});
