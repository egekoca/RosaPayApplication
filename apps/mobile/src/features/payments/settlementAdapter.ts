import {Keypair} from '@stellar/stellar-sdk';
import {Buffer} from 'buffer';
import {hashPaymentIntent, type SignedPaymentIntentV1} from '@rosapay/protocol';
import {SecureSignerError, type NativeSecureSigner} from '@rosapay/secure-signer';
import {
  createStellarConfig,
  StellarRpcClient,
  type SettlementPipelineProgress,
  type StellarConfig,
} from '@rosapay/stellar';
import type {LocalReceipt, SettlementMode} from '../../state/appStore';
import {useAppStore} from '../../state/appStore';
import {useAppStore as useStore} from '../../state/appStore';
import {createRandomBytes} from '../../shared/randomBytes';
import type {MerchantProfile} from '../merchant/merchantProfile';
import {selectCountersigner, type Countersigner} from './countersignature';
import {createLifecycleReporter} from './paymentLifecycle';
import {createHardwareDigestSigner, ensureSmartWallet, SmartWalletError} from './smartWalletSettlement';
import {settleMockPayment} from './mockSettlement';
import {
  createDevelopmentCustomerKeypair,
  createRemoteRelayerSigner,
  fetchRelayerIdentity,
  fundTestnetAccount,
  settleOnTestnet,
  TestnetSettlementError,
  type RelayerIdentity,
} from './testnetSettlement';

export type MobileSettlementMode = SettlementMode;

/** Build-time default; the developer settings screen can change it at runtime. */
export const mobileSettlementMode: MobileSettlementMode =
  process.env.ROSAPAY_SETTLEMENT_MODE === 'testnet' ? 'testnet' : 'mock';

export type MobileSettlementDependencies = {
  mode?: MobileSettlementMode;
  signer?: NativeSecureSigner;
  config?: StellarConfig;
  latestLedger?: number;
  merchantProfile?: MerchantProfile;
  customer?: Keypair;
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
    settlementMode: 'testnet',
    ...(ledger === undefined ? {} : {ledger}),
    confirmedAt: new Date().toISOString(),
  };
}

/**
 * Ensures a Testnet customer wallet exists. The native signer is the intended
 * path; while it reports UNAVAILABLE the development wallet stands in so the
 * relayed settlement flow can be exercised end to end.
 */
export async function ensureCustomerWallet(): Promise<Keypair> {
  const store = useAppStore.getState();
  const existing = store.customerWallet;
  if (existing) return Keypair.fromRawEd25519Seed(Buffer.from(existing.seed));

  const keypair = createDevelopmentCustomerKeypair(createRandomBytes({allowInsecureFallback: true}));
  store.setCustomerWallet({publicKey: keypair.publicKey(), seed: keypair.rawSecretKey(), funded: false});
  return keypair;
}

async function ensureFunded(config: StellarConfig, keypair: Keypair): Promise<void> {
  const store = useAppStore.getState();
  if (store.customerWallet?.funded && store.customerWallet.publicKey === keypair.publicKey()) return;
  await fundTestnetAccount(config, keypair.publicKey());
  store.setCustomerWallet({publicKey: keypair.publicKey(), seed: keypair.rawSecretKey(), funded: true});
}

/** Keeps the emulator demo available while exposing the real relayed Testnet path. */
export async function settlePaymentIntent(
  payload: SignedPaymentIntentV1,
  dependencies: MobileSettlementDependencies = {},
): Promise<LocalReceipt> {
  const mode = dependencies.mode ?? useAppStore.getState().settlementMode;
  if (mode === 'mock') return settleMockPayment(payload);

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

  // The device's smart wallet pays when the hardware key exists; the demo
  // account is the fallback while a device has no payment key yet.
  let smartWallet: {contractId: string; signer: ReturnType<typeof createHardwareDigestSigner>} | undefined;
  if (!dependencies.customer) {
    try {
      const wallet = await ensureSmartWallet();
      smartWallet = {contractId: wallet.contractId, signer: createHardwareDigestSigner(wallet.devicePublicKey)};
    } catch (error) {
      if (!(error instanceof SmartWalletError && error.code === 'DEVICE_KEY_MISSING')) throw error;
    }
  }

  const customer = dependencies.customer ?? (await ensureCustomerWallet());
  if (!dependencies.customer && !smartWallet) await ensureFunded(config, customer);

  // A native signer, once implemented, replaces the development wallet here.
  if (dependencies.signer) {
    const identity = await dependencies.signer.getIdentity();
    if (!identity?.publicKey) {
      throw new SecureSignerError('UNAVAILABLE', 'The native signer reported no identity');
    }
  }

  const latestLedger = dependencies.latestLedger ?? (await new StellarRpcClient(config).health()).latestLedger;
  const authorizer = smartWallet?.contractId ?? customer.publicKey();
  const reporter = createLifecycleReporter(payload.intent.intentId, authorizer);
  const receipt = await settleOnTestnet({
    payload,
    config,
    countersign,
    customer,
    relayer,
    relayerSigner,
    latestLedger,
    ...(smartWallet ? {smartWallet} : {}),
    onProgress: progress => {
      dependencies.onProgress?.(progress);
      reporter.record(progress);
    },
  });
  // The chain already settled; recording is best effort and must not fail it.
  await reporter.flush();
  return toLocalReceipt(payload, receipt.transactionHash, receipt.ledger);
}
