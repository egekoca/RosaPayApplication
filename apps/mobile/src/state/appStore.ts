import {create} from 'zustand';
import type {PaymentStatus} from '@rosapay/domain';
import type {SignedPaymentIntentV1} from '@rosapay/protocol';
import type {MerchantProfile} from '../features/merchant/merchantProfile';

export type SettlementMode = 'mock' | 'testnet';

/**
 * Development customer wallet. It stands in for the native signer until the
 * platform modules exist, so it only ever holds Testnet demo funds.
 */
export type DevelopmentCustomerWallet = {
  publicKey: string;
  seed: Uint8Array;
  funded: boolean;
};

export type AppMode = 'customer' | 'merchant';
export type LocalReceipt = {
  intentId: string;
  merchantName: string;
  recipient: string;
  amount: string;
  assetCode: string;
  network: 'testnet' | 'pubnet';
  payloadHash: string;
  status: PaymentStatus;
  transactionHash: string;
  createdAt: string;
  /** `mock` receipts are local demo state and have no Stellar transaction. */
  settlementMode: 'mock' | 'testnet';
  ledger?: number;
  confirmedAt?: string;
};

type AppState = {
  mode: AppMode;
  settlementMode: SettlementMode;
  merchantProfile: MerchantProfile | null;
  merchantRegisteredOnChain: boolean;
  customerWallet: DevelopmentCustomerWallet | null;
  pendingRequest: SignedPaymentIntentV1 | null;
  receipts: LocalReceipt[];
  setMode(mode: AppMode): void;
  setSettlementMode(mode: SettlementMode): void;
  saveMerchantProfile(profile: MerchantProfile): void;
  setMerchantRegisteredOnChain(registered: boolean): void;
  setCustomerWallet(wallet: DevelopmentCustomerWallet | null): void;
  setPendingRequest(request: SignedPaymentIntentV1 | null): void;
  addReceipt(receipt: LocalReceipt): void;
};

const initialSettlementMode: SettlementMode =
  process.env.ROSAPAY_SETTLEMENT_MODE === 'testnet' ? 'testnet' : 'mock';

export const useAppStore = create<AppState>(set => ({
  mode: 'customer',
  settlementMode: initialSettlementMode,
  merchantProfile: null,
  merchantRegisteredOnChain: false,
  customerWallet: null,
  pendingRequest: null,
  receipts: [],
  setMode: mode => set(state => (mode === 'merchant' && !state.merchantProfile ? state : {...state, mode})),
  setSettlementMode: settlementMode => set({settlementMode}),
  saveMerchantProfile: profile =>
    set({merchantProfile: profile, mode: 'merchant', merchantRegisteredOnChain: false}),
  setMerchantRegisteredOnChain: merchantRegisteredOnChain => set({merchantRegisteredOnChain}),
  setCustomerWallet: customerWallet => set({customerWallet}),
  setPendingRequest: request => set({pendingRequest: request}),
  addReceipt: receipt => set(state => ({receipts: [receipt, ...state.receipts]})),
}));
