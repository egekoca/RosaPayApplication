import {Fingerprint, ScanFace} from 'lucide-react-native';
import {useCallback, useEffect, useState} from 'react';
import {Platform, Pressable, StyleSheet, Text, View} from 'react-native';
import {AnimatedContent, Button, colors, radius, spacing, typography} from '@rosapay/ui';
import {Screen} from '../../shared/Screen';
import {RosaMark, RosaWordmark} from '../../shared/RosaMark';
import {useAppStore} from '../../state/appStore';
import {unlockWithDevice} from './deviceUnlock';
import {useTranslate} from '../../shared/i18n';

/**
 * Shown in place of the whole app while it is locked, so there is nothing behind
 * it to reveal — not a balance, not a receipt, not the request someone was in
 * the middle of paying.
 */
export function UnlockScreen() {
  const t = useTranslate();
  const account = useAppStore(state => state.account);
  const unlock = useAppStore(state => state.unlock);
  const signOut = useAppStore(state => state.signOut);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  /**
   * Whether unlocking can ever succeed again. When the key is gone, offering
   * "Try again" strands the owner on a screen that will refuse them forever —
   * which is exactly what happens after the phone's screen lock is changed.
   */
  const [stranded, setStranded] = useState(false);

  const attempt = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await unlockWithDevice();
      if (result.ok) {
        unlock();
        return;
      }
      // A session whose key is gone can never be unlocked, so the only honest
      // way forward is to start again rather than to keep asking.
      setStranded(result.reason === 'no-key');
      setError(
        result.reason === 'no-key'
          ? `${result.message}. Setting up again makes a new one — the old account cannot be recovered.`
          : result.message,
      );
    } finally {
      setBusy(false);
    }
  }, [unlock]);

  // Ask straight away, so returning is one prompt rather than a tap then a prompt.
  useEffect(() => {
    void attempt();
  }, [attempt]);

  const greeting = account?.name ? `${t('Welcome back')}, ${account.name.split(' ')[0]}` : t('Welcome back');

  const eraseAccount = useCallback(async () => {
    setError(undefined);
    try {
      await signOut();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('This device could not erase the payment key.'));
    }
  }, [signOut, t]);

  return (
    <Screen contentStyle={styles.screen}>
      <AnimatedContent>
        <View style={styles.brand}>
          <RosaMark motion={busy ? 'spin' : 'float'} showOrbit size={58} />
          <RosaWordmark compact />
        </View>
      </AnimatedContent>

      <AnimatedContent delay={90} distance={16}>
        <View style={styles.hero}>
          <View style={styles.badge}>
            {Platform.OS === 'ios' ? (
              <ScanFace color={colors.amber} size={34} />
            ) : (
              <Fingerprint color={colors.amber} size={34} />
            )}
          </View>
          <Text style={styles.title}>{greeting}</Text>
          <Text style={styles.subtitle}>
            {error ?? `${t('Unlock with')} ${Platform.OS === 'ios' ? 'Face ID' : t('your fingerprint')} ${t('to see your balance and pay.')}`}
          </Text>
        </View>
      </AnimatedContent>

      <AnimatedContent delay={180} distance={8}>
        <View style={styles.actions}>
          {stranded ? (
            // One tap, not two. The usual confirmation guards something worth
            // keeping; here the key is already destroyed, so there is nothing
            // left to protect the owner from losing.
            <Button onPress={eraseAccount} testID="set-up-again">{t('Set up this device again')}</Button>
          ) : (
            <>
              <Button loading={busy} onPress={() => void attempt()} testID="unlock">
                {error ? t('Try again') : t('Unlock')}
              </Button>
              <Pressable
                accessibilityRole="button"
                onPress={() => (confirmingSignOut ? eraseAccount() : setConfirmingSignOut(true))}
                testID="sign-out">
                <Text style={[styles.signOut, confirmingSignOut && styles.signOutConfirm]}>
                  {confirmingSignOut
                    ? t('Tap again to erase this account and start over')
                    : t('Use a different account')}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </AnimatedContent>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {justifyContent: 'center', gap: spacing.xxl},
  brand: {alignItems: 'center', alignSelf: 'center', gap: spacing.sm},
  hero: {alignItems: 'center', gap: spacing.lg},
  badge: {alignItems: 'center', backgroundColor: colors.amberSoft, borderRadius: radius.round, height: 84, justifyContent: 'center', width: 84},
  title: {...typography.display, color: colors.ink, fontSize: 28, lineHeight: 34, textAlign: 'center'},
  subtitle: {...typography.body, color: colors.inkMuted, maxWidth: 320, textAlign: 'center'},
  actions: {gap: spacing.lg},
  signOut: {...typography.label, color: colors.inkFaint, textAlign: 'center'},
  signOutConfirm: {color: colors.danger},
});
