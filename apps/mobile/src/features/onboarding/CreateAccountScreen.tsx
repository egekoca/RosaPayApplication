import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {Fingerprint} from 'lucide-react-native';
import {useState} from 'react';
import {KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View} from 'react-native';
import {AnimatedContent, Button, colors, radius, spacing, SurfaceCard, TextField, typography} from '@rosapay/ui';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {useAppStore} from '../../state/appStore';
import {createHardwareSigner} from '../settings/hardwareSigner';

type Props = NativeStackScreenProps<RootStackParams, 'CreateAccount'>;

export function CreateAccountScreen({navigation}: Props) {
  const createAccount = useAppStore(state => state.createAccount);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
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

    setBusy(true);
    try {
      // The device key is the account, so it is created here rather than left
      // for the first payment to discover it is missing.
      const report = await createHardwareSigner();
      if (report.state === 'unavailable') {
        setError(report.detail ?? 'This device could not create a payment key');
        return;
      }
      createAccount({name: trimmedName, ...(trimmedEmail ? {email: trimmedEmail} : {})});
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
              <Text style={styles.title}>Set up your account</Text>
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

          <AnimatedContent delay={180}>
            <SurfaceCard style={styles.explainer}>
              <View style={styles.explainerRow}>
                <View style={styles.explainerIcon}>
                  <Fingerprint color={colors.amber} size={20} />
                </View>
                <View style={styles.explainerCopy}>
                  <Text style={styles.explainerTitle}>Your face or fingerprint is the password</Text>
                  <Text style={styles.explainerBody}>
                    Tapping continue creates a payment key inside this phone's secure hardware. It never leaves the
                    device, and nothing can spend from it without you.
                  </Text>
                </View>
              </View>
            </SurfaceCard>
          </AnimatedContent>

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

const styles = StyleSheet.create({
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
