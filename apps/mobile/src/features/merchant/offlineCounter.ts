import {Buffer} from 'buffer';
import {sign as signEd25519} from '@noble/ed25519';
import {xdr} from '@stellar/stellar-sdk';
import type {SignedPaymentIntentV1} from '@rosapay/protocol';
import {
  buildSettlementEnvelope,
  createSettlementClient,
  settleSignedPayment,
  type SettlementPipelineProgress,
  type StellarConfig,
} from '@rosapay/stellar';
import type {OfflineChannel} from '../payments/offlineChannel';
import type {RelayerIdentity} from '../payments/testnetSettlement';
import {assertRelayerIdentity} from '../payments/testnetSettlement';

/**
 * Taking a payment from a phone that has no network, from the merchant's side.
 *
 * Everything that needs a chain happens here, because this is the half that has
 * one. The merchant simulates the settlement, which is what produces the
 * invocation, the nonce and the footprint; hands the customer the single
 * authorization entry that comes out of it; and submits the transaction once
 * the signature comes back. The customer only ever signs.
 *
 * This is the same pipeline every other payment runs. The only thing replaced
 * is where the customer's signature comes from — a radio rather than this
 * phone's own keystore — which is why an offline payment settles into exactly
 * the same transaction, contract call and receipt as an online one.
 */
export class OfflineCounterError extends Error {
  override readonly name = 'OfflineCounterError';
  constructor(
    readonly code: 'WRONG_CUSTOMER' | 'NOT_AUTHORIZED' | 'UNREADABLE_AUTHORIZATION',
    message: string,
  ) {
    super(message);
  }
}

/** How long the customer is given to read the amount and answer the prompt. */
export const OFFLINE_APPROVAL_TIMEOUT_MS = 120_000;

export type OfflineCounterInput = {
  payload: SignedPaymentIntentV1;
  /** The wallet that said it is paying, over the radio. */
  customerAddress: string;
  config: StellarConfig;
  relayer: RelayerIdentity;
  relayerSigner: {signTransaction(xdr: string): Promise<{signedTxXdr: string}>};
  /** The merchant's RTP/1 signing secret, which lives only on this phone. */
  signingSecret: Uint8Array;
  latestLedger: number;
  channel: OfflineChannel;
  approvalTimeoutMs?: number;
  onProgress?(progress: SettlementPipelineProgress): void;
};

export type OfflineCounterReceipt = {transactionHash: string; ledger: number};

export async function settleOverCounter(input: OfflineCounterInput): Promise<OfflineCounterReceipt> {
  assertRelayerIdentity(input.config, input.relayer);
  const {intent} = input.payload;
  const config = {...input.config, settlementContractId: input.relayer.settlementContractId};

  // The contract verifies a merchant signature over a digest that names the
  // payer, so it cannot be produced when the request is made — only now, when
  // someone has said they are paying it.
  const envelope = buildSettlementEnvelope(intent, {
    customer: input.customerAddress,
    networkPassphrase: config.networkPassphrase,
    settlementContractId: input.relayer.settlementContractId,
  });
  const digestClient = createSettlementClient(config, {publicKey: input.relayer.address});
  const digest = (await digestClient.intent_digest({intent: envelope.intent}, {simulate: true})).result;
  const merchantContractSignature = await signEd25519(Uint8Array.from(digest), input.signingSecret);

  const receipt = await settleSignedPayment({
    payload: input.payload,
    config,
    customerAddress: input.customerAddress,
    relayerAddress: input.relayer.address,
    latestLedger: input.latestLedger,
    merchantContractSignature,
    relayerSigner: input.relayerSigner,
    ...(input.onProgress ? {onProgress: input.onProgress} : {}),

    /**
     * The customer's signature, fetched over the radio instead of from a
     * keystore on this phone.
     *
     * The pipeline hands over the exact entry it needs authorized and the
     * ledger it stays valid until, which is precisely what an offline customer
     * has to see. Everything it sends back is checked before it is used: an
     * entry for a different payment, or authorized by a wallet that is not the
     * one being charged, is refused here rather than at submission.
     */
    customerAuthorizeEntry: async (entry, _signer, validUntilLedger, networkPassphrase) => {
      await input.channel.send('authRequest', {
        v: 'RTP/1',
        intentId: intent.intentId,
        networkPassphrase: networkPassphrase ?? config.networkPassphrase,
        settlementContractId: input.relayer.settlementContractId,
        entryXdr: entry.toXDR('base64'),
        signatureExpirationLedger: validUntilLedger,
        latestLedger: input.latestLedger,
      });

      const answer = await input.channel.next(
        'authorization',
        input.approvalTimeoutMs ?? OFFLINE_APPROVAL_TIMEOUT_MS,
      );
      if (answer.intentId !== intent.intentId) {
        throw new OfflineCounterError('NOT_AUTHORIZED', 'That phone approved a different payment');
      }
      if (answer.authorizer !== input.customerAddress) {
        throw new OfflineCounterError('WRONG_CUSTOMER', 'That approval came from a different wallet');
      }

      let signed: xdr.SorobanAuthorizationEntry;
      try {
        signed = xdr.SorobanAuthorizationEntry.fromXDR(answer.entryXdr, 'base64');
      } catch {
        throw new OfflineCounterError(
          'UNREADABLE_AUTHORIZATION',
          'That phone sent an approval this payment could not read',
        );
      }
      return signed;
    },
  });

  return {transactionHash: receipt.transactionHash, ledger: receipt.ledger};
}
