export type WalletRecord = {
  contractAddress: string;
  /** The device public key that controls the wallet, base64 uncompressed point. */
  publicSigner: string;
  network: 'testnet' | 'pubnet';
  status: 'active';
  userId?: string;
  /**
   * The passkey that may rotate `publicSigner` when the phone holding it is
   * gone. A record without one describes a wallet with no way back.
   */
  recovery?: {
    publicKey: string;
    credentialId: string;
    kind: 'Device' | 'Passkey';
  };
};

export interface WalletRepository {
  findBySigner(publicSigner: string): Promise<WalletRecord | null>;
  /**
   * The wallet a passkey recovers. A replacement phone knows only the
   * credential it holds, so this is the only door back in.
   */
  findByRecoveryCredential(credentialId: string): Promise<WalletRecord | null>;
  save(wallet: WalletRecord): Promise<void>;
}

export class InMemoryWalletRepository implements WalletRepository {
  private readonly bySigner = new Map<string, WalletRecord>();

  async findBySigner(publicSigner: string) {
    return this.bySigner.get(publicSigner) ?? null;
  }

  async findByRecoveryCredential(credentialId: string) {
    for (const wallet of this.bySigner.values()) {
      if (wallet.recovery?.credentialId === credentialId) return wallet;
    }
    return null;
  }

  async save(wallet: WalletRecord) {
    this.bySigner.set(wallet.publicSigner, wallet);
  }
}
