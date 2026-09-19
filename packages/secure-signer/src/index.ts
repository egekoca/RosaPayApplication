export type SignerIdentity = {
  signerId: string;
  publicKey: string;
  kind: 'passkey' | 'device-key' | 'mock';
};

export type PaymentAuthorizationRequest = {
  intentId: string;
  intentHash: string;
  network: 'testnet' | 'pubnet';
  settlementContractId: string;
};

export type PaymentAuthorization = {
  signerId: string;
  authorization: string;
  authorizedAt: string;
};

export type SecureSignerErrorCode =
  | 'UNAVAILABLE'
  | 'USER_CANCELLED'
  | 'BIOMETRIC_FAILED'
  | 'LOCKED_OUT'
  | 'PROCESS_INTERRUPTED'
  | 'INVALID_REQUEST';

export class SecureSignerError extends Error {
  override readonly name = 'SecureSignerError';

  constructor(readonly code: SecureSignerErrorCode, message: string) {
    super(message);
  }
}

export type SignTransactionRequest = {
  xdr: string;
  networkPassphrase: string;
  address?: string;
};

export type SignedTransaction = {
  signedTxXdr: string;
  signerAddress?: string;
};

export type SignAuthEntryRequest = {
  authEntry: string;
  networkPassphrase: string;
  address?: string;
};

export type SignedAuthEntry = {
  signedAuthEntry: string;
  signerAddress?: string;
};

export interface SecureSigner {
  getIdentity(): Promise<SignerIdentity | null>;
  createIdentity(displayName: string): Promise<SignerIdentity>;
  authorizePayment(request: PaymentAuthorizationRequest): Promise<PaymentAuthorization>;
  signTransaction?(request: SignTransactionRequest): Promise<SignedTransaction>;
  signAuthEntry?(request: SignAuthEntryRequest): Promise<SignedAuthEntry>;
}

export type NativeSignerBridge = {
  getIdentity(): Promise<SignerIdentity | null>;
  createIdentity(displayName: string): Promise<SignerIdentity>;
  authorizePayment(request: PaymentAuthorizationRequest): Promise<PaymentAuthorization>;
  signTransaction?(request: SignTransactionRequest): Promise<SignedTransaction>;
  signAuthEntry?(request: SignAuthEntryRequest): Promise<SignedAuthEntry>;
};

export class NativeSecureSigner implements SecureSigner {
  constructor(private readonly bridge: NativeSignerBridge) {}
  getIdentity = () => this.bridge.getIdentity();
  createIdentity = (displayName: string) => this.bridge.createIdentity(displayName);
  authorizePayment = (request: PaymentAuthorizationRequest) => this.bridge.authorizePayment(request);

  async signTransaction(request: SignTransactionRequest): Promise<SignedTransaction> {
    if (!this.bridge.signTransaction) {
      throw new SecureSignerError('UNAVAILABLE', 'Native transaction signing is not available');
    }
    return this.bridge.signTransaction(request);
  }

  async signAuthEntry(request: SignAuthEntryRequest): Promise<SignedAuthEntry> {
    if (!this.bridge.signAuthEntry) {
      throw new SecureSignerError('UNAVAILABLE', 'Native auth-entry signing is not available');
    }
    return this.bridge.signAuthEntry(request);
  }
}

export type StellarSignerOptions = {networkPassphrase?: string; address?: string};
export type StellarTransactionSigner = (xdr: string, options?: StellarSignerOptions) => Promise<SignedTransaction>;
export type StellarAuthEntrySigner = (authEntry: string, options?: StellarSignerOptions) => Promise<SignedAuthEntry>;

export function createStellarSignerCallbacks(
  signer: SecureSigner & {
    signTransaction(request: SignTransactionRequest): Promise<SignedTransaction>;
    signAuthEntry(request: SignAuthEntryRequest): Promise<SignedAuthEntry>;
  },
): {signTransaction: StellarTransactionSigner; signAuthEntry: StellarAuthEntrySigner} {
  return {
    signTransaction: (xdr, options) => signer.signTransaction({
      xdr,
      networkPassphrase: options?.networkPassphrase ?? '',
      address: options?.address,
    }),
    signAuthEntry: (authEntry, options) => signer.signAuthEntry({
      authEntry,
      networkPassphrase: options?.networkPassphrase ?? '',
      address: options?.address,
    }),
  };
}
