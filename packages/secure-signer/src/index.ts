export * from './secp256r1';
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
  /**
   * The key still exists but can never sign again, because the screen lock it
   * was bound to was changed or removed. Distinct from LOCKED_OUT, which clears
   * on its own: nothing the owner does will bring this key back.
   */
  | 'KEY_INVALIDATED'
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

/** A digest the platform key signs after the user is present. */
export type DigestSignatureRequest = {
  /** Base64 of the exact 32 bytes to sign. */
  digest: string;
  /** Shown in the platform authentication prompt. */
  reason: string;
};

export type DigestSignature = {
  signerId: string;
  /** Base64 DER signature as returned by the platform keystore. */
  signature: string;
  signedAt: string;
};

export type NativeSignerBridge = {
  getIdentity(): Promise<SignerIdentity | null>;
  createIdentity(displayName: string): Promise<SignerIdentity>;
  authorizePayment(request: PaymentAuthorizationRequest): Promise<PaymentAuthorization>;
  signTransaction?(request: SignTransactionRequest): Promise<SignedTransaction>;
  signAuthEntry?(request: SignAuthEntryRequest): Promise<SignedAuthEntry>;
  /**
   * Signs an opaque digest with the hardware key. Contract-account signing keeps
   * every XDR detail in JavaScript so the platform module only ever handles a
   * digest and the key never leaves the secure element.
   */
  signDigest?(request: DigestSignatureRequest): Promise<DigestSignature>;
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

  async signDigest(request: DigestSignatureRequest): Promise<DigestSignature> {
    if (!this.bridge.signDigest) {
      throw new SecureSignerError('UNAVAILABLE', 'This device cannot sign with a hardware key');
    }
    return this.bridge.signDigest(request);
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
