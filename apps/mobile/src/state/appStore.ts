import {StrKey} from '@stellar/stellar-sdk';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';
import type {PaymentStatus} from '@rosapay/domain';
import type {SignedPaymentIntentV1} from '@rosapay/protocol';
import type {MerchantProfile} from '../features/merchant/merchantProfile';
import {createNativeRosaPaySigner} from '../native/nativeSigner';
import {clearBridgeKey, clearSigningKey} from '../features/wallet/keyVault';
import {decodeSecrets, encodeSecrets, secureSessionStorage} from './persistence';
import {defaultApiBaseUrl} from '../shared/apiConfig';


/**
 * Development customer wallet. It stands in for the native signer until the
 * platform modules exist, so it only ever holds Testnet demo funds.
 */

/**
 * The Stellar account this phone pays from.
 *
 * Only the address lives here. The secret that signs for it is in the Keychain
 * behind the device owner (`features/wallet/keyVault`), because this record is
 * read on every cold start and a key read that often is a key nobody is asked
 * about. `origin` is kept so the app can tell someone whether the phrase it once
 * showed them is the one that opens this account.
 */
export type StellarAccount = {
  address: string;
  origin: 'created' | 'imported';
};

/** The production wallet controlled by the platform's non-exportable P-256 key. */
export type SmartWallet = {
  contractId: string;
  devicePublicKey: string;
  /**
   * The passkey registered as this wallet's recovery signer, when the phone
   * could make one. Its absence is the difference between a wallet that
   * survives a lost handset and one that does not, so the app reads this rather
   * than assuming.
   */
  recovery?: {credentialId: string; publicKey: string};
};

export type ApiSession = {token: string; expiresAt: string; publicSigner: string};

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
export type PaymentTransport = 'qr' | 'nfc' | 'unknown';
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
  ledger?: number;
  confirmedAt?: string;
  /** How the signed request reached this phone. Older receipts are unknown. */
  transport?: PaymentTransport;
};

export type RampActivity = {
  id: string;
  kind: 'deposit' | 'withdrawal';
  amount: string;
  assetCode: 'TRY' | 'USDC';
  createdAt: string;
};

/**
 * Who this person is, for their own benefit rather than for authentication.
 * Rosa Pay is non-custodial: the device key is the account, so there is nothing
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
  /** Where the Rosa Pay API lives; a phone needs the development machine's address. */
  apiBaseUrl: string;
  /**
   * The money a balance is read in. Not a formatting preference — it decides
   * which currency the app asks a quote server to price the wallet in.
   */
  displayCurrency: string;
  /** The language the interface is read in. English until someone says otherwise. */
  language: string;
  account: Account | null;
  /** True while a returning user has not yet proved they are the device owner. */
  locked: boolean;
  /**
   * Whether opening the app asks for the device owner at all.
   *
   * Off by default. What the device key protects is spending, and it is asked
   * for at the moment of spending; demanding a fingerprint to read a balance
   * taught people to approve prompts without reading them, which is the habit
   * that gets money taken.
   */
  requireUnlock: boolean;
  merchantProfile: MerchantProfile | null;
  merchantRegisteredOnChain: boolean;
  smartWallet: SmartWallet | null;
  apiSession: ApiSession | null;
  /** Experimental classic-account adapter; never selected by the production payment path. */
  wallet: StellarAccount | null;
  pendingAnchorTransfer: PendingAnchorTransfer | null;
  pendingRequest: SignedPaymentIntentV1 | null;
  receipts: LocalReceipt[];
  rampActivities: RampActivity[];
  createAccount(account: Omit<Account, 'createdAt'>): void;
  unlock(): void;
  lock(): void;
  setRequireUnlock(required: boolean): void;
  signOut(): Promise<void>;
  setMode(mode: AppMode): void;
  setApiBaseUrl(url: string): void;
  setDisplayCurrency(currency: string): void;
  setLanguage(language: string): void;
  saveMerchantProfile(profile: MerchantProfile): void;
  setMerchantRegisteredOnChain(registered: boolean): void;
  setSmartWallet(wallet: SmartWallet | null): void;
  setApiSession(session: ApiSession | null): void;
  setWallet(wallet: StellarAccount | null): void;
  setPendingAnchorTransfer(transfer: PendingAnchorTransfer | null): void;
  setPendingRequest(request: SignedPaymentIntentV1 | null): void;
  addReceipt(receipt: LocalReceipt): void;
  addRampActivity(activity: RampActivity): void;
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
  const pendingAnchorTransfer = isPendingAnchorTransfer(state.pendingAnchorTransfer)
    ? state.pendingAnchorTransfer
    : null;
  const smartWallet = isSmartWallet(state.smartWallet) ? state.smartWallet : null;
  const apiSession = isApiSession(state.apiSession) ? state.apiSession : null;
  const wallet = isStellarAccount(state.wallet) ? state.wallet : null;
  const rampActivities = Array.isArray(state.rampActivities)
    ? state.rampActivities.filter(isRampActivity).slice(0, MAX_PERSISTED_RECEIPTS)
    : [];
  return {
    ...state,
    mode: 'customer',
    merchantProfile,
    pendingAnchorTransfer,
    smartWallet,
    apiSession,
    wallet,
    rampActivities,
    // Without a profile there is no merchant mode to return to.
    ...(merchantProfile ? {} : {merchantRegisteredOnChain: false, pendingRequest: null, mode: 'customer' as const}),
  };
}

function isApiSession(value: unknown): value is ApiSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<ApiSession>;
  return typeof session.token === 'string' && session.token.length >= 32 &&
    typeof session.publicSigner === 'string' && session.publicSigner.length >= 64 &&
    typeof session.expiresAt === 'string' && Number.isFinite(Date.parse(session.expiresAt));
}

function isSmartWallet(value: unknown): value is SmartWallet {
  if (!value || typeof value !== 'object') return false;
  const wallet = value as Partial<SmartWallet>;
  return (
    typeof wallet.contractId === 'string' &&
    StrKey.isValidContract(wallet.contractId) &&
    typeof wallet.devicePublicKey === 'string' &&
    wallet.devicePublicKey.length >= 64 &&
    wallet.devicePublicKey.length <= 512
  );
}

function isStellarAccount(value: unknown): value is StellarAccount {
  if (!value || typeof value !== 'object') return false;
  const account = value as Partial<StellarAccount>;
  return (
    typeof account.address === 'string' &&
    StrKey.isValidEd25519PublicKey(account.address) &&
    (account.origin === 'created' || account.origin === 'imported')
  );
}

function isPendingAnchorTransfer(value: unknown): value is PendingAnchorTransfer {
  if (!value || typeof value !== 'object') return false;
  const transfer = value as Partial<PendingAnchorTransfer>;
  const accountMatchesProtocol =
    (typeof transfer.account === 'string' &&
      StrKey.isValidContract(transfer.account) &&
      transfer.authProtocol === 'SEP-45') ||
    (typeof transfer.account === 'string' &&
      StrKey.isValidEd25519PublicKey(transfer.account) &&
      transfer.authProtocol === 'SEP-10');
  return (
    transfer.homeDomain === 'testanchor.stellar.org' &&
    typeof transfer.transactionId === 'string' && transfer.transactionId.length > 0 &&
    typeof transfer.token === 'string' && transfer.token.length > 0 &&
    accountMatchesProtocol &&
    (transfer.kind === 'deposit' || transfer.kind === 'withdraw') &&
    transfer.assetCode === 'native' &&
    typeof transfer.startedAt === 'string' && Number.isFinite(Date.parse(transfer.startedAt))
  );
}

function isSigningKey(value: unknown, length: number): boolean {
  return value instanceof Uint8Array && value.length === length;
}

function isRampActivity(value: unknown): value is RampActivity {
  if (!value || typeof value !== 'object') return false;
  const activity = value as Partial<RampActivity>;
  return (
    typeof activity.id === 'string' && activity.id.length > 0 &&
    (activity.kind === 'deposit' || activity.kind === 'withdrawal') &&
    typeof activity.amount === 'string' && /^\d+(\.\d+)?$/.test(activity.amount) &&
    ((activity.kind === 'deposit' && activity.assetCode === 'TRY') ||
      (activity.kind === 'withdrawal' && activity.assetCode === 'USDC')) &&
    typeof activity.createdAt === 'string' && Number.isFinite(Date.parse(activity.createdAt))
  );
}

/** True once a session exists that a returning user should come back to. */
export function hasRestorableSession(
  state: Pick<AppState, 'merchantProfile' | 'receipts'> & {
    smartWallet?: SmartWallet | null;
    wallet?: StellarAccount | null;
    account?: Account | null;
  },
): boolean {
  return (
    (state.account ?? null) !== null ||
    (state.smartWallet ?? null) !== null ||
    (state.wallet ?? null) !== null ||
    state.merchantProfile !== null ||
    state.receipts.length > 0
  );
}


/** Receipts are kept bounded so a long-lived session cannot outgrow secure storage. */
const MAX_PERSISTED_RECEIPTS = 25;

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      account: null,
      // A session with an account starts locked; rehydration decides.
      locked: false,
      requireUnlock: false,
      mode: 'customer',
      apiBaseUrl: defaultApiBaseUrl,
      displayCurrency: 'TRY',
      language: 'en',
      merchantProfile: null,
      merchantRegisteredOnChain: false,
      smartWallet: null,
      apiSession: null,
      wallet: null,
      pendingAnchorTransfer: null,
      pendingRequest: null,
      receipts: [],
      rampActivities: [],
      createAccount: account =>
        set({account: {...account, createdAt: new Date().toISOString()}, locked: false}),
      unlock: () => set({locked: false}),
      lock: () =>
        set(state => (state.account && state.requireUnlock ? {...state, locked: true} : state)),
      setRequireUnlock: requireUnlock => set(state => ({...state, requireUnlock, locked: false})),
      signOut: async () => {
        const {smartWallet, wallet} = get();
        if (smartWallet) await createNativeRosaPaySigner().deleteIdentity();
        if (wallet) await clearSigningKey();
        // The bridge key belongs to this installation rather than to the
        // account, but leaving it behind would hand the next person an account
        // the anchor still recognises. It holds no money, so dropping it costs
        // nothing and a later ramp simply makes another.
        await clearBridgeKey();
        set({
          account: null,
          locked: false,
          mode: 'customer',
          merchantProfile: null,
          merchantRegisteredOnChain: false,
          smartWallet: null,
          apiSession: null,
          wallet: null,
          pendingAnchorTransfer: null,
          pendingRequest: null,
          receipts: [],
          rampActivities: [],
        });
      },
      setMode: mode => set(state => (mode === 'merchant' && !state.merchantProfile ? state : {...state, mode})),
      setApiBaseUrl: apiBaseUrl => set({apiBaseUrl}),
      setDisplayCurrency: displayCurrency => set({displayCurrency}),
      setLanguage: language => set({language}),
      saveMerchantProfile: profile =>
        set({merchantProfile: profile, mode: 'merchant', merchantRegisteredOnChain: false}),
      setMerchantRegisteredOnChain: merchantRegisteredOnChain => set({merchantRegisteredOnChain}),
      setSmartWallet: smartWallet => set({smartWallet}),
      setApiSession: apiSession => set({apiSession}),
      setWallet: wallet => set({wallet}),
      setPendingAnchorTransfer: pendingAnchorTransfer => set({pendingAnchorTransfer}),
      setPendingRequest: request => set({pendingRequest: request}),
      addReceipt: receipt =>
        set(state => ({receipts: [receipt, ...state.receipts].slice(0, MAX_PERSISTED_RECEIPTS)})),
      addRampActivity: activity =>
        set(state => ({
          rampActivities: state.rampActivities.some(existing => existing.id === activity.id)
            ? state.rampActivities
            : [activity, ...state.rampActivities].slice(0, MAX_PERSISTED_RECEIPTS),
        })),
    }),
    {
      name: 'rosapay-session',
      // Version 6 adds validated ramp activity while retaining the classic
      // account adapter and existing receipts.
      version: 6,
      migrate: state => dropUnusableSecrets(state as Partial<AppState>),
      merge: (persisted, current) => ({...current, ...dropUnusableSecrets(persisted as Partial<AppState>)}),
      onRehydrateStorage: () => state => {
        // Only an owner who asked to be challenged is challenged. Everyone else
        // returns straight to their balance, and is asked for the device when
        // they go to pay.
        useAppStore.setState({
          hydrated: true,
          locked: Boolean(state?.account) && Boolean(state?.requireUnlock),
        });
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
        requireUnlock: state.requireUnlock,
        mode: state.mode,
        apiBaseUrl: state.apiBaseUrl,
        displayCurrency: state.displayCurrency,
        language: state.language,
        merchantProfile: state.merchantProfile,
        merchantRegisteredOnChain: state.merchantRegisteredOnChain,
        smartWallet: state.smartWallet,
        apiSession: state.apiSession,
        wallet: state.wallet,
        pendingAnchorTransfer: state.pendingAnchorTransfer,
        pendingRequest: state.pendingRequest,
        receipts: state.receipts,
        rampActivities: state.rampActivities,
      }),
    },
  ),
);
