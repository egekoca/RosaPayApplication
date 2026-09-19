import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {Fingerprint, KeyRound} from 'lucide-react-native';
import {useState} from 'react';
import {KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {AnimatedContent, Button, colors, radius, spacing, SurfaceCard, TextField, typography} from '@rosapay/ui';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {useAppStore} from '../../state/appStore';
import {createHardwareSigner} from '../settings/hardwareSigner';
import {generateRecoveryPhrase} from '../wallet/stellarKey';

type Props = NativeStackScreenProps<RootStackParams, 'CreateAccount'>;

/**
 * How the account's key is held. Two real custody models, not two labels.
 *
 * `device` mints a secp256r1 key inside the phone's secure hardware: it cannot
 * be exported, so it cannot be phished or pasted into a fake app, and there is
 * nothing to write down. `phrase` derives an ordinary Stellar account from
 * twelve words along SEP-0005, so the same account opens in Lobstr or
 * Freighter and survives the phone being lost — at the cost of being a secret
 * that can leave the device.
 *
 * Neither is strictly safer, so the person choosing is told what each costs
 * rather than being given a default dressed up as advice.
 */
type Custody = 'device' | 'phrase';

export function CreateAccountScreen({navigation, route}: Props) {
  const importing = route.params?.intent === 'import';
  const createAccount = useAppStore(state => state.createAccount);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [custody, setCustody] = useState<Custody>('device');
  const [nameError, setNameError] = useState<string | undefined>();
  const [emailError, setEmailError] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    setNameError(undefined);
    setEmailError(undefined);
    setError(undefined);

    if (trimmedName.length < 2) {
      setNameError('Please enter the name a merchant should see');
      return;
    }
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmedEmail)) {
      setEmailError('That does not look like an email address');
      return;
    }

    // Carried onward rather than saved here. The account is recorded only once
    // a wallet exists, so a setup that fails leaves nothing half-made behind.
    const identity = {name: trimmedName, ...(trimmedEmail ? {email: trimmedEmail} : {})};

    setBusy(true);
    try {
      if (importing) {
        navigation.replace('ImportWallet', identity);
        return;
      }
      if (custody === 'phrase') {
        // Generated here and passed, never stored: the phrase reaches disk only
        // as the derived secret, and only after the next screen is satisfied
        // the person actually wrote it down.
        navigation.replace('RecoveryPhrase', {...identity, phrase: generateRecoveryPhrase()});
        return;
      }

      const signer = await createHardwareSigner();
      if (!signer.walletContractId) {
        throw new Error(signer.detail ?? 'Your secure wallet could not be created');
      }
      createAccount(identity);
      navigation.replace('Main');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Your account could not be created');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen contentStyle={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          // Without this the keyboard sits on top of the continue button and the
          // form looks finished but cannot be submitted.
          automaticallyAdjustKeyboardInsets>
          <AnimatedContent>
            <View style={styles.hero}>
              <Text style={styles.title}>{importing ? 'Restore your wallet' : 'Set up your account'}</Text>
              <Text style={styles.subtitle}>
                Your name is what a merchant sees on a receipt. Everything else stays on this phone.
              </Text>
            </View>
          </AnimatedContent>

          <AnimatedContent delay={90}>
            <View style={styles.fields}>
              <TextField
                label="Your name"
                value={name}
                onChangeText={setName}
                placeholder="Ege Koca"
                autoCapitalize="words"
                maxLength={60}
                error={nameError}
                testID="account-name"
              />
              <TextField
                label="Email (optional)"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                autoCapitalize="none"
                keyboardType="email-address"
                maxLength={120}
                hint="Only used to send you a receipt. It is not a login."
                error={emailError}
                testID="account-email"
              />
            </View>
          </AnimatedContent>

          {importing ? (
            <AnimatedContent delay={180}>
              <SurfaceCard style={styles.explainer}>
                <View style={styles.explainerRow}>
                  <View style={styles.explainerIcon}>
                    <KeyRound color={colors.amber} size={20} />
                  </View>
                  <View style={styles.explainerCopy}>
                    <Text style={styles.explainerTitle}>Your existing wallet</Text>
                    <Text style={styles.explainerBody}>
                      The next screen asks for your recovery phrase. It opens the same account you already use in
                      another wallet, and the address is shown for you to check before anything is saved.
                    </Text>
                  </View>
                </View>
              </SurfaceCard>
            </AnimatedContent>
          ) : (
            <AnimatedContent delay={180}>
              <View style={styles.custody}>
                <Text style={styles.custodyLabel}>HOW YOUR KEY IS HELD</Text>
                <CustodyOption
                  body="A payment key is made inside this phone's secure hardware and can never leave it. Nothing to write down, and nothing to phish — but the wallet lives on this phone only."
                  icon={<Fingerprint color={custody === 'device' ? colors.goldBright : colors.inkMuted} size={20} />}
                  onPress={() => setCustody('device')}
                  selected={custody === 'device'}
                  testID="custody-device"
                  title="This phone"
                />
                <CustodyOption
                  body="Twelve words you write down. The same account opens in Lobstr or Freighter, and survives this phone — but anyone who reads the words can spend it."
                  icon={<KeyRound color={custody === 'phrase' ? colors.goldBright : colors.inkMuted} size={20} />}
                  onPress={() => setCustody('phrase')}
                  selected={custody === 'phrase'}
                  testID="custody-phrase"
                  title="A recovery phrase"
                />
              </View>
            </AnimatedContent>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <AnimatedContent delay={260} distance={10}>
            <Button loading={busy} onPress={() => void submit()} testID="create-account">
              Continue
            </Button>
          </AnimatedContent>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** One custody model, stated with what it costs rather than only what it gives. */
function CustodyOption({
  body,
  icon,
  onPress,
  selected,
  testID,
  title,
}: {
  body: string;
  icon: React.ReactNode;
  onPress(): void;
  selected: boolean;
  testID: string;
  title: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{selected}}
      onPress={onPress}
      style={[styles.custodyOption, selected && styles.custodyOptionSelected]}
      testID={testID}>
      <View style={[styles.explainerIcon, selected && styles.custodyIconSelected]}>{icon}</View>
      <View style={styles.explainerCopy}>
        <Text style={[styles.explainerTitle, selected && styles.custodyTitleSelected]}>{title}</Text>
        <Text style={styles.explainerBody}>{body}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  custody: {gap: spacing.sm},
  custodyLabel: {...typography.label, color: colors.inkMuted, marginBottom: spacing.xs},
  custodyOption: {borderColor: colors.lineSoft, borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', gap: spacing.md, padding: spacing.lg},
  custodyOptionSelected: {backgroundColor: colors.goldSoft, borderColor: colors.goldDeep},
  custodyIconSelected: {backgroundColor: colors.goldSoft},
  custodyTitleSelected: {color: colors.goldBright},
  screen: {paddingBottom: 0},
  flex: {flex: 1},
  scroll: {gap: spacing.xl, paddingBottom: spacing.huge},
  hero: {gap: spacing.md},
  title: {...typography.display, color: colors.ink, fontSize: 30, lineHeight: 36},
  subtitle: {...typography.body, color: colors.inkMuted},
  fields: {gap: spacing.lg},
  explainer: {},
  explainerRow: {flexDirection: 'row', gap: spacing.md},
  explainerIcon: {alignItems: 'center', backgroundColor: colors.amberSoft, borderRadius: radius.round, height: 40, justifyContent: 'center', width: 40},
  explainerCopy: {flex: 1, gap: spacing.xs},
  explainerTitle: {...typography.label, color: colors.ink, fontSize: 14},
  explainerBody: {color: colors.inkMuted, fontSize: 13, lineHeight: 19},
  error: {...typography.label, color: colors.danger},
});
