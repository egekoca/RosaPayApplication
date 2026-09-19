import {hashPaymentIntent, type SignedPaymentIntentV1} from '@rosapay/protocol';
import {SecureSignerError, type NativeSecureSigner} from '@rosapay/secure-signer';
import {
  createStellarConfig,
  StellarRpcClient,
  type SettlementPipelineProgress,
  type StellarConfig,
} from '@rosapay/stellar';
import type {LocalReceipt} from '../../state/appStore';
import {useAppStore} from '../../state/appStore';
import {useAppStore as useStore} from '../../state/appStore';
import type {MerchantProfile} from '../merchant/merchantProfile';
import {selectCountersigner, type Countersigner} from './countersignature';
import {createLifecycleReporter} from './paymentLifecycle';
import {createHardwareDigestSigner, ensureSmartWallet} from './smartWalletSettlement';
import {
  createRemoteRelayerSigner,
  fetchRelayerIdentity,
  settleOnTestnet,
  type RelayerIdentity,
} from './testnetSettlement';

export type MobileSettlementDependencies = {
  signer?: NativeSecureSigner;
  config?: StellarConfig;
  latestLedger?: number;
  merchantProfile?: MerchantProfile;
  relayer?: RelayerIdentity;
  relayerSigner?: {signTransaction(xdr: string): Promise<{signedTxXdr: string}>};
  countersign?: Countersigner;
  baseUrl?: string;
  onProgress?: (progress: SettlementPipelineProgress) => void;
};

function toLocalReceipt(
  payload: SignedPaymentIntentV1,
  transactionHash: string,
  ledger?: number,
): LocalReceipt {
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
    ...(ledger === undefined ? {} : {ledger}),
    confirmedAt: new Date().toISOString(),
  };
}

/**
 * Settles a payment on Stellar Testnet. The device's smart wallet pays, the
 * relayer is the transaction source and pays the fee,
 * and the settlement contract decides whether it happened.
 *
 * Nothing here can succeed without the chain, which is the point. A payment that
 * only looks settled is worse than one that plainly failed.
 */
export async function settlePaymentIntent(
  payload: SignedPaymentIntentV1,
  dependencies: MobileSettlementDependencies = {},
): Promise<LocalReceipt> {
  const baseUrl = dependencies.baseUrl ?? useStore.getState().apiBaseUrl;
  const merchantProfile = dependencies.merchantProfile ?? useAppStore.getState().merchantProfile;
  // A payment between two phones is the normal case, and the customer's phone
  // does not hold the merchant's signing key. It signs locally only when this
  // device is the merchant that made the request.
  const countersign =
    dependencies.countersign ??
    selectCountersigner({
      merchantProfile,
      merchantSigningKey: payload.intent.merchantSigningKey,
      baseUrl,
    });

  const config = dependencies.config ?? createStellarConfig('testnet');
  const relayer = dependencies.relayer ?? (await fetchRelayerIdentity(baseUrl));
  const relayerSigner = dependencies.relayerSigner ?? createRemoteRelayerSigner(baseUrl);

  const wallet = await ensureSmartWallet();
  const smartWallet = {
    contractId: wallet.contractId,
    signer: createHardwareDigestSigner(wallet.devicePublicKey),
  };

  if (dependencies.signer) {
    const identity = await dependencies.signer.getIdentity();
    if (!identity?.publicKey) {
      throw new SecureSignerError('UNAVAILABLE', 'The native signer reported no identity');
    }
  }

  const latestLedger = dependencies.latestLedger ?? (await new StellarRpcClient(config).health()).latestLedger;
  const reporter = createLifecycleReporter(payload.intent.intentId, smartWallet.contractId);
  const receipt = await settleOnTestnet({
    payload,
    config,
    countersign,
    relayer,
    relayerSigner,
    latestLedger,
    smartWallet,
    onProgress: progress => {
      dependencies.onProgress?.(progress);
      reporter.record(progress);
    },
  });
  // The chain already settled; recording is best effort and must not fail it.
  await reporter.flush();
  return toLocalReceipt(payload, receipt.transactionHash, receipt.ledger);
}
