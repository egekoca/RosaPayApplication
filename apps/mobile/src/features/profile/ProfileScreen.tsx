import {useState} from 'react';
import {Check, ChevronRight, Copy, Languages, LogOut, SlidersHorizontal, UserRound} from 'lucide-react-native';
import {Modal, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {AnimatedContent, colors, radius, spacing, typography} from '@rosapay/ui';
import {Screen} from '../../shared/Screen';
import {shareValue} from '../../shared/shareAddress';
import {LANGUAGES, languageMeta, useTranslate} from '../../shared/i18n';
import {useAppStore} from '../../state/appStore';
import {useCurrentAccount} from '../wallet/currentAccount';

type ProfileNavigation = {
  navigate(screen: 'DeveloperSettings'): void;
};

/**
 * Everything about the person rather than about the money.
 *
 * The wallet tab is for what you have and what you can do with it; this is for
 * who you are, how the app talks to you, and the way out. They were mixed into
 * one scrolling screen with a settings gear in the corner, which meant the
 * only route to any of it was a small icon nobody looks for.
 */
export function ProfileScreen({navigation}: {navigation?: ProfileNavigation} = {}) {
  const t = useTranslate();
  const identity = useAppStore(state => state.account);
  const language = useAppStore(state => state.language);
  const setLanguage = useAppStore(state => state.setLanguage);
  const signOut = useAppStore(state => state.signOut);
  const account = useCurrentAccount();
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();

  const erase = async () => {
    setError(undefined);
    try {
      await signOut();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('This phone could not erase the key.'));
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <AnimatedContent>
          <View style={styles.header}>
            <View style={styles.avatar}>
              <UserRound color={colors.goldBright} size={30} />
            </View>
            <View style={styles.headerCopy}>
              <Text numberOfLines={1} style={styles.name}>
                {identity?.name ?? t('Profile')}
              </Text>
              <Text numberOfLines={1} style={styles.email}>
                {identity?.email ?? t('No email')}
              </Text>
            </View>
          </View>
        </AnimatedContent>

        {account ? (
          <AnimatedContent delay={70}>
            <Text style={styles.sectionLabel}>{t('WALLET ADDRESS')}</Text>
            <Pressable
              accessibilityLabel={t('Copy address')}
              accessibilityRole="button"
              onPress={() => void shareValue('Wallet address', account.address)}
              style={styles.row}
              testID="copy-address">
              <Text numberOfLines={1} style={styles.mono}>
                {account.address}
              </Text>
              <Copy color={colors.inkMuted} size={17} />
            </Pressable>
          </AnimatedContent>
        ) : null}

        <AnimatedContent delay={120}>
          <Text style={styles.sectionLabel}>{t('LANGUAGE')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setPicking(true)}
            style={styles.row}
            testID="open-language-picker">
            <Languages color={colors.amber} size={19} />
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{t('App language')}</Text>
            </View>
            <Text style={styles.flag}>{languageMeta(language).flag}</Text>
            <Text style={styles.rowValue}>{languageMeta(language).endonym}</Text>
            <ChevronRight color={colors.inkMuted} size={18} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => navigation?.navigate('DeveloperSettings')}
            style={styles.row}
            testID="open-developer-settings">
            <SlidersHorizontal color={colors.inkMuted} size={19} />
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{t('Developer settings')}</Text>
            </View>
            <ChevronRight color={colors.inkMuted} size={18} />
          </Pressable>
        </AnimatedContent>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <AnimatedContent delay={170}>
          {/*
            Two taps, because the key goes with it and no phrase this app holds
            can be handed back afterwards.
          */}
          <Pressable
            accessibilityRole="button"
            onPress={() => (confirming ? void erase() : setConfirming(true))}
            style={[styles.row, styles.dangerRow]}
            testID="sign-out">
            <LogOut color={colors.danger} size={19} />
            <View style={styles.rowCopy}>
              <Text style={[styles.rowTitle, styles.dangerTitle]}>
                {confirming ? t('Tap again to erase') : t('Sign out')}
              </Text>
              <Text style={styles.rowHint}>{t('Erases this account and its key from this phone.')}</Text>
            </View>
          </Pressable>
        </AnimatedContent>
      </ScrollView>

      <Modal
        animationType="fade"
        onRequestClose={() => setPicking(false)}
        statusBarTranslucent
        transparent
        visible={picking}>
        <Pressable onPress={() => setPicking(false)} style={styles.scrim} testID="language-scrim">
          <Pressable onPress={() => undefined} style={styles.sheet}>
            <Text style={styles.sheetTitle}>{t('App language')}</Text>
            {LANGUAGES.map(entry => {
              const active = entry.code === language;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{selected: active}}
                  key={entry.code}
                  onPress={() => {
                    setLanguage(entry.code);
                    setPicking(false);
                  }}
                  style={[styles.option, active && styles.optionSelected]}
                  testID={`language-${entry.code}`}>
                  <Text style={styles.optionFlag}>{entry.flag}</Text>
                  <View style={styles.rowCopy}>
                    <Text style={styles.optionName}>{entry.endonym}</Text>
                    <Text style={styles.rowHint}>{entry.name}</Text>
                  </View>
                  {active ? <Check color={colors.goldBright} size={20} strokeWidth={2.6} /> : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {gap: spacing.md, paddingBottom: spacing.huge},
  header: {alignItems: 'center', flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md},
  avatar: {alignItems: 'center', backgroundColor: colors.goldSoft, borderColor: colors.goldDeep, borderRadius: 999, borderWidth: 1, height: 60, justifyContent: 'center', width: 60},
  headerCopy: {flex: 1, gap: 3},
  name: {...typography.title, color: colors.ink},
  email: {...typography.body, color: colors.inkMuted, fontSize: 14},
  sectionLabel: {...typography.overline, color: colors.inkFaint, marginBottom: spacing.sm, marginTop: spacing.lg},
  row: {alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.lineSoft, borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xs, minHeight: 60, paddingHorizontal: spacing.lg},
  rowCopy: {flex: 1, gap: 2},
  rowTitle: {...typography.body, color: colors.ink, fontSize: 16},
  rowHint: {...typography.body, color: colors.inkFaint, fontSize: 12},
  rowValue: {...typography.body, color: colors.inkMuted, fontSize: 15},
  mono: {...typography.mono, color: colors.ink, flex: 1, fontSize: 12},
  flag: {fontSize: 19},
  dangerRow: {borderColor: 'rgba(255,114,114,0.28)', marginTop: spacing.xl},
  dangerTitle: {color: colors.danger},
  error: {...typography.body, color: colors.danger},
  scrim: {backgroundColor: 'rgba(0,0,0,0.62)', flex: 1, justifyContent: 'flex-end'},
  sheet: {backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, gap: spacing.xs, paddingBottom: spacing.huge, paddingHorizontal: spacing.lg, paddingTop: spacing.lg},
  sheetTitle: {...typography.label, color: colors.inkMuted, marginBottom: spacing.xs},
  option: {alignItems: 'center', borderRadius: radius.lg, flexDirection: 'row', gap: spacing.md, minHeight: 62, paddingHorizontal: spacing.md},
  optionSelected: {backgroundColor: colors.goldSoft},
  optionFlag: {fontSize: 27},
  optionName: {...typography.body, color: colors.ink, fontSize: 17, fontWeight: '600'},
});
