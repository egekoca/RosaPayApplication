import type {PostgresQueryClient} from '@rosapay/postgres';
import type {WalletRecord, WalletRepository} from '../application/WalletRepository';

type WalletRow = {
  contract_address: string;
  public_signer: string;
  network: string;
  status: string;
  user_id: string | null;
};

export class PostgresWalletRepository implements WalletRepository {
  constructor(private readonly client: PostgresQueryClient) {}

  async findBySigner(publicSigner: string): Promise<WalletRecord | null> {
    const result = await this.client.query<WalletRow>(
      `SELECT contract_address, public_signer, network, status, user_id
         FROM wallets
        WHERE public_signer = $1`,
      [publicSigner],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.status !== 'active') {
      throw new Error(`Unexpected wallet status from PostgreSQL: ${row.status}`);
    }
    if (row.network !== 'testnet' && row.network !== 'pubnet') {
      throw new Error(`Unexpected wallet network from PostgreSQL: ${row.network}`);
    }
    return {
      contractAddress: row.contract_address,
      publicSigner: row.public_signer,
      network: row.network,
      status: 'active',
      ...(row.user_id === null ? {} : {userId: row.user_id}),
    };
  }

  async save(wallet: WalletRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO wallets (contract_address, public_signer, network, status, user_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (public_signer) DO NOTHING`,
      [wallet.contractAddress, wallet.publicSigner, wallet.network, wallet.status, wallet.userId ?? null],
    );
  }
}
