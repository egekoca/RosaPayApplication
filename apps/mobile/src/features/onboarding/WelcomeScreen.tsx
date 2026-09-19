import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {AnimatedContent, Button, colors, spacing, typography} from '@rosapay/ui';
import type {RootStackParams} from '../../app/navigation';
import {RosaMark, RosaWordmark} from '../../shared/RosaMark';
import {Screen} from '../../shared/Screen';
import {useTranslate} from '../../shared/i18n';

type Props = NativeStackScreenProps<RootStackParams, 'Welcome'>;

/**
 * The first screen, and the one with the least to say.
 *
 * It used to carry the mark, an origin badge, a two-line headline, a paragraph
 * of subtitle, three feature rows, a button, two links and a footnote — nine
 * things competing before anyone had done anything. What a person needs here is
 * to recognise the app and find their way in, so this is the mark, the name, one
 * line, and the two roads. Everything the removed copy explained belongs on the
 * screens that ask for it, where it is an answer rather than a preamble.
 */
export function WelcomeScreen({navigation}: Props) {
  const t = useTranslate();

  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.brand}>
        <AnimatedContent distance={18} scaleFrom={0.94}>
          <RosaMark motion="float" showOrbit size={124} />
        </AnimatedContent>

        <AnimatedContent delay={140} distance={14}>
          <View style={styles.name}>
            <RosaWordmark hero />
            <Text style={styles.slogan}>{t('Scan. Approve. Settled.')}</Text>
          </View>
        </AnimatedContent>
      </View>

      <AnimatedContent delay={280} distance={10} style={styles.actionsWrap}>
        <View style={styles.actions}>
          <Button
            onPress={() => navigation.navigate('CreateAccount', {intent: 'create'})}
            testID="get-started">
            {t('Create a new wallet')}
          </Button>
          {/*
            A button rather than the text link it was. Most people arriving here
            have no Stellar account, so this is not the main road — but it is a
            road, and someone who already has a wallet should not have to read
            past the primary action to find it.
          */}
          <Button
            onPress={() => navigation.navigate('CreateAccount', {intent: 'import'})}
            testID="restore-wallet"
            tone="secondary">
            {t('I already have a wallet')}
          </Button>
          {/*
            Kept, and kept quiet. Someone whose phone is gone has nothing to
            type — the key that controlled the wallet never left that handset —
            so this is a different road from importing a phrase, and a recovery
            nobody can find is not one. It stays a link because it is the rarest
            of the three, not because it matters least.
          */}
          <Pressable
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => navigation.navigate('RecoverWallet')}
            testID="recover-wallet-entry">
            <Text style={styles.recover}>{t('I lost my phone')}</Text>
          </Pressable>
        </View>
      </AnimatedContent>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // The mark and the name take the room they need and the actions sit under
  // them, rather than everything being packed against the top.
  screen: {gap: spacing.huge, justifyContent: 'center'},
  brand: {alignItems: 'center', gap: spacing.xl},
  name: {alignItems: 'center', gap: spacing.sm},
  slogan: {
    ...typography.label,
    color: colors.inkMuted,
    fontSize: 14,
    // Letter-spaced because it reads as a mark of its own under the name, not
    // as the first sentence of a paragraph.
    letterSpacing: 1.6,
    textAlign: 'center',
  },
  actionsWrap: {width: '100%'},
  actions: {gap: spacing.md},
  recover: {
    ...typography.label,
    color: colors.inkFaint,
    marginTop: spacing.xs,
    paddingVertical: spacing.sm,
    textAlign: 'center',
  },
});
