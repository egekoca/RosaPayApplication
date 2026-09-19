import type {PostgresQueryClient} from '@rosapay/postgres';
import type {DeviceAuthRepository, DeviceChallenge} from '../application/DeviceAuthService';

type ChallengeRow = {id: string; public_signer: string; digest: string; expires_at: Date | string};

export class PostgresDeviceAuthRepository implements DeviceAuthRepository {
  constructor(private readonly client: PostgresQueryClient) {}

  async saveChallenge(challenge: DeviceChallenge): Promise<void> {
    await this.client.query('DELETE FROM device_auth_challenges WHERE expires_at <= NOW()');
    await this.client.query(
      `INSERT INTO device_auth_challenges (id, public_signer, digest, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [challenge.id, challenge.publicSigner, challenge.digest, challenge.expiresAt],
    );
  }

  async consumeChallenge(id: string, publicSigner: string, now: Date): Promise<DeviceChallenge | null> {
    const result = await this.client.query<ChallengeRow>(
      `DELETE FROM device_auth_challenges
        WHERE id = $1 AND public_signer = $2 AND expires_at > $3
      RETURNING id, public_signer, digest, expires_at`,
      [id, publicSigner, now],
    );
    const row = result.rows[0];
    return row ? {
      id: row.id,
      publicSigner: row.public_signer,
      digest: row.digest,
      expiresAt: new Date(row.expires_at),
    } : null;
  }

  async ensureUser(id: string): Promise<void> {
    await this.client.query(
      `INSERT INTO users (id, status) VALUES ($1, 'active') ON CONFLICT (id) DO NOTHING`,
      [id],
    );
  }
}
