import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';
import type {PaymentStatus} from '@rosapay/domain';
import type {SignedPaymentIntentV1} from '@rosapay/protocol';
import type {MerchantProfile} from '../features/merchant/merchantProfile';
import {decodeSecrets, encodeSecrets, secureSessionStorage} from './persistence';

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
  /** False until the stored session has been read back from secure storage. */
  hydrated: boolean;
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

/** True once a session exists that a returning user should come back to. */
export function hasRestorableSession(state: Pick<AppState, 'customerWallet' | 'merchantProfile' | 'receipts'>): boolean {
  return state.customerWallet !== null || state.merchantProfile !== null || state.receipts.length > 0;
}

const initialSettlementMode: SettlementMode =
  process.env.ROSAPAY_SETTLEMENT_MODE === 'testnet' ? 'testnet' : 'mock';

/** Receipts are kept bounded so a long-lived session cannot outgrow secure storage. */
const MAX_PERSISTED_RECEIPTS = 25;

export const useAppStore = create<AppState>()(
  persist(
    set => ({
      hydrated: false,
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
      addReceipt: receipt =>
        set(state => ({receipts: [receipt, ...state.receipts].slice(0, MAX_PERSISTED_RECEIPTS)})),
    }),
    {
      name: 'rosapay-session',
      version: 1,
      onRehydrateStorage: () => state => {
        useAppStore.setState({hydrated: true});
        return state;
      },
      storage: createJSONStorage(() => secureSessionStorage, {
        replacer: (_key, value) => encodeSecrets(value),
        reviver: (_key, value) => decodeSecrets(value),
      }),
      // Everything a returning user needs: their wallet, business profile, the
      // request still on screen and their receipts.
      partialize: state => ({
        mode: state.mode,
        settlementMode: state.settlementMode,
        merchantProfile: state.merchantProfile,
        merchantRegisteredOnChain: state.merchantRegisteredOnChain,
        customerWallet: state.customerWallet,
        pendingRequest: state.pendingRequest,
        receipts: state.receipts,
      }),
    },
  ),
);
