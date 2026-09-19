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
import {createCustomerSigner} from '../wallet/walletSigner';
import {
  createRemoteRelayerSigner,
  fetchRelayerIdentity,
  settleOnTestnet,
  type RelayerIdentity,
  type SettlementCustomer,
} from './testnetSettlement';

export type MobileSettlementDependencies = {
  customer?: SettlementCustomer;
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
 * Which account on this phone is paying.
 *
 * Someone who created a wallet here has a smart wallet; someone who arrived
 * with twelve words has a classic account. Both are offered at onboarding, so
 * this reads the one that exists rather than assuming. The smart wallet wins a
 * tie, because it is what this app deploys and funds when it makes an account
 * of its own.
 *
 * The prompt names the amount and the merchant, because it is the last thing a
 * customer reads before the money moves.
 */
async function resolveCustomer(payload: SignedPaymentIntentV1): Promise<SettlementCustomer> {
  const {intent} = payload;
  const {smartWallet, wallet} = useAppStore.getState();

  if (!smartWallet && wallet) {
    const signer = await createCustomerSigner(
      `Approve ${intent.amount} ${intent.asset.code} to ${intent.merchantName}`,
    );
    return {kind: 'classic', address: signer.address, signer};
  }

  const deployed = await ensureSmartWallet();
  return {
    kind: 'smart-wallet',
    contractId: deployed.contractId,
    signer: createHardwareDigestSigner(deployed.devicePublicKey),
  };
}

/**
 * Settles a payment on Stellar Testnet. The account this phone holds pays, the
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

  const customer = dependencies.customer ?? (await resolveCustomer(payload));

  if (dependencies.signer) {
    const identity = await dependencies.signer.getIdentity();
    if (!identity?.publicKey) {
      throw new SecureSignerError('UNAVAILABLE', 'The native signer reported no identity');
    }
  }

  const latestLedger = dependencies.latestLedger ?? (await new StellarRpcClient(config).health()).latestLedger;
  const customerAddress = customer.kind === 'smart-wallet' ? customer.contractId : customer.address;
  const reporter = createLifecycleReporter(payload.intent.intentId, customerAddress);
  const receipt = await settleOnTestnet({
    payload,
    config,
    countersign,
    relayer,
    relayerSigner,
    latestLedger,
    customer,
    onProgress: progress => {
      dependencies.onProgress?.(progress);
      reporter.record(progress);
    },
  });
  // The chain already settled; recording is best effort and must not fail it.
  await reporter.flush();
  return toLocalReceipt(payload, receipt.transactionHash, receipt.ledger);
}
