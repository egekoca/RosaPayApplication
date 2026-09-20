import {useEffect, useRef, useState} from 'react';
import {decodeOfflineSessionMessage, type SignedPaymentIntentV1} from '@rosapay/protocol';
import {createStellarConfig, type SettlementPipelineProgress} from '@rosapay/stellar';
import {subscribeToProximityMessages} from '../../native/nativeProximity';
import {logger} from '../../shared/logger';
import {useAppStore} from '../../state/appStore';
import {openOfflineChannel} from '../payments/offlineChannel';
import {createLifecycleReporter} from '../payments/paymentLifecycle';
import {createRemoteRelayerSigner, type RelayerIdentity} from '../payments/testnetSettlement';
import type {MerchantProfile} from './merchantProfile';
import {settleOverCounter} from './offlineCounter';

/**
 * What the counter is doing, for the merchant standing behind it.
 *
 * A customer in airplane mode holds their phone up, approves, and waits. The
 * merchant's screen is the only one in the room that can say what the chain is
 * doing, so it has to say it — otherwise both people are looking at two phones
 * that appear to be doing nothing.
 */
export type OfflineCounterState =
  | {status: 'idle'}
  | {status: 'preparing'; customerAddress: string}
  | {status: 'awaiting-approval'; customerAddress: string}
  | {status: 'submitting'; customerAddress: string; transactionHash?: string}
  | {status: 'confirmed'; customerAddress: string; transactionHash: string; ledger: number}
  | {status: 'failed'; customerAddress: string; message: string};

export type OfflineCounterInput = {
  request: SignedPaymentIntentV1 | null;
  profile: MerchantProfile | null;
  relayer: RelayerIdentity | undefined;
  latestLedger: number | undefined;
  /** False once the request is paid, cancelled or expired. */
  enabled: boolean;
};

/**
 * Answers customers who want to pay this request without a network.
 *
 * The merchant already advertises the request over Bluetooth; this is what
 * happens when a customer answers it. Everything needing a chain runs here,
 * because this is the phone that has one, and the customer is asked for exactly
 * one thing: a signature over the invocation this simulation produced.
 */
export function useOfflineCounter(input: OfflineCounterInput): OfflineCounterState {
  const [state, setState] = useState<OfflineCounterState>({status: 'idle'});
  const baseUrl = useAppStore(state => state.apiBaseUrl);
  // One customer at a time. Two phones held to the same till would otherwise
  // race for one intent, and only one of them can have it.
  const busy = useRef(false);
  const {request, profile, relayer, latestLedger, enabled} = input;

  /**
   * The ledger, read rather than depended on.
   *
   * It is re-read every five seconds, and as a dependency it tore the listener
   * down and rebuilt it on that same clock — for a number only used once, when
   * a customer arrives. A `payer` message landing in one of those gaps would
   * have reached nobody.
   */
  const ledgerRef = useRef(latestLedger);
  ledgerRef.current = latestLedger;

  /**
   * Which request this screen is actually showing, so a session that outlives
   * it cannot report a stranger's payment onto the next one.
   */
  const showing = useRef<string | undefined>(undefined);
  showing.current = request?.intent.intentId;

  useEffect(() => {
    if (!enabled || !request || !profile || !relayer) return;
    // Only the merchant that signed the request can settle it: the contract
    // digest is signed with the key that made it.
    if (request.intent.merchantSigningKey !== profile.signingKey) return;

    let cancelled = false;
    const intentId = request.intent.intentId;

    const unsubscribe = subscribeToProximityMessages(message => {
      if (message.kind !== 'payer' || busy.current || cancelled) return;
      const claim = decodeOfflineSessionMessage('payer', message.payload);
      if (!claim || claim.intentId !== intentId) return;

      busy.current = true;
      const channel = openOfflineChannel(message.peerId);
      const customerAddress = claim.payer;
      setState({status: 'preparing', customerAddress});

      const ledger = ledgerRef.current;
      if (ledger === undefined) {
        busy.current = false;
        setState({status: 'failed', customerAddress, message: 'Testnet is unreachable from this phone'});
        void channel
          .send('decline', {v: 'RTP/1', intentId, reason: 'The merchant cannot reach Stellar right now'})
          .catch(() => undefined);
        return;
      }

      const reporter = createLifecycleReporter(intentId, customerAddress);
      const onProgress = (progress: SettlementPipelineProgress) => {
        reporter.record(progress);
        if (showing.current !== intentId) return;
        if (progress.stage === 'simulated') setState({status: 'awaiting-approval', customerAddress});
        if (progress.stage === 'authorized') setState({status: 'submitting', customerAddress});
        if (progress.stage === 'submitted') {
          setState({
            status: 'submitting',
            customerAddress,
            ...(progress.transactionHash ? {transactionHash: progress.transactionHash} : {}),
          });
        }
      };

      void settleOverCounter({
        payload: request,
        customerAddress,
        config: createStellarConfig('testnet', {settlementContractId: relayer.settlementContractId}),
        relayer,
        relayerSigner: createRemoteRelayerSigner(baseUrl),
        signingSecret: profile.developmentSigningSecret,
        latestLedger: ledger,
        channel,
        onProgress,
      })
        .then(async receipt => {
          // Said before this screen is told, because saying it is what ends the
          // customer's wait and because a settled request stops being offered:
          // the advertisement this link lives on goes down with it. The
          // customer's phone cannot look a transaction up for itself.
          await channel
            .send('result', {
              v: 'RTP/1',
              intentId,
              status: 'confirmed',
              transactionHash: receipt.transactionHash,
              ledger: receipt.ledger,
            })
            .catch(() => undefined);
          if (showing.current === intentId) setState({status: 'confirmed', customerAddress, ...receipt});
          logger.info('offline_counter_settled', {intentId, transactionHash: receipt.transactionHash});
          await reporter.flush();
        })
        .catch(async error => {
          const message = error instanceof Error ? error.message : 'This payment could not be settled';
          await channel
            .send('result', {v: 'RTP/1', intentId, status: 'failed', message: message.slice(0, 400)})
            .catch(() => undefined);
          if (showing.current === intentId) setState({status: 'failed', customerAddress, message});
          logger.error('offline_counter_failed', {intentId, message});
        })
        .finally(() => {
          busy.current = false;
          // A moment for the last message to reach a phone that has no other
          // way of hearing it, then the link goes.
          setTimeout(() => channel.close({release: true}), 1_500);
        });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [baseUrl, enabled, profile, relayer, request]);

  return state;
}
