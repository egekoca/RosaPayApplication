import {Pressable, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {Copy, WalletCards} from 'lucide-react-native';
import {CountUp, GoldCardSurface, spacing, typography} from '@rosapay/ui';
import {AssetMark} from './AssetMark';

/** One state at a time, so the card never says two things at once. */
export type PaymentCardState = 'no-wallet' | 'loading' | 'error' | 'ready';

export type PaymentCardHolding = {code: string; amount: string};

export type PaymentCardProps = {
  holdings: PaymentCardHolding[];
  /** What the balance is worth, when an anchor actually quoted a rate. */
  value?: {amount: string; currency: string};
  address?: string;
  state: PaymentCardState;
  onCopy(): void;
};

/*
 * Set in the small print of a card, so each has to survive being read at eight
 * point in capitals. A sentence does not; these are labels.
 */
const captions: Record<PaymentCardState, string> = {
  'no-wallet': 'NOT YET CREATED',
  loading: 'READING',
  error: 'RECONNECTING',
  ready: 'AVAILABLE',
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
export function PaymentCard({holdings, value, address, state, onCopy}: PaymentCardProps) {
  const {width} = useWindowDimensions();
  // Perspective widens the near edge, so the card is measured a little
  // narrower than its slot; without this the right edge runs off the screen.
  const cardWidth = Math.min(width - spacing.xl * 2 - 14, 500);
  const cardHeight = Math.round(cardWidth * CARD_RATIO);

  const primary = holdings[0];
  // Whatever else is in the wallet. Shown small, because a customer reads the
  // headline number first and only then asks what else is in there.
  const rest = holdings.slice(1);
  const shown = address
    ? `${address.slice(0, 4)} ${address.slice(4, 8)} •••• ${address.slice(-4)}`
    : '•••• •••• •••• ••••';

  return (
    <GoldCardSurface
      animated
      contentStyle={styles.inner}
      height={cardHeight}
      idSuffix="wallet"
      width={cardWidth}>
          <View style={styles.top}>
            <Text style={styles.brand}>LUMENADE PAY</Text>
            <WalletCards color={inkSoft} size={18} strokeWidth={1.8} />
          </View>

          <View style={styles.middle}>
            <View style={styles.amountRow}>
              <AssetMark code={primary?.code ?? 'XLM'} size={26} />
              <CountUp value={Number(primary?.amount ?? 0)} decimals={2} style={styles.amount} />
              <Text style={styles.asset}>{primary?.code ?? 'XLM'}</Text>
            </View>
            {rest.length > 0 ? (
              <View style={styles.rest}>
                {rest.map(holding => (
                  <View key={holding.code} style={styles.restItem}>
                    <AssetMark code={holding.code} size={14} />
                    <Text style={styles.restText}>
                      {Number(holding.amount).toFixed(2)} {holding.code}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          <View style={styles.bottom}>
            <View style={styles.legend}>
              <Text style={styles.legendLabel}>BALANCE</Text>
              <Text style={styles.legendValue}>
                {value ? `≈ ${value.amount} ${value.currency}` : captions[state]}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Copy wallet address"
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
  numberRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.xs},
  number: {...typography.mono, color: ink, fontSize: 12, letterSpacing: 1.4},
});
