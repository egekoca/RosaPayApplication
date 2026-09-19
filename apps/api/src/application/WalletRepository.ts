export type WalletRecord = {
  contractAddress: string;
  /** The device public key that controls the wallet, base64 uncompressed point. */
  publicSigner: string;
  network: 'testnet' | 'pubnet';
  status: 'active';
  userId?: string;
};

export interface WalletRepository {
  findBySigner(publicSigner: string): Promise<WalletRecord | null>;
  save(wallet: WalletRecord): Promise<void>;
}

export class InMemoryWalletRepository implements WalletRepository {
  private readonly bySigner = new Map<string, WalletRecord>();

  async findBySigner(publicSigner: string) {
    return this.bySigner.get(publicSigner) ?? null;
  }

  async save(wallet: WalletRecord) {
    this.bySigner.set(wallet.publicSigner, wallet);
  }
}
