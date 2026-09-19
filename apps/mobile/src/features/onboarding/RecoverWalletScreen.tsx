import {useState} from 'react';
import {useMutation} from '@tanstack/react-query';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {KeyRound, ShieldCheck, Smartphone} from 'lucide-react-native';
import {StyleSheet, Text, View} from 'react-native';
import {AnimatedContent, Button, colors, spacing, SplitText, SurfaceCard, typography} from '@rosapay/ui';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {useTranslate} from '../../shared/i18n';
import {logger} from '../../shared/logger';
import {
  findRecoverableWallet,
  recoverWallet,
  WalletRecoveryError,
} from '../wallet/walletRecovery';
import {useAppStore} from '../../state/appStore';

type Props = NativeStackScreenProps<RootStackParams, 'RecoverWallet'>;

/**
 * Getting a wallet back on a phone that has never seen it.
 *
 * There is nothing to type here, which is the point. The old phone's key could
 * never be copied anywhere, so there was never a phrase to write down; what
 * crossed over is the passkey, and the platform brought it. The screen asks for
 * it once to find the wallet and once to authorize the move, because those are
 * two different things and merging them would mean asking for authority before
 * the customer has been told what they are authorizing.
 */
export function RecoverWalletScreen({navigation}: Props) {
  const t = useTranslate();
  const createAccount = useAppStore(state => state.createAccount);
  const [found, setFound] = useState<{
    walletContractId: string;
    retiredSigner: string;
    credentialId: string;
  }>();

  const find = useMutation({
    mutationFn: () => findRecoverableWallet(),
    onSuccess: setFound,
    onError: error => logger.info('wallet_recovery_lookup_failed', {code: codeOf(error)}),
  });

  const recover = useMutation({
    mutationFn: async () => {
      if (!found) throw new WalletRecoveryError('NOT_FOUND', 'No wallet has been found yet.');
      // The public key is read back from the assertion during authorization, so
      // only the credential id has to survive the lookup.
      return recoverWallet({
        walletContractId: found.walletContractId,
        retiredSigner: found.retiredSigner,
        credential: {credentialId: found.credentialId, publicKey: ''},
      });
    },
    onSuccess: () => {
      // The account record is only written once the wallet is really back, so a
      // recovery that failed halfway leaves nothing behind to be confused by.
      createAccount({name: 'Lumenade Pay'});
      navigation.reset({index: 0, routes: [{name: 'Main'}]});
    },
    onError: error => logger.error('wallet_recovery_failed', {code: codeOf(error)}),
  });

  const busy = find.isPending || recover.isPending;
  const error = find.error ?? recover.error;

  return (
    <Screen>
      <AnimatedContent>
        <Text style={styles.eyebrow}>{t('RECOVER')}</Text>
        <SplitText delay={90} splitBy="word" style={styles.title} text={t('Bring your wallet to this phone')} />
      </AnimatedContent>

      <AnimatedContent delay={120}>
        <SurfaceCard style={styles.card}>
          <Step
            icon={<KeyRound color={colors.amber} size={18} />}
            title={t('There is nothing to type')}
            body={t(
              'Your old phone held a key that could never leave it, so there was never a phrase to write down. Your passkey is what carries the wallet across.',
            )}
          />
          <Step
            icon={<Smartphone color={colors.amber} size={18} />}
            title={t('This phone makes a new key')}
            body={t('It is created here and stays here, exactly as the old one did.')}
          />
          <Step
            icon={<ShieldCheck color={colors.amber} size={18} />}
            title={t('The old key stops working')}
            body={t('Whoever finds your old phone cannot spend from this wallet afterwards.')}
            last
          />
        </SurfaceCard>
      </AnimatedContent>

      {found ? (
        <AnimatedContent delay={60}>
          <SurfaceCard style={styles.found}>
            <Text style={styles.foundLabel}>{t('WALLET FOUND')}</Text>
            <Text selectable style={styles.mono}>
              {found.walletContractId}
            </Text>
            <Text style={styles.hint}>
              {t('Approving moves it to this phone. Nothing is spent.')}
            </Text>
          </SurfaceCard>
        </AnimatedContent>
      ) : null}

      {error ? <Text style={styles.error}>{describe(error, t)}</Text> : null}

      <Button
        loading={busy}
        onPress={() => (found ? recover.mutate() : find.mutate())}
        testID="recover-wallet">
        {found ? t('Move it to this phone') : t('Find my wallet')}
      </Button>
    </Screen>
  );
}

function codeOf(error: unknown): string {
  return error instanceof WalletRecoveryError ? error.code : 'unknown';
}

/** Each refusal says what the customer can do about it, or that nothing can. */
function describe(error: unknown, t: (text: string) => string): string {
  if (!(error instanceof WalletRecoveryError)) {
    return t('Something went wrong. Try again.');
  }
  switch (error.code) {
    case 'NO_PASSKEY':
      return t('This phone has no passkey for a Lumenade Pay wallet. Sign in on a phone that does, or create a new wallet.');
    case 'NOT_FOUND':
      return t('That passkey does not belong to a Lumenade Pay wallet.');
    case 'CANCELLED':
      return t('You dismissed the prompt, so nothing was changed.');
    default:
      return t('The wallet could not be moved to this phone. Nothing was changed; try again.');
  }
}

function Step({
  icon,
  title,
  body,
  last,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.step, last && styles.stepLast]}>
      <View style={styles.stepIcon}>{icon}</View>
      <View style={styles.stepCopy}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepBody}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: {...typography.label, color: colors.amber, fontSize: 10, letterSpacing: 1.1},
  title: {...typography.title, color: colors.ink, fontSize: 26, marginTop: 2},
  card: {gap: spacing.md},
  step: {
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  stepLast: {borderBottomWidth: 0, paddingBottom: 0},
  stepIcon: {paddingTop: 2},
  stepCopy: {flex: 1, gap: 2},
  stepTitle: {...typography.label, color: colors.ink, fontSize: 13},
  stepBody: {color: colors.inkMuted, fontSize: 12, lineHeight: 17},
  found: {gap: spacing.xs},
  foundLabel: {...typography.label, color: colors.amber, fontSize: 10, letterSpacing: 1.1},
  mono: {...typography.mono, color: colors.ink, fontSize: 11},
  hint: {color: colors.inkMuted, fontSize: 12},
  error: {...typography.label, color: colors.danger},
});
