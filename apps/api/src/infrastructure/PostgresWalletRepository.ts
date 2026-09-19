import type {PostgresQueryClient} from '@rosapay/postgres';
import type {WalletRecord, WalletRepository} from '../application/WalletRepository';

type WalletRow = {
  contract_address: string;
  public_signer: string;
  network: string;
  status: string;
  user_id: string | null;
  recovery_public_key: string | null;
  recovery_credential_id: string | null;
  recovery_signer_kind: string | null;
};

export class PostgresWalletRepository implements WalletRepository {
  constructor(private readonly client: PostgresQueryClient) {}

  private static readonly columns =
    'contract_address, public_signer, network, status, user_id, ' +
    'recovery_public_key, recovery_credential_id, recovery_signer_kind';

  async findBySigner(publicSigner: string): Promise<WalletRecord | null> {
    const result = await this.client.query<WalletRow>(
      `SELECT ${PostgresWalletRepository.columns}
         FROM wallets
        WHERE public_signer = $1`,
      [publicSigner],
    );
    return this.toRecord(result.rows[0]);
  }

  async findByRecoveryCredential(credentialId: string): Promise<WalletRecord | null> {
    const result = await this.client.query<WalletRow>(
      `SELECT ${PostgresWalletRepository.columns}
         FROM wallets
        WHERE recovery_credential_id = $1`,
      [credentialId],
    );
    return this.toRecord(result.rows[0]);
  }

  private toRecord(row: WalletRow | undefined): WalletRecord | null {
    if (!row) return null;
    if (row.status !== 'active') {
      throw new Error(`Unexpected wallet status from PostgreSQL: ${row.status}`);
    }
    if (row.network !== 'testnet' && row.network !== 'pubnet') {
      throw new Error(`Unexpected wallet network from PostgreSQL: ${row.network}`);
    }
    const kind = row.recovery_signer_kind;
    return {
      contractAddress: row.contract_address,
      publicSigner: row.public_signer,
      network: row.network,
      status: 'active',
      ...(row.user_id === null ? {} : {userId: row.user_id}),
      ...(row.recovery_public_key && row.recovery_credential_id && (kind === 'Device' || kind === 'Passkey')
        ? {
            recovery: {
              publicKey: row.recovery_public_key,
              credentialId: row.recovery_credential_id,
              kind,
            },
          }
        : {}),
    };
  }

  async save(wallet: WalletRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO wallets (
         contract_address, public_signer, network, status, user_id,
         recovery_public_key, recovery_credential_id, recovery_signer_kind
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (public_signer) DO UPDATE
         SET user_id = COALESCE(wallets.user_id, EXCLUDED.user_id),
             -- A recovery signer is set once. Letting a later call replace it
             -- would let whoever makes that call take the wallet.
             recovery_public_key = COALESCE(wallets.recovery_public_key, EXCLUDED.recovery_public_key),
             recovery_credential_id = COALESCE(wallets.recovery_credential_id, EXCLUDED.recovery_credential_id),
             recovery_signer_kind = COALESCE(wallets.recovery_signer_kind, EXCLUDED.recovery_signer_kind)`,
      [
        wallet.contractAddress,
        wallet.publicSigner,
        wallet.network,
        wallet.status,
        wallet.userId ?? null,
        wallet.recovery?.publicKey ?? null,
        wallet.recovery?.credentialId ?? null,
        wallet.recovery?.kind ?? null,
      ],
    );
  }
}
