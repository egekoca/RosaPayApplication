import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';
import type {PaymentStatus} from '@rosapay/domain';
import type {SignedPaymentIntentV1} from '@rosapay/protocol';
import type {MerchantProfile} from '../features/merchant/merchantProfile';
import {decodeSecrets, encodeSecrets, secureSessionStorage} from './persistence';
import {defaultApiBaseUrl} from '../shared/apiConfig';

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

/** A smart wallet whose only signer is this device's hardware key. */
export type SmartWallet = {
  contractId: string;
  devicePublicKey: string;
};

/**
 * Enough encrypted state to resume SEP-24 polling after the hosted browser or
 * app closes. The bearer token stays inside the same Keychain-backed storage
 * as the rest of the session and is erased on sign-out/final completion.
 */
export type PendingAnchorTransfer = {
  homeDomain: string;
  transactionId: string;
  token: string;
  account: string;
  authProtocol: 'SEP-10' | 'SEP-45';
  kind: 'deposit' | 'withdraw';
  assetCode: string;
  startedAt: string;
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

/**
 * Who this person is, for their own benefit rather than for authentication.
 * Lumenade Pay is non-custodial: the device key is the account, so there is nothing
 * a server could check an email against. The name is what a merchant sees on a
 * receipt, and the email is where a receipt can be sent.
 */
export type Account = {
  name: string;
  email?: string;
  createdAt: string;
};

type AppState = {
  /** False until the stored session has been read back from secure storage. */
  hydrated: boolean;
  mode: AppMode;
  settlementMode: SettlementMode;
  /** Where the Lumenade Pay API lives; a phone needs the development machine's address. */
  apiBaseUrl: string;
  account: Account | null;
  /** True while a returning user has not yet proved they are the device owner. */
  locked: boolean;
  merchantProfile: MerchantProfile | null;
  merchantRegisteredOnChain: boolean;
  customerWallet: DevelopmentCustomerWallet | null;
  smartWallet: SmartWallet | null;
  pendingAnchorTransfer: PendingAnchorTransfer | null;
  pendingRequest: SignedPaymentIntentV1 | null;
  receipts: LocalReceipt[];
  createAccount(account: Omit<Account, 'createdAt'>): void;
  unlock(): void;
  lock(): void;
  signOut(): void;
  setMode(mode: AppMode): void;
  setSettlementMode(mode: SettlementMode): void;
  setApiBaseUrl(url: string): void;
  saveMerchantProfile(profile: MerchantProfile): void;
  setMerchantRegisteredOnChain(registered: boolean): void;
  setCustomerWallet(wallet: DevelopmentCustomerWallet | null): void;
  setSmartWallet(wallet: SmartWallet | null): void;
  setPendingAnchorTransfer(transfer: PendingAnchorTransfer | null): void;
  setPendingRequest(request: SignedPaymentIntentV1 | null): void;
  addReceipt(receipt: LocalReceipt): void;
};

/**
 * A restored profile or wallet is only usable if its signing bytes came back
 * intact. Anything else is dropped, so a broken session asks the user to set up
 * again instead of failing later with an unreadable key.
 */
export function dropUnusableSecrets(state: Partial<AppState>): Partial<AppState> {
  const merchantProfile =
    state.merchantProfile && isSigningKey(state.merchantProfile.developmentSigningSecret, 32)
      ? state.merchantProfile
      : null;
  const customerWallet =
    state.customerWallet && isSigningKey(state.customerWallet.seed, 32) ? state.customerWallet : null;
  const pendingAnchorTransfer = isPendingAnchorTransfer(state.pendingAnchorTransfer)
    ? state.pendingAnchorTransfer
    : null;
  return {
    ...state,
    merchantProfile,
    customerWallet,
    pendingAnchorTransfer,
    // Without a profile there is no merchant mode to return to.
    ...(merchantProfile ? {} : {merchantRegisteredOnChain: false, pendingRequest: null, mode: 'customer' as const}),
  };
}

function isPendingAnchorTransfer(value: unknown): value is PendingAnchorTransfer {
  if (!value || typeof value !== 'object') return false;
  const transfer = value as Partial<PendingAnchorTransfer>;
  return (
    transfer.homeDomain === 'testanchor.stellar.org' &&
    typeof transfer.transactionId === 'string' && transfer.transactionId.length > 0 &&
    typeof transfer.token === 'string' && transfer.token.length > 0 &&
    typeof transfer.account === 'string' && /^C[A-Z2-7]{55}$/.test(transfer.account) &&
    transfer.authProtocol === 'SEP-45' &&
    (transfer.kind === 'deposit' || transfer.kind === 'withdraw') &&
    transfer.assetCode === 'native' &&
    typeof transfer.startedAt === 'string' && Number.isFinite(Date.parse(transfer.startedAt))
  );
}

function isSigningKey(value: unknown, length: number): boolean {
  return value instanceof Uint8Array && value.length === length;
}

/** True once a session exists that a returning user should come back to. */
export function hasRestorableSession(
  state: Pick<AppState, 'customerWallet' | 'merchantProfile' | 'receipts'> & {
    smartWallet?: SmartWallet | null;
    account?: Account | null;
  },
): boolean {
  return (
    (state.account ?? null) !== null ||
    state.customerWallet !== null ||
    (state.smartWallet ?? null) !== null ||
    state.merchantProfile !== null ||
    state.receipts.length > 0
  );
}

const initialSettlementMode: SettlementMode =
  process.env.ROSAPAY_SETTLEMENT_MODE === 'testnet' ? 'testnet' : 'mock';

/** Receipts are kept bounded so a long-lived session cannot outgrow secure storage. */
const MAX_PERSISTED_RECEIPTS = 25;

export const useAppStore = create<AppState>()(
  persist(
    set => ({
      hydrated: false,
      account: null,
      // A session with an account starts locked; rehydration decides.
      locked: false,
      mode: 'customer',
      settlementMode: initialSettlementMode,
      apiBaseUrl: defaultApiBaseUrl,
      merchantProfile: null,
      merchantRegisteredOnChain: false,
      customerWallet: null,
      smartWallet: null,
      pendingAnchorTransfer: null,
      pendingRequest: null,
      receipts: [],
      createAccount: account =>
        set({account: {...account, createdAt: new Date().toISOString()}, locked: false}),
      unlock: () => set({locked: false}),
      lock: () => set(state => (state.account ? {...state, locked: true} : state)),
      signOut: () =>
        set({
          account: null,
          locked: false,
          mode: 'customer',
          merchantProfile: null,
          merchantRegisteredOnChain: false,
          customerWallet: null,
          smartWallet: null,
          pendingAnchorTransfer: null,
          pendingRequest: null,
          receipts: [],
        }),
      setMode: mode => set(state => (mode === 'merchant' && !state.merchantProfile ? state : {...state, mode})),
      setSettlementMode: settlementMode => set({settlementMode}),
      setApiBaseUrl: apiBaseUrl => set({apiBaseUrl}),
      saveMerchantProfile: profile =>
        set({merchantProfile: profile, mode: 'merchant', merchantRegisteredOnChain: false}),
      setMerchantRegisteredOnChain: merchantRegisteredOnChain => set({merchantRegisteredOnChain}),
      setCustomerWallet: customerWallet => set({customerWallet}),
      setSmartWallet: smartWallet => set({smartWallet}),
      setPendingAnchorTransfer: pendingAnchorTransfer => set({pendingAnchorTransfer}),
      setPendingRequest: request => set({pendingRequest: request}),
      addReceipt: receipt =>
        set(state => ({receipts: [receipt, ...state.receipts].slice(0, MAX_PERSISTED_RECEIPTS)})),
    }),
    {
      name: 'rosapay-session',
      // Version 3 also rejects malformed/stale anchor session records.
      version: 3,
      migrate: state => dropUnusableSecrets(state as Partial<AppState>),
      merge: (persisted, current) => ({...current, ...dropUnusableSecrets(persisted as Partial<AppState>)}),
      onRehydrateStorage: () => state => {
        // A returning account has to prove itself with the device before the
        // app shows a balance or a receipt.
        useAppStore.setState({hydrated: true, locked: Boolean(state?.account)});
        return state;
      },
      storage: createJSONStorage(() => secureSessionStorage, {
        replacer: (_key, value) => encodeSecrets(value),
        reviver: (_key, value) => decodeSecrets(value),
      }),
      // Everything a returning user needs: their wallet, business profile, the
      // request still on screen and their receipts.
      partialize: state => ({
        account: state.account,
        mode: state.mode,
        settlementMode: state.settlementMode,
        apiBaseUrl: state.apiBaseUrl,
        merchantProfile: state.merchantProfile,
        merchantRegisteredOnChain: state.merchantRegisteredOnChain,
        customerWallet: state.customerWallet,
        smartWallet: state.smartWallet,
        pendingAnchorTransfer: state.pendingAnchorTransfer,
        pendingRequest: state.pendingRequest,
        receipts: state.receipts,
      }),
    },
  ),
);
