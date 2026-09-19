import {Fingerprint, ScanFace} from 'lucide-react-native';
import {useCallback, useEffect, useState} from 'react';
import {Image, Platform, Pressable, StyleSheet, Text, View} from 'react-native';
import {AnimatedContent, Button, colors, radius, spacing, typography} from '@rosapay/ui';
import {Screen} from '../../shared/Screen';
import {useAppStore} from '../../state/appStore';
import {unlockWithDevice} from './deviceUnlock';

/**
 * Shown in place of the whole app while it is locked, so there is nothing behind
 * it to reveal — not a balance, not a receipt, not the request someone was in
 * the middle of paying.
 */
export function UnlockScreen() {
  const account = useAppStore(state => state.account);
  const unlock = useAppStore(state => state.unlock);
  const signOut = useAppStore(state => state.signOut);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

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
      setError(
        result.reason === 'no-key'
          ? 'The payment key for this account is gone. Set up again to continue.'
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

  const greeting = account?.name ? `Welcome back, ${account.name.split(' ')[0]}` : 'Welcome back';

  return (
    <Screen contentStyle={styles.screen}>
      <AnimatedContent>
        <View style={styles.brand}>
          <Image accessibilityLabel="Lumenade Pay" source={require('../../assets/lumenadepay-logo.png')} style={styles.brandMark} />
          <Text style={styles.brandName}>Lumenade Pay</Text>
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
            {error ?? `Unlock with ${Platform.OS === 'ios' ? 'Face ID' : 'your fingerprint'} to see your balance and pay.`}
          </Text>
        </View>
      </AnimatedContent>

      <AnimatedContent delay={180} distance={8}>
        <View style={styles.actions}>
          <Button loading={busy} onPress={() => void attempt()} testID="unlock">
            {error ? 'Try again' : 'Unlock'}
          </Button>
          <Pressable
            accessibilityRole="button"
            onPress={() => (confirmingSignOut ? signOut() : setConfirmingSignOut(true))}
            testID="sign-out">
            <Text style={[styles.signOut, confirmingSignOut && styles.signOutConfirm]}>
              {confirmingSignOut
                ? 'Tap again to erase this account and start over'
                : 'Use a different account'}
            </Text>
          </Pressable>
        </View>
      </AnimatedContent>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {justifyContent: 'center', gap: spacing.xxl},
  brand: {alignItems: 'center', alignSelf: 'center', flexDirection: 'row', gap: spacing.md},
  brandMark: {borderRadius: radius.sm, height: 36, width: 36},
  brandName: {...typography.title, color: colors.ink, fontSize: 18},
  hero: {alignItems: 'center', gap: spacing.lg},
  badge: {alignItems: 'center', backgroundColor: colors.amberSoft, borderRadius: radius.round, height: 84, justifyContent: 'center', width: 84},
  title: {...typography.display, color: colors.ink, fontSize: 28, lineHeight: 34, textAlign: 'center'},
  subtitle: {...typography.body, color: colors.inkMuted, maxWidth: 320, textAlign: 'center'},
  actions: {gap: spacing.lg},
  signOut: {...typography.label, color: colors.inkFaint, textAlign: 'center'},
  signOutConfirm: {color: colors.danger},
});
