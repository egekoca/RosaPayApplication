import {ExternalLink} from 'lucide-react-native';
import {Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {colors, radius, spacing, StatusPill, typography} from '@rosapay/ui';
import {displayAmount, exactAmount} from '../../shared/displayAmount';
import {useTranslate} from '../../shared/i18n';
import {paymentOutcome} from './paymentOutcome';

/**
 * One request, in the detail a merchant asks for when they tap a row.
 *
 * Tapping did nothing at all before this: the list drew plain views, so a
 * merchant looking for "did that one go through, and where is the proof" had
 * nowhere to go. What they need is the amount as it was asked for, whether it
 * settled, and — when it did — the transaction to point at.
 */
export type MerchantPaymentDetail = {
  intentId: string;
  reference?: string;
  amount: string;
  assetCode: string;
  createdAt: string;
  status: string;
  transactionHash?: string;
  ledger?: number;
  confirmedAt?: string;
};

export function PaymentDetailSheet({
  onClose,
  payment,
}: {
  onClose(): void;
  payment: MerchantPaymentDetail | null;
}) {
  const t = useTranslate();
  if (!payment) return null;

  const outcome = paymentOutcome(payment.status);
  const tone = outcome === 'paid' ? 'success' : outcome === 'open' ? 'pending' : 'danger';

  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible>
      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        style={styles.scrim}
        testID="payment-detail-scrim">
        {/* Stops a tap inside the sheet from closing it. */}
        <Pressable onPress={() => undefined} style={styles.sheet}>
          <ScrollView bounces={false}>
            <View style={styles.header}>
              <Text numberOfLines={2} style={styles.reference}>
                {payment.reference?.trim() || t('Payment request')}
              </Text>
              <StatusPill tone={tone}>{t(outcomeLabel(payment.status))}</StatusPill>
            </View>

            <Text adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} style={styles.amount}>
              {exactAmount(payment.amount)} <Text style={styles.asset}>{payment.assetCode}</Text>
            </Text>

            <Text style={styles.explainer}>{t(outcomeExplainer(payment.status))}</Text>

            <View style={styles.facts}>
              <Fact label={t('Created')} value={when(payment.createdAt)} />
              {payment.confirmedAt ? <Fact label={t('Confirmed')} value={when(payment.confirmedAt)} /> : null}
              {payment.ledger !== undefined ? (
                <Fact label={t('Ledger')} value={String(payment.ledger)} />
              ) : null}
              <Fact label={t('Request')} value={payment.intentId} mono />
            </View>

            {payment.transactionHash ? (
              <>
                <Fact label={t('Transaction')} value={payment.transactionHash} mono />
                <Pressable
                  accessibilityRole="link"
                  onPress={() =>
                    void Linking.openURL(
                      `https://stellar.expert/explorer/testnet/tx/${payment.transactionHash}`,
                    )
                  }
                  style={styles.explorer}
                  testID="payment-detail-explorer">
                  <ExternalLink color={colors.amber} size={17} />
                  <Text style={styles.explorerText}>{t('View on Explorer')}</Text>
                </Pressable>
              </>
            ) : null}

            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={styles.close}
              testID="payment-detail-close">
              <Text style={styles.closeText}>{t('Close')}</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Fact({label, value, mono}: {label: string; value: string; mono?: boolean}) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      {/* Selectable so a hash or an id can be copied out rather than read aloud. */}
      <Text selectable style={[styles.factValue, mono && styles.factMono]}>
        {value}
      </Text>
    </View>
  );
}

/** A date a merchant can place, rather than an ISO string. */
function when(value: string): string {
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? value : at.toLocaleString();
}

export function outcomeLabel(status: string): string {
  switch (status) {
    case 'confirmed':
      return 'PAID';
    case 'expired':
      return 'EXPIRED';
    case 'rejected':
      return 'DECLINED';
    case 'failed':
      return 'FAILED';
    case 'awaiting_approval':
      return 'WAITING';
    default:
      return 'IN PROGRESS';
  }
}

function outcomeExplainer(status: string): string {
  switch (status) {
    case 'confirmed':
      return 'This payment settled on Stellar Testnet.';
    case 'expired':
      return 'Nobody paid this before its five minutes were up. Make a new request to be paid for it.';
    case 'rejected':
      return 'The customer declined this request.';
    case 'failed':
      return 'This payment could not settle. Nothing left the customer’s wallet.';
    case 'awaiting_approval':
      return 'Waiting for a customer. Show the QR or let them hold their phone against yours.';
    default:
      return 'A customer has claimed this request and it is on its way to the chain.';
  }
}

/** Kept beside the sheet so the list row and the detail cannot disagree. */
export function shortAmount(amount: string): string {
  return displayAmount(amount);
}

const styles = StyleSheet.create({
  scrim: {backgroundColor: 'rgba(0,0,0,0.72)', flex: 1, justifyContent: 'flex-end'},
  sheet: {
    backgroundColor: colors.surface,
    borderTopColor: colors.lineSoft,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    maxHeight: '86%',
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {alignItems: 'center', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between'},
  reference: {...typography.label, color: colors.ink, flex: 1, fontSize: 15},
  amount: {...typography.title, color: colors.ink, fontSize: 34, marginTop: spacing.md},
  asset: {...typography.mono, color: colors.goldBright, fontSize: 15},
  explainer: {color: colors.inkMuted, fontSize: 13, lineHeight: 19, marginTop: spacing.sm},
  facts: {gap: spacing.md, marginTop: spacing.lg},
  fact: {gap: 2},
  factLabel: {...typography.overline, color: colors.inkFaint, fontSize: 9, letterSpacing: 1.4},
  factValue: {color: colors.ink, fontSize: 13},
  factMono: {...typography.mono, fontSize: 11, lineHeight: 16},
  explorer: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md},
  explorerText: {color: colors.amber, fontSize: 14, fontWeight: '600'},
  close: {
    alignItems: 'center',
    borderColor: colors.lineSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.xl,
    paddingVertical: spacing.md,
  },
  closeText: {color: colors.inkMuted, fontSize: 14, fontWeight: '600'},
});
