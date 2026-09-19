import {parseSignedPaymentIntent, validatePaymentIntent, type SignedPaymentIntentV1} from '@rosapay/protocol';
import {verifyMerchantSignature} from './merchantSignature';
import {createSettlementClient} from './settlementClient';
import {
  attachMerchantContractSignature,
  buildSettlementEnvelope,
  type SettlementEnvelope,
} from './settlementEnvelope';
import {
  settlePayment,
  type WalletAuthorizeEntry,
  type SettlementPipelineClient,
  type SettlementPipelineProgress,
  type SettlementPipelineReceipt,
  type SettlementPipelineSigner,
  type SettlementRelayerSigner,
} from './settlementPipeline';
import type {StellarConfig} from './config';

export type SettlementServiceAuthorizeEntry = WalletAuthorizeEntry;

export type SettlementServiceInput = {
  payload: unknown;
  config: StellarConfig;
  customerAddress: string;
  /**
   * Transaction source and fee payer. It must differ from the customer so that
   * "may submit" and "may spend" stay with different actors.
   */
  relayerAddress: string;
  latestLedger: number;
  merchantContractSignature: Uint8Array;
  customerSigner: SettlementPipelineSigner;
  customerAuthorizeEntry?: SettlementServiceAuthorizeEntry;
  relayerSigner: SettlementRelayerSigner;
  client?: SettlementPipelineClient;
  maxLedgerLifetime?: number;
  onProgress?(progress: SettlementPipelineProgress): void;
};

export type SettlementServiceResult = SettlementPipelineReceipt & {
  intent: SignedPaymentIntentV1;
  envelope: SettlementEnvelope;
};

export class SettlementServiceError extends Error {
  override readonly name = 'SettlementServiceError';

  constructor(
    readonly code:
      | 'INVALID_INTENT'
      | 'INVALID_MERCHANT_SIGNATURE'
      | 'CONTRACT_SIGNATURE_REQUIRED'
      | 'RELAYER_REQUIRED',
    message: string,
  ) {
    super(message);
  }
}

/** Validate RTP/1, build the typed envelope, then run the generated-client settlement pipeline. */
export async function settleSignedPayment(input: SettlementServiceInput): Promise<SettlementServiceResult> {
  let intent: SignedPaymentIntentV1;
  try {
    intent = parseSignedPaymentIntent(input.payload);
    validatePaymentIntent(intent.intent, {
      network: input.config.network === 'pubnet' ? 'pubnet' : 'testnet',
      latestLedger: input.latestLedger,
      maxLedgerLifetime: input.maxLedgerLifetime,
    });
  } catch (error) {
    throw new SettlementServiceError('INVALID_INTENT', error instanceof Error ? error.message : 'Payment intent is invalid');
  }

  if (!verifyMerchantSignature(intent)) {
    throw new SettlementServiceError('INVALID_MERCHANT_SIGNATURE', 'RTP/1 merchant signature is invalid');
  }
  if (!input.merchantContractSignature.byteLength) {
    throw new SettlementServiceError('CONTRACT_SIGNATURE_REQUIRED', 'A contract intent-digest signature is required');
  }
  if (!input.relayerAddress.trim()) {
    throw new SettlementServiceError('RELAYER_REQUIRED', 'A relayer address is required to pay the transaction fee');
  }
  if (input.relayerAddress === input.customerAddress) {
    throw new SettlementServiceError(
      'RELAYER_REQUIRED',
      'The relayer must not be the customer: submission and spending authority stay separate',
    );
  }

  const envelope = buildSettlementEnvelope(intent.intent, {
    customer: input.customerAddress,
    networkPassphrase: input.config.networkPassphrase,
    settlementContractId: input.config.settlementContractId ?? '',
  });
  const signedEnvelope = attachMerchantContractSignature(envelope, input.merchantContractSignature);
  // The relayer is the transaction source and fee payer; the customer only ever
  // signs the authorization entry for this exact invocation.
  const client = input.client ?? createSettlementClient(input.config, {
    publicKey: input.relayerAddress,
    signTransaction: input.relayerSigner.signTransaction,
  });
  const receipt = await settlePayment({
    client,
    intent: signedEnvelope.intent,
    merchantSignature: signedEnvelope.merchantSignature,
    customerSigner: input.customerSigner,
    ...(input.customerAuthorizeEntry ? {customerAuthorizeEntry: input.customerAuthorizeEntry} : {}),
    relayerSigner: input.relayerSigner,
    onProgress: input.onProgress,
  });

  return {...receipt, intent, envelope};
}
