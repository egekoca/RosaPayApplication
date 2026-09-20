import {Pressable, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {ChevronDown, Copy, WalletCards} from 'lucide-react-native';
import {CountUp, GoldCardSurface, spacing, typography} from '@rosapay/ui';
import {AssetMark} from './AssetMark';
import {displayAmount} from '../../shared/displayAmount';
import {currencySymbol, displayCurrencyMeta} from '../../shared/priceSource';
import {useTranslate} from '../../shared/i18n';

/** One state at a time, so the card never says two things at once. */
export type PaymentCardState = 'no-wallet' | 'loading' | 'error' | 'ready';

export type PaymentCardHolding = {code: string; amount: string};

export type PaymentCardProps = {
  holdings: PaymentCardHolding[];
  /** What the balance is worth, when a quote server actually priced it. */
  value?: {amount: string; currency: string};
  /** The money the owner asked to read in, shown even before a rate arrives. */
  currency?: string;
  address?: string;
  state: PaymentCardState;
  onCopy(): void;
  /** Cycles the money the balance is read in. Absent means the card is fixed. */
  onChangeCurrency?(): void;
};

/*
 * Set in the small print of a card, so each has to survive being read at eight
 * point in capitals. A sentence does not; these are labels.
 */
const captions: Record<PaymentCardState, string> = {
  'no-wallet': 'SETUP REQUIRED',
  loading: 'READING',
  error: 'RECONNECTING',
  ready: '',
};

/** A payment card is 85.6 by 53.98 millimetres, everywhere in the world. */
const CARD_RATIO = 53.98 / 85.6;

/**
 * The wallet as a card you are holding, rather than a panel in a dashboard.
 *
 * Three things do the work. It sits in space rather than flat against the
 * screen, because a card perfectly square to you is a picture of a card. Its
 * gold is marbled — turbulence pushing the gradient around — since real metal
 * is never one even wash, and an even wash is exactly what reads as generated.
 * And the type is set the way a card is printed: a few small monospaced marks
 * in the corners around one large number.
 *
 * The sweep is a single specular band crossing on a long, slow loop, the way
 * light travels over metal as you turn it. Not a pulse, and not a glow.
 */
export function PaymentCard({holdings, value, currency, address, state, onCopy, onChangeCurrency}: PaymentCardProps) {
  const t = useTranslate();
  const {width} = useWindowDimensions();
  // Perspective widens the near edge, so the card is measured a little
  // narrower than its slot; without this the right edge runs off the screen.
  const cardWidth = Math.min(width - spacing.xl * 2 - 14, 500);
  const cardHeight = Math.round(cardWidth * CARD_RATIO);

  const primary = holdings[0];
  // Whatever else is in the wallet. Shown small, because a customer reads the
  // headline number first and only then asks what else is in there.
  const rest = holdings.slice(1);
  const shownCurrency = value?.currency ?? currency ?? 'TRY';
  const shown = address
    ? `${address.slice(0, 4)} ${address.slice(4, 8)} •••• ${address.slice(-4)}`
    : '•••• •••• •••• ••••';

  return (
    <GoldCardSurface
      animated
      contentStyle={styles.inner}
      height={cardHeight}
      idSuffix="wallet"
      interactive
      width={cardWidth}>
          {/*
            The app's name was printed here and again in the header directly
            above it. A card carries the issuer's mark, not its name twice.
          */}
          <View style={styles.top}>
            <WalletCards color={inkSoft} size={18} strokeWidth={1.8} />
          </View>

          <View style={styles.middle}>
            <View style={styles.amountRow}>
              <AssetMark code={primary?.code ?? 'XLM'} size={26} />
              {/*
                An empty `holdings` array means two different things and looked
                like one: a wallet that truly holds nothing, and a read that
                has not landed yet — loading, or the RPC call failing outright.
                Animating to 0.00 in both cases put an owner's real balance a
                single flaky read away from looking spent, with nothing to
                notice but a caption at the bottom of the card. Only a `ready`
                state has actually asked the chain and gotten an answer, so
                only it earns the number; anything else holds this dash, which
                cannot be mistaken for a balance.
              */}
              {state === 'ready' ? (
                <CountUp value={Number(primary?.amount ?? 0)} decimals={2} style={styles.amount} />
              ) : (
                <Text style={styles.amount}>—</Text>
              )}
              <Text style={styles.asset}>{primary?.code ?? 'XLM'}</Text>
            </View>
            {/*
              Directly under the headline, because "and that is worth X" is the
              second thing anyone asks and the eye is already here. It spent a
              version down in the card's small print at the size of the address,
              which made the most-read number on the card the hardest to read.
            */}
            {onChangeCurrency || value ? (
              <Pressable
                accessibilityHint={onChangeCurrency ? 'Changes the money this balance is shown in' : undefined}
                accessibilityLabel={
                  value
                    ? `Worth ${value.amount} ${displayCurrencyMeta(shownCurrency).name}`
                    : `Reading the rate in ${displayCurrencyMeta(shownCurrency).name}`
                }
                accessibilityRole={onChangeCurrency ? 'button' : 'text'}
                disabled={!onChangeCurrency}
                hitSlop={10}
                onPress={onChangeCurrency}
                style={styles.conversion}
                testID="balance-currency">
                <Text style={styles.flag}>{displayCurrencyMeta(shownCurrency).flag}</Text>
                {/*
                  The row keeps its place while the rate loads. Rendering it
                  only once a value arrives made the card change height on its
                  own and took the currency control away exactly when someone
                  had just tapped it.
                */}
                <Text style={[styles.conversionValue, !value && styles.conversionPending]}>
                  {value ? `≈ ${currencySymbol(value.currency)}${value.amount} ${value.currency}` : `≈ —  ${currencySymbol(shownCurrency)}${shownCurrency}`}
                </Text>
                {onChangeCurrency ? <ChevronDown color={ink} size={17} strokeWidth={2.6} /> : null}
              </Pressable>
            ) : null}
            {rest.length > 0 ? (
              <View style={styles.rest}>
                {rest.map(holding => (
                  <View key={holding.code} style={styles.restItem}>
                    <AssetMark code={holding.code} size={14} />
                    <Text style={styles.restText}>
                      {displayAmount(holding.amount)} {holding.code}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          <View style={styles.bottom}>
            {/*
              "BALANCE" over "AVAILABLE" was two labels for one fact anybody
              holding a wallet already knows. What is worth saying is when the
              card is *not* showing a balance, so only that is said.
            */}
            <View style={styles.legend}>
              {state === 'ready' ? null : <Text style={styles.legendValue}>{captions[state]}</Text>}
            </View>
            <Pressable
              accessibilityLabel={t('Copy wallet address')}
              accessibilityRole="button"
              disabled={!address}
              onPress={onCopy}
              style={styles.numberRow}
              testID="copy-wallet-address">
              <Text style={styles.number}>{shown}</Text>
              {address ? <Copy color={inkSoft} size={13} /> : null}
            </Pressable>
          </View>
    </GoldCardSurface>
  );
}

/* Dark ink on gold, the way a card is actually printed. */
const ink = '#1C1503';
const inkSoft = 'rgba(28,21,3,0.62)';

const styles = StyleSheet.create({
  inner: {flex: 1, justifyContent: 'space-between', padding: spacing.lg},
  top: {alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between'},
  /* Small, wide-tracked, monospaced: the marks a card carries, not headings. */
  brand: {...typography.mono, color: ink, fontSize: 9.5, letterSpacing: 2.4},
  middle: {gap: spacing.xs},
  amountRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm},
  amount: {...typography.display, color: ink, fontSize: 38, lineHeight: 42},
  asset: {...typography.mono, color: inkSoft, fontSize: 12, letterSpacing: 1.4, marginTop: 10},
  rest: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md},
  restItem: {alignItems: 'center', flexDirection: 'row', gap: 5},
  restText: {...typography.mono, color: inkSoft, fontSize: 11, letterSpacing: 0.6},
  bottom: {alignItems: 'flex-end', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between'},
  legend: {gap: 2},
  legendLabel: {...typography.mono, color: inkSoft, fontSize: 7.5, letterSpacing: 1.8},
  legendValue: {...typography.mono, color: ink, fontSize: 9.5, letterSpacing: 1.2},
  /*
   * A plate under the row, because this sits on marbled metal. Mono type at
   * small sizes disappeared into the gradient — the letterforms are thin and
   * the background moves. A slightly darker ground and the sans face at
   * seventeen give it an edge to read against without putting a box on a card
   * that is otherwise all open surface.
   */
  conversion: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(28,21,3,0.10)',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 8,
    marginTop: 7,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  conversionValue: {...typography.body, color: ink, fontSize: 17, fontWeight: '600', letterSpacing: 0.2},
  conversionPending: {color: inkSoft},
  flag: {fontSize: 19},
  numberRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.xs},
  number: {...typography.mono, color: ink, fontSize: 12, letterSpacing: 1.4},
});
