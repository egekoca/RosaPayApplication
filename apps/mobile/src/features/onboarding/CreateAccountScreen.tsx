import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {KeyRound} from 'lucide-react-native';
import {useState} from 'react';
import {KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View} from 'react-native';
import {AnimatedContent, Button, colors, radius, spacing, SurfaceCard, TextField, typography} from '@rosapay/ui';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {generateRecoveryPhrase} from '../wallet/stellarKey';
import {useTranslate} from '../../shared/i18n';

type Props = NativeStackScreenProps<RootStackParams, 'CreateAccount'>;

/**
 * Every new account is an ordinary Stellar account from twelve words.
 *
 * There used to be a choice here, and the secure-hardware wallet was the better
 * half of it: a secp256r1 key minted in the phone that cannot be exported, so
 * cannot be phished or pasted into a fake app. It is still the stronger custody
 * story and the contract for it is still in the tree.
 *
 * It cannot hold Turkish lira. Anchors verify a wallet by having it sign a
 * SEP-10 challenge, the lira anchor publishes no SEP-45, and a contract account
 * has no key that can answer one. Offering a wallet that cannot do the thing
 * this app is for is not a choice, it is a trap that springs at the bank
 * transfer — so the choice is gone and the phrase wallet is what everyone gets.
 *
 * Phones that already hold a smart wallet keep working; nothing here takes one
 * away, and the payment path still follows whichever account exists.
 */
export function CreateAccountScreen({navigation, route}: Props) {
  const t = useTranslate();
  const importing = route.params?.intent === 'import';
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmedName = name.trim();
    setNameError(undefined);
    setError(undefined);

    if (trimmedName.length < 2) {
      setNameError(t('Please enter the name a merchant should see'));
      return;
    }

    // Carried onward rather than saved here. The account is recorded only once
    // a wallet exists, so a setup that fails leaves nothing half-made behind.
    const identity = {name: trimmedName};

    setBusy(true);
    try {
      if (importing) {
        navigation.replace('ImportWallet', identity);
        return;
      }
      // Generated here and passed, never stored: the phrase reaches disk only
      // as the derived secret, and only after the next screen is satisfied the
      // person actually wrote it down.
      navigation.replace('RecoveryPhrase', {...identity, phrase: generateRecoveryPhrase()});
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('Your account could not be created'));
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
              <Text style={styles.title}>{importing ? t('Restore your wallet') : t('Set up your account')}</Text>
              <Text style={styles.subtitle}>{t('Your name is what a merchant sees on a receipt. Everything else stays on this phone.')}</Text>
            </View>
          </AnimatedContent>

          <AnimatedContent delay={90}>
            <View style={styles.fields}>
              <TextField
                label={t('Your name')}
                value={name}
                onChangeText={setName}
                placeholder="Ege Koca"
                autoCapitalize="words"
                maxLength={60}
                error={nameError}
                testID="account-name"
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
                    <Text style={styles.explainerTitle}>{t('Your existing wallet')}</Text>
                    <Text style={styles.explainerBody}>
                      {t('The next screen asks for your recovery phrase. It opens the same account you already use in another wallet, and the address is shown for you to check before anything is saved.')}
                    </Text>
                  </View>
                </View>
              </SurfaceCard>
            </AnimatedContent>
          ) : (
            <AnimatedContent delay={180}>
              <SurfaceCard style={styles.explainer}>
                <View style={styles.explainerRow}>
                  <View style={styles.explainerIcon}>
                    <KeyRound color={colors.amber} size={20} />
                  </View>
                  <View style={styles.explainerCopy}>
                    <Text style={styles.explainerTitle}>{t('Twelve words are your wallet')}</Text>
                    <Text style={styles.explainerBody}>
                      {t('The next screen shows them once. They open this same account in Rosa Pay, Lobstr or Freighter, they are what lets you add money in lira, and they are the only way back if you lose this phone. Nobody can reissue them.')}
                    </Text>
                  </View>
                </View>
              </SurfaceCard>
            </AnimatedContent>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <AnimatedContent delay={260} distance={10}>
            <Button loading={busy} onPress={() => void submit()} testID="create-account">{t('Continue')}</Button>
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
