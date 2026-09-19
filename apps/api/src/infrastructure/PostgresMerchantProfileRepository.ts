import type {PostgresQueryClient} from '@rosapay/postgres';
import type {
  MerchantProfile,
  MerchantProfileNetwork,
  MerchantProfileRepository,
} from '../application/MerchantProfileService';

type ProfileRow = {
  id: string;
  user_id: string | null;
  display_name: string;
  email: string | null;
  recipient: string;
  signing_key: string;
  network: string;
  status: string;
};

const SELECT_COLUMNS = 'id, user_id, display_name, email, recipient, signing_key, network, status';

export class PostgresMerchantProfileRepository implements MerchantProfileRepository {
  constructor(private readonly client: PostgresQueryClient) {}

  async findById(id: string): Promise<MerchantProfile | null> {
    const result = await this.client.query<ProfileRow>(
      `SELECT ${SELECT_COLUMNS} FROM merchant_profiles WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }

  async findByOwner(userId: string): Promise<MerchantProfile[]> {
    const result = await this.client.query<ProfileRow>(
      `SELECT ${SELECT_COLUMNS} FROM merchant_profiles WHERE user_id = $1 ORDER BY display_name`,
      [userId],
    );
    return result.rows.map(mapProfile);
  }

  async save(profile: MerchantProfile): Promise<void> {
    await this.client.query(
      `INSERT INTO merchant_profiles (id, user_id, display_name, email, recipient, signing_key, network, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
       WHERE merchant_profiles.email IS NULL`,
      [
        profile.id,
        profile.userId ?? null,
        profile.displayName,
        profile.email ?? null,
        profile.recipient,
        profile.signingKey,
        profile.network,
        profile.status,
      ],
    );
  }
}

function mapProfile(row: ProfileRow): MerchantProfile {
  if (row.status !== 'active') {
    throw new Error(`Unexpected merchant profile status from PostgreSQL: ${row.status}`);
  }
  if (row.network !== 'testnet' && row.network !== 'pubnet') {
    throw new Error(`Unexpected merchant profile network from PostgreSQL: ${row.network}`);
  }
  return {
    id: row.id,
    ...(row.user_id === null ? {} : {userId: row.user_id}),
    displayName: row.display_name,
    ...(row.email == null ? {} : {email: row.email}),
    recipient: row.recipient,
    signingKey: row.signing_key,
    network: row.network as MerchantProfileNetwork,
    status: 'active',
  };
}
