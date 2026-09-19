import {useMemo, useState} from 'react';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {KeyRound, ShieldAlert} from 'lucide-react-native';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {AnimatedContent, Button, colors, radius, spacing, SurfaceCard, typography} from '@rosapay/ui';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {fundOnTestnet} from '../wallet/accountSetup';
import {saveSigningKey} from '../wallet/keyVault';
import {keypairFromRecoveryPhrase} from '../wallet/stellarKey';
import {useAppStore} from '../../state/appStore';
import {logger} from '../../shared/logger';

type Props = NativeStackScreenProps<RootStackParams, 'RecoveryPhrase'>;

/** How many words are checked back before the wallet is allowed to exist. */
const CHECKS = 3;

/**
 * The one screen in the app that shows a secret.
 *
 * These twelve words are the account. Nothing on a server can reissue them and
 * no support desk can recover them, so the wallet is not saved until the person
 * has proved they actually wrote some of them down. The check is three words
 * rather than all twelve because the goal is to catch someone tapping through,
 * not to make them type it twice.
 */
export function RecoveryPhraseScreen({route, navigation}: Props) {
  const {phrase} = route.params;
  const setWallet = useAppStore(state => state.setWallet);
  const words = useMemo(() => phrase.split(' '), [phrase]);
  const asked = useMemo(() => pickWordsToCheck(words.length, CHECKS), [words.length]);

  const [stage, setStage] = useState<'read' | 'confirm'>('read');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const options = useMemo(() => buildOptions(words, asked), [words, asked]);
  const answered = asked.every(index => answers[index]);

  async function finish() {
    const wrong = asked.filter(index => answers[index] !== words[index]);
    if (wrong.length > 0) {
      setError('That is not the phrase on the last screen. Go back and check it again.');
      setAnswers({});
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const keypair = keypairFromRecoveryPhrase(phrase);
      await saveSigningKey(keypair.secret());
      // A derived address is not yet an account: the ledger has never heard of
      // it until something funds it. Doing that here means the wallet the
      // customer lands on is one they can actually pay from.
      await fundOnTestnet(keypair.publicKey()).catch(cause => {
        // A wallet that exists but is unfunded is still theirs, and the balance
        // screen says so. Losing the phrase they just wrote down would be worse.
        logger.error('new_wallet_funding_failed', {
          message: cause instanceof Error ? cause.message : 'unknown',
        });
      });
      setWallet({address: keypair.publicKey(), origin: 'created'});
      navigation.replace('Main');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The wallet could not be saved on this phone');
    } finally {
      setBusy(false);
    }
  }

  if (stage === 'read') {
    return (
      <Screen>
        <AnimatedContent>
          <View style={styles.hero}>
            <View style={styles.icon}><KeyRound color={colors.amber} size={22} /></View>
            <Text style={styles.title}>Your recovery phrase</Text>
            <Text style={styles.subtitle}>
              These twelve words are your wallet. Write them down on paper, in this order, and keep them somewhere only
              you can reach.
            </Text>
          </View>
        </AnimatedContent>

        <AnimatedContent delay={90}>
          <View style={styles.grid}>
            {words.map((word, index) => (
              <View key={`${word}-${index}`} style={styles.word}>
                <Text style={styles.wordIndex}>{index + 1}</Text>
                <Text style={styles.wordText}>{word}</Text>
              </View>
            ))}
          </View>
        </AnimatedContent>

        <AnimatedContent delay={160}>
          <SurfaceCard style={styles.warning}>
            <View style={styles.warningRow}>
              <ShieldAlert color={colors.danger} size={20} />
              <Text style={styles.warningText}>
                Anyone with these words can spend your money. Nobody at Lumenade Pay can see them, and nobody can give
                them back to you if they are lost.
              </Text>
            </View>
          </SurfaceCard>
        </AnimatedContent>

        <AnimatedContent delay={230} distance={10}>
          <Button onPress={() => setStage('confirm')} testID="phrase-written-down">
            I have written them down
          </Button>
        </AnimatedContent>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <AnimatedContent>
          <View style={styles.hero}>
            <Text style={styles.title}>Check your phrase</Text>
            <Text style={styles.subtitle}>Tap the word that belongs in each place.</Text>
          </View>
        </AnimatedContent>

        {asked.map((index, position) => (
          <AnimatedContent delay={70 * (position + 1)} key={index}>
            <View style={styles.check}>
              <Text style={styles.checkLabel}>Word {index + 1}</Text>
              <View style={styles.choices}>
                {options[index]!.map(option => {
                  const chosen = answers[index] === option;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{selected: chosen}}
                      key={option}
                      onPress={() => {
                        setError(undefined);
                        setAnswers(current => ({...current, [index]: option}));
                      }}
                      style={[styles.choice, chosen && styles.choiceOn]}
                      testID={`phrase-choice-${index}-${option}`}>
                      <Text style={[styles.choiceText, chosen && styles.choiceTextOn]}>{option}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </AnimatedContent>
        ))}

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

        <AnimatedContent delay={300} distance={10}>
          <View style={styles.actions}>
            <Button disabled={!answered} loading={busy} onPress={() => void finish()} testID="phrase-confirm">
              Create my wallet
            </Button>
            <Button onPress={() => {setAnswers({}); setError(undefined); setStage('read');}} tone="ghost">
              Show the words again
            </Button>
          </View>
        </AnimatedContent>
      </ScrollView>
    </Screen>
  );
}

/** Three positions, spread across the phrase rather than clustered. */
function pickWordsToCheck(total: number, count: number): number[] {
  const picked = new Set<number>();
  while (picked.size < count) {
    picked.add(Math.floor(Math.random() * total));
  }
  return [...picked].sort((a, b) => a - b);
}

/**
 * The decoys come from the phrase itself. Words from the wider BIP-39 list would
 * let someone pass by recognising which word merely looks familiar.
 */
function buildOptions(words: string[], asked: number[]): Record<number, string[]> {
  const options: Record<number, string[]> = {};
  for (const index of asked) {
    const choices = new Set([words[index]!]);
    while (choices.size < 4) {
      choices.add(words[Math.floor(Math.random() * words.length)]!);
    }
    options[index] = [...choices].sort(() => Math.random() - 0.5);
  }
  return options;
}

const styles = StyleSheet.create({
  scroll: {gap: spacing.lg, paddingBottom: spacing.huge},
  hero: {gap: spacing.sm},
  icon: {
    alignItems: 'center',
    backgroundColor: colors.amberSoft,
    borderRadius: radius.round,
    height: 44,
    justifyContent: 'center',
    marginBottom: spacing.xs,
    width: 44,
  },
  title: {...typography.display, color: colors.ink, fontSize: 28, lineHeight: 34},
  subtitle: {...typography.body, color: colors.inkMuted},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  word: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    flexBasis: '47%',
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  wordIndex: {...typography.mono, color: colors.inkFaint, fontSize: 11, minWidth: 16},
  wordText: {...typography.label, color: colors.ink, fontSize: 15},
  warning: {},
  warningRow: {alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md},
  warningText: {color: colors.inkMuted, flex: 1, fontSize: 13, lineHeight: 19},
  check: {gap: spacing.sm},
  checkLabel: {...typography.label, color: colors.amber, fontSize: 12, letterSpacing: 1.1},
  choices: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  choice: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radius.round,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  choiceOn: {backgroundColor: colors.amber, borderColor: colors.amber},
  choiceText: {...typography.label, color: colors.inkMuted, fontSize: 14},
  choiceTextOn: {color: colors.black},
  actions: {gap: spacing.sm},
  error: {...typography.label, color: colors.danger},
});
