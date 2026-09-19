import {useState} from 'react';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {AnimatedContent, Button, colors, radius, spacing, SurfaceCard, TextField, typography} from '@rosapay/ui';
import type {Keypair} from '@stellar/stellar-sdk';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {canHoldSigningKey, saveSigningKey} from '../wallet/keyVault';
import {keypairFromRecoveryPhrase, keypairFromSecret, normalizeRecoveryPhrase} from '../wallet/stellarKey';
import {useAppStore} from '../../state/appStore';
import {useTranslate} from '../../shared/i18n';

type Props = NativeStackScreenProps<RootStackParams, 'ImportWallet'>;

type Method = 'phrase' | 'secret';

/**
 * Bringing an existing Stellar account in.
 *
 * The derived address is shown and has to be confirmed before anything is
 * stored. That step is not ceremony: a phrase protected by a BIP-39 passphrase,
 * or one from a wallet using a different derivation path, produces a perfectly
 * valid address that simply is not theirs. Confirming it is the only moment
 * someone can catch that before they wonder where their money went.
 */
export function ImportWalletScreen({navigation, route}: Props) {
  const t = useTranslate();
  const {name, email} = route.params;
  const setWallet = useAppStore(state => state.setWallet);
  const createAccount = useAppStore(state => state.createAccount);
  const [method, setMethod] = useState<Method>('phrase');
  const [phrase, setPhrase] = useState('');
  const [secret, setSecret] = useState('');
  const [derived, setDerived] = useState<Keypair | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const wordCount = normalizeRecoveryPhrase(phrase).split(' ').filter(Boolean).length;

  function check() {
    setError(undefined);
    try {
      setDerived(method === 'phrase' ? keypairFromRecoveryPhrase(phrase) : keypairFromSecret(secret));
    } catch (failure) {
      setDerived(null);
      setError(failure instanceof Error ? failure.message : t('That wallet could not be read'));
    }
  }

  async function save() {
    if (!derived) return;
    setBusy(true);
    setError(undefined);
    try {
      if (!(await canHoldSigningKey())) {
        setError(t('This phone needs a screen lock before it can hold a wallet key. Set one, then try again.'));
        return;
      }
      await saveSigningKey(derived.secret());
      // Only now, with the key actually on the phone: a failed import must
      // leave no account behind for someone to find on the next launch.
      createAccount({name, ...(email ? {email} : {})});
      setWallet({address: derived.publicKey(), origin: 'imported'});
      navigation.replace('Main');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('The wallet could not be saved on this phone'));
    } finally {
      setBusy(false);
    }
  }

  if (derived) {
    return (
      <Screen>
        <AnimatedContent>
          <View style={styles.hero}>
            <Text style={styles.title}>{t('Is this your account?')}</Text>
            <Text style={styles.subtitle}>
              {t('Check this against the address in the wallet you are moving from. If it does not match, the phrase belongs to a different account and nothing has been saved yet.')}
            </Text>
          </View>
        </AnimatedContent>

        <AnimatedContent delay={90} scaleFrom={0.98}>
          <SurfaceCard accent="amber" style={styles.addressCard}>
            <Text style={styles.addressLabel}>{t('STELLAR ACCOUNT')}</Text>
            <Text selectable style={styles.address}>{derived.publicKey()}</Text>
          </SurfaceCard>
        </AnimatedContent>

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

        <AnimatedContent delay={160} distance={10}>
          <View style={styles.actions}>
            <Button loading={busy} onPress={() => void save()} testID="import-confirm">{t('Yes, use this wallet')}</Button>
            <Button onPress={() => setDerived(null)} tone="ghost">{t('No, let me check again')}</Button>
          </View>
        </AnimatedContent>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets>
          <AnimatedContent>
            <View style={styles.hero}>
              <Text style={styles.title}>{t('Restore your wallet')}</Text>
              <Text style={styles.subtitle}>{t('Enter the recovery phrase from your existing Stellar wallet. It never leaves this phone.')}</Text>
            </View>
          </AnimatedContent>

          <AnimatedContent delay={80}>
            <View style={styles.tabs}>
              {(['phrase', 'secret'] as const).map(option => (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{selected: method === option}}
                  key={option}
                  onPress={() => {
                    setMethod(option);
                    setError(undefined);
                  }}
                  style={[styles.tab, method === option && styles.tabOn]}
                  testID={`import-method-${option}`}>
                  <Text style={method === option ? styles.tabTextOn : styles.tabText}>
                    {option === 'phrase' ? t('Recovery phrase') : t('Secret key')}
                  </Text>
                </Pressable>
              ))}
            </View>
          </AnimatedContent>

          <AnimatedContent delay={150}>
            {method === 'phrase' ? (
              <TextField
                label={t('Recovery phrase')}
                value={phrase}
                onChangeText={setPhrase}
                placeholder="twelve words, separated by spaces"
                autoCapitalize="none"
                multiline
                maxLength={400}
                hint={wordCount > 0 ? `${wordCount}${t('of 12 words')}` : t('Usually twelve words, in order')}
                testID="import-phrase"
              />
            ) : (
              <TextField
                label={t('Secret key')}
                value={secret}
                onChangeText={setSecret}
                placeholder="S..."
                autoCapitalize="characters"
                mono
                maxLength={56}
                hint={t('The key that starts with an S, not the address that starts with a G')}
                testID="import-secret"
              />
            )}
          </AnimatedContent>

          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

          <AnimatedContent delay={220} distance={10}>
            <Button
              disabled={method === 'phrase' ? wordCount === 0 : secret.trim().length === 0}
              onPress={check}
              testID="import-check">{t('Continue')}</Button>
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
  title: {...typography.display, color: colors.ink, fontSize: 28, lineHeight: 34},
  subtitle: {...typography.body, color: colors.inkMuted},
  tabs: {backgroundColor: colors.surfaceSunken, borderRadius: radius.round, flexDirection: 'row', gap: spacing.xs, padding: spacing.xs},
  tab: {alignItems: 'center', borderRadius: radius.round, flex: 1, paddingVertical: spacing.sm},
  tabOn: {backgroundColor: colors.surfaceRaised},
  tabText: {...typography.label, color: colors.inkMuted, fontSize: 13},
  tabTextOn: {...typography.label, color: colors.ink, fontSize: 13},
  addressCard: {gap: spacing.sm},
  addressLabel: {...typography.label, color: colors.amber, fontSize: 10, letterSpacing: 1.1},
  address: {...typography.mono, color: colors.ink, fontSize: 13, lineHeight: 20},
  actions: {gap: spacing.sm},
  error: {...typography.label, color: colors.danger},
});
