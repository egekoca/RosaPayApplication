import {hashPaymentIntent, type SignedPaymentIntentV1} from '@rosapay/protocol';
import {
  createStellarSignerCallbacks,
  SecureSignerError,
  type NativeSecureSigner,
} from '@rosapay/secure-signer';
import {
  createStellarConfig,
  createSettlementClient,
  settleSignedPayment,
  SettlementServiceError,
  StellarRpcClient,
  type SettlementPipelineClient,
  type SettlementRelayerSigner,
  type StellarConfig,
} from '@rosapay/stellar';
import type {LocalReceipt} from '../../state/appStore';
import {createNativeRosaPaySigner} from '../../native/nativeSigner';
import {settleMockPayment} from './mockSettlement';

export type MobileSettlementMode = 'mock' | 'testnet';

export const mobileSettlementMode: MobileSettlementMode = process.env.ROSAPAY_SETTLEMENT_MODE === 'testnet'
  ? 'testnet'
  : 'mock';

export type MobileSettlementDependencies = {
  mode?: MobileSettlementMode;
  signer?: NativeSecureSigner;
  config?: StellarConfig;
  client?: SettlementPipelineClient;
  latestLedger?: number;
  merchantContractSignature?: Uint8Array;
  relayerSigner?: SettlementRelayerSigner;
};

function toLocalReceipt(payload: SignedPaymentIntentV1, transactionHash: string): LocalReceipt {
  return {
    intentId: payload.intent.intentId,
    merchantName: payload.intent.merchantName,
    recipient: payload.intent.recipient,
    amount: payload.intent.amount,
    assetCode: payload.intent.asset.code,
    network: payload.intent.network,
    payloadHash: hashPaymentIntent(payload.intent),
    status: 'confirmed',
    transactionHash,
    createdAt: new Date().toISOString(),
  };
}

/** Keep the emulator demo available while exposing the real Testnet path behind an explicit mode. */
export async function settlePaymentIntent(
  payload: SignedPaymentIntentV1,
  dependencies: MobileSettlementDependencies = {},
): Promise<LocalReceipt> {
  const mode = dependencies.mode ?? mobileSettlementMode;
  if (mode === 'mock') return settleMockPayment(payload);

  const signer = dependencies.signer ?? createNativeRosaPaySigner();
  const identity = await signer.getIdentity();
  if (!identity?.publicKey) {
    throw new SecureSignerError('UNAVAILABLE', 'A native customer signer is required for Testnet settlement');
  }
  if (!dependencies.merchantContractSignature?.byteLength) {
    throw new SettlementServiceError('CONTRACT_SIGNATURE_REQUIRED', 'The merchant contract signature is not available');
  }
  if (!dependencies.relayerSigner) {
    throw new SecureSignerError('UNAVAILABLE', 'A relayer signer is required for sponsored settlement');
  }

  const config = dependencies.config ?? createStellarConfig('testnet');
  const latestLedger = dependencies.latestLedger ?? (await new StellarRpcClient(config).health()).latestLedger;
  const callbacks = createStellarSignerCallbacks(signer);
  const client = dependencies.client ?? createSettlementClient(config, {
    publicKey: identity.publicKey,
    signAuthEntry: callbacks.signAuthEntry,
    signTransaction: callbacks.signTransaction,
  });
  const receipt = await settleSignedPayment({
    payload,
    config,
    customerAddress: identity.publicKey,
    latestLedger,
    merchantContractSignature: dependencies.merchantContractSignature,
    customerSigner: {signAuthEntry: callbacks.signAuthEntry},
    relayerSigner: dependencies.relayerSigner,
    client,
  });
  return toLocalReceipt(payload, receipt.transactionHash);
}
