import {describe, expect, it} from 'vitest';
import type {PostgresQueryClient} from '@rosapay/postgres';
import {PostgresDeviceAuthRepository} from '../src/infrastructure/PostgresDeviceAuthRepository';
import {PostgresWalletRepository} from '../src/infrastructure/PostgresWalletRepository';

function fakeClient(rows: Record<string, unknown>[] = []) {
  const queries: Array<{text: string; values: readonly unknown[]}> = [];
  const client: PostgresQueryClient & {queries: typeof queries} = {
    queries,
    async query<Row>(text: string, values: readonly unknown[] = []) {
      queries.push({text, values});
      return {rows: rows as Row[]};
    },
  };
  return client;
}

describe('PostgreSQL device authentication', () => {
  it('removes expired challenges before inserting a fresh one', async () => {
    const client = fakeClient();
    const repository = new PostgresDeviceAuthRepository(client);
    const expiresAt = new Date('2026-09-03T12:05:00.000Z');

    await repository.saveChallenge({
      id: '12e5dc5b-1c7b-47be-8ca2-2fa49b558cd6',
      publicSigner: 'signer',
      digest: 'digest',
      expiresAt,
    });

    expect(client.queries).toHaveLength(2);
    expect(client.queries[0]?.text).toBe('DELETE FROM device_auth_challenges WHERE expires_at <= NOW()');
    expect(client.queries[1]?.text).toContain('INSERT INTO device_auth_challenges');
    expect(client.queries[1]?.values).toEqual([
      '12e5dc5b-1c7b-47be-8ca2-2fa49b558cd6', 'signer', 'digest', expiresAt,
    ]);
  });

  it('atomically consumes one unexpired challenge with DELETE RETURNING', async () => {
    const expiresAt = new Date('2026-09-03T12:05:00.000Z');
    const client = fakeClient([{
      id: '12e5dc5b-1c7b-47be-8ca2-2fa49b558cd6',
      public_signer: 'signer',
      digest: 'digest',
      expires_at: expiresAt,
    }]);
    const repository = new PostgresDeviceAuthRepository(client);
    const now = new Date('2026-09-03T12:00:00.000Z');

    await expect(repository.consumeChallenge(
      '12e5dc5b-1c7b-47be-8ca2-2fa49b558cd6', 'signer', now,
    )).resolves.toEqual({
      id: '12e5dc5b-1c7b-47be-8ca2-2fa49b558cd6',
      publicSigner: 'signer',
      digest: 'digest',
      expiresAt,
    });
    expect(client.queries[0]?.text).toContain('DELETE FROM device_auth_challenges');
    expect(client.queries[0]?.text).toContain('expires_at > $3');
    expect(client.queries[0]?.text).toContain('RETURNING id, public_signer, digest, expires_at');
    expect(client.queries[0]?.values).toEqual([
      '12e5dc5b-1c7b-47be-8ca2-2fa49b558cd6', 'signer', now,
    ]);
  });

  it('claims an anonymous wallet without replacing an existing owner', async () => {
    const client = fakeClient();
    const repository = new PostgresWalletRepository(client);

    await repository.save({
      contractAddress: 'CAFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUTSM',
      publicSigner: 'signer',
      network: 'testnet',
      status: 'active',
      userId: '9e12d62b-5c31-5e6f-a7ec-651a19c6c278',
    });

    expect(client.queries[0]?.text).toContain('ON CONFLICT (public_signer) DO UPDATE');
    expect(client.queries[0]?.text).toContain('COALESCE(wallets.user_id, EXCLUDED.user_id)');
    expect(client.queries[0]?.values[4]).toBe('9e12d62b-5c31-5e6f-a7ec-651a19c6c278');
    // A wallet saved without a recovery signer says so, rather than leaving the
    // columns to whatever a later write happens to put there.
    expect(client.queries[0]?.values.slice(5)).toEqual([null, null, null]);
  });

  it('records the passkey that can rescue a wallet, and never lets it be replaced', async () => {
    const client = fakeClient();
    const repository = new PostgresWalletRepository(client);

    await repository.save({
      contractAddress: 'CAFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUTSM',
      publicSigner: 'signer',
      network: 'testnet',
      status: 'active',
      recovery: {publicKey: 'recovery-key', credentialId: 'credential', kind: 'Passkey'},
    });

    expect(client.queries[0]?.values.slice(5)).toEqual(['recovery-key', 'credential', 'Passkey']);
    // Overwriting a recovery signer would hand the wallet to whoever wrote last.
    expect(client.queries[0]?.text).toContain(
      'COALESCE(wallets.recovery_public_key, EXCLUDED.recovery_public_key)',
    );
    expect(client.queries[0]?.text).toContain(
      'COALESCE(wallets.recovery_credential_id, EXCLUDED.recovery_credential_id)',
    );
  });

  it('finds the wallet a credential recovers', async () => {
    const client = fakeClient();
    const repository = new PostgresWalletRepository(client);

    await repository.findByRecoveryCredential('credential');
    expect(client.queries[0]?.text).toContain('WHERE recovery_credential_id = $1');
    expect(client.queries[0]?.values).toEqual(['credential']);
  });
});
