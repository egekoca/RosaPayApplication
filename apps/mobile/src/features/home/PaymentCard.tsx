import {useEffect, useRef} from 'react';
import {Animated, Easing, Pressable, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {Copy} from 'lucide-react-native';
import Svg, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg';
import {colors, CountUp, radius, spacing, typography} from '@rosapay/ui';
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

const captions: Record<PaymentCardState, string> = {
  'no-wallet': 'Created the first time you pay',
  loading: 'Reading your balance',
  error: 'Reconnecting to Stellar',
  ready: 'Available to spend',
};

const CARD_RATIO = 0.63;

/**
 * The wallet as a card in a pocket rather than a dashboard panel.
 *
 * It is gold and it catches the light, because that is what tells you at a
 * glance that this is the thing you pay with. The sweep is a single specular
 * band crossing left to right on a long, slow loop — the way light moves across
 * a real card as you turn it, not a pulse or a glow.
 */
export function PaymentCard({holdings, value, address, state, onCopy}: PaymentCardProps) {
  const {width} = useWindowDimensions();
  const sweep = useRef(new Animated.Value(0)).current;
  const cardWidth = Math.min(width - spacing.xl * 2, 520);
  const cardHeight = Math.round(cardWidth * CARD_RATIO);

  useEffect(() => {
    if (process.env.NODE_ENV === 'test') return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        // A long rest, so the card is mostly still and the sweep is an event.
        Animated.delay(4200),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [sweep]);

  const primary = holdings[0];
  // Whatever else is in the wallet. Shown small, because a customer reads the
  // headline number first and only then asks what else is in there.
  const rest = holdings.slice(1);
  const shown = address
    ? `${address.slice(0, 4)} ${address.slice(4, 8)} •••• ${address.slice(-4)}`
    : '•••• •••• •••• ••••';

  const translateX = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-cardWidth * 0.9, cardWidth * 1.5],
  });

  return (
    <View style={[styles.card, {height: cardHeight}]}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          {/* Gold is never one colour; it is a warm shadow, a bright edge and a
              cooler fall-off, which is what stops it reading as flat yellow. */}
          <LinearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#8A5E10" />
            <Stop offset="0.28" stopColor="#E7B34A" />
            <Stop offset="0.52" stopColor="#FFD777" />
            <Stop offset="0.74" stopColor="#D69A2C" />
            <Stop offset="1" stopColor="#7A4F0B" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#gold)" />
      </Svg>

      <Animated.View
        pointerEvents="none"
        style={[styles.sweep, {height: cardHeight * 2.2, transform: [{translateX}, {rotate: '18deg'}]}]}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="shine" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
              <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.5" />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#shine)" />
        </Svg>
      </Animated.View>

      <View style={styles.inner}>
        <View style={styles.top}>
          <Text style={styles.brand}>LUMENADE</Text>
          <Text style={styles.network}>STELLAR TESTNET</Text>
        </View>

        <View>
          <View style={styles.amountRow}>
            <AssetMark code={primary?.code ?? 'XLM'} size={30} />
            <CountUp value={Number(primary?.amount ?? 0)} decimals={2} style={styles.amount} />
            <Text style={styles.asset}>{primary?.code ?? 'XLM'}</Text>
          </View>
          {rest.length > 0 ? (
            <View style={styles.rest}>
              {rest.map(holding => (
                <View key={holding.code} style={styles.restItem}>
                  <AssetMark code={holding.code} size={16} />
                  <Text style={styles.restText}>
                    {Number(holding.amount).toFixed(2)} {holding.code}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          <Text style={styles.caption}>
            {value ? `≈ ${value.amount} ${value.currency} · ${captions[state]}` : captions[state]}
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
          {address ? <Copy color="rgba(24,18,4,0.6)" size={15} /> : null}
        </Pressable>
      </View>
    </View>
  );
}

/* Dark ink on gold, the way a card is actually printed. */
const ink = '#1C1503';
const inkSoft = 'rgba(28,21,3,0.66)';

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 18},
    shadowOpacity: 0.5,
    shadowRadius: 30,
    elevation: 12,
  },
  sweep: {position: 'absolute', top: '-60%', width: 90},
  inner: {flex: 1, justifyContent: 'space-between', padding: spacing.xl},
  top: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'},
  brand: {...typography.overline, color: ink, fontSize: 12},
  network: {...typography.overline, color: inkSoft, fontSize: 9},
  amountRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm},
  amount: {color: ink, fontSize: 40, fontWeight: '700', letterSpacing: -1.4, lineHeight: 44},
  asset: {...typography.label, color: inkSoft, fontSize: 14, marginTop: 8},
  rest: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xs},
  restItem: {alignItems: 'center', flexDirection: 'row', gap: 6},
  restText: {color: inkSoft, fontSize: 13, fontWeight: '600'},
  caption: {color: inkSoft, fontSize: 12.5, marginTop: spacing.xs},
  numberRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between'},
  number: {...typography.mono, color: ink, fontSize: 14, letterSpacing: 1.6},
});
