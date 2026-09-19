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
import {apiBaseUrl} from '../../shared/apiConfig';
import {createRandomBytes} from '../../shared/randomBytes';
import type {MerchantProfile} from '../merchant/merchantProfile';
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

  const baseUrl = dependencies.baseUrl ?? apiBaseUrl;
  const merchantProfile = dependencies.merchantProfile ?? useAppStore.getState().merchantProfile;
  if (!merchantProfile) {
    throw new TestnetSettlementError(
      'MERCHANT_KEY_UNAVAILABLE',
      'Testnet settlement needs the merchant profile that signed this request',
    );
  }

  const config = dependencies.config ?? createStellarConfig('testnet');
  const relayer = dependencies.relayer ?? (await fetchRelayerIdentity(baseUrl));
  const relayerSigner = dependencies.relayerSigner ?? createRemoteRelayerSigner(baseUrl);

  const customer = dependencies.customer ?? (await ensureCustomerWallet());
  if (!dependencies.customer) await ensureFunded(config, customer);

  // A native signer, once implemented, replaces the development wallet here.
  if (dependencies.signer) {
    const identity = await dependencies.signer.getIdentity();
    if (!identity?.publicKey) {
      throw new SecureSignerError('UNAVAILABLE', 'The native signer reported no identity');
    }
  }

  const latestLedger = dependencies.latestLedger ?? (await new StellarRpcClient(config).health()).latestLedger;
  const receipt = await settleOnTestnet({
    payload,
    config,
    merchantProfile,
    customer,
    relayer,
    relayerSigner,
    latestLedger,
    ...(dependencies.onProgress ? {onProgress: dependencies.onProgress} : {}),
  });
  return toLocalReceipt(payload, receipt.transactionHash, receipt.ledger);
}
