import {describe, expect, it, vi} from 'vitest';
import type {PostgresQueryClient} from '@rosapay/postgres';
import {PostgresMerchantProfileRepository} from '../src/infrastructure/PostgresMerchantProfileRepository';

describe('PostgreSQL merchant email persistence', () => {
  it('writes business email and reads it back with the original signing identity', async () => {
    const row = {
      id: 'merchant-1', user_id: 'owner', display_name: 'Coffee', email: 'shop@example.com',
      recipient: 'recipient', signing_key: 'signer', network: 'testnet', status: 'active',
    };
    const query = vi.fn().mockResolvedValue({rows: [row], rowCount: 1});
    const repository = new PostgresMerchantProfileRepository({query} as PostgresQueryClient);
    const stored = await repository.findById(row.id);
    expect(stored).toEqual({
      id: row.id, userId: row.user_id, displayName: row.display_name, email: row.email,
      recipient: row.recipient, signingKey: row.signing_key, network: row.network, status: row.status,
    });
    await repository.save(stored!);
    expect(query.mock.calls[1]?.[1]).toEqual([
      row.id, row.user_id, row.display_name, row.email, row.recipient, row.signing_key, row.network, row.status,
    ]);
    expect(query.mock.calls[1]?.[0]).toContain('WHERE merchant_profiles.email IS NULL');
  });

  it('reads pre-migration profiles without inventing contact details', async () => {
    const query = vi.fn().mockResolvedValue({rows: [{
      id: 'legacy', user_id: null, display_name: 'Coffee', email: null,
      recipient: 'recipient', signing_key: 'signer', network: 'testnet', status: 'active',
    }]});
    const repository = new PostgresMerchantProfileRepository({query} as PostgresQueryClient);
    expect(await repository.findById('legacy')).not.toHaveProperty('email');
  });
});
