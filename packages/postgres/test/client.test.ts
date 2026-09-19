import {describe, expect, it} from 'vitest';
import {
  createPostgresConnection,
  createPostgresPool,
  readPostgresOptions,
  type PostgresPoolLike,
} from '../src/client';

function fakePool(options: {failOn?: string} = {}) {
  const statements: string[] = [];
  let released = 0;
  let ended = 0;
  const client = {
    async query<Row>(text: string) {
      statements.push(text);
      if (options.failOn && text.startsWith(options.failOn)) {
        throw new Error(`statement failed: ${text}`);
      }
      return {rows: [] as Row[]};
    },
    release() {
      released += 1;
    },
  };
  const pool: PostgresPoolLike & {statements: string[]; released: () => number; ended: () => number} = {
    statements,
    released: () => released,
    ended: () => ended,
    async connect() {
      return client;
    },
    async query<Row>(text: string) {
      statements.push(text);
      return {rows: [] as Row[]};
    },
    async end() {
      ended += 1;
    },
  };
  return pool;
}

describe('Postgres connection', () => {
  it('commits a unit of work and releases the connection', async () => {
    const pool = fakePool();
    const connection = createPostgresConnection(pool);

    const result = await connection.withTransaction(async client => {
      await client.query('INSERT INTO payment_intents DEFAULT VALUES');
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(pool.statements).toEqual(['BEGIN', 'INSERT INTO payment_intents DEFAULT VALUES', 'COMMIT']);
    expect(pool.released()).toBe(1);
  });

  it('rolls back and rethrows when the unit of work fails', async () => {
    const pool = fakePool();
    const connection = createPostgresConnection(pool);

    await expect(
      connection.withTransaction(async () => {
        throw new Error('intent rejected');
      }),
    ).rejects.toThrow('intent rejected');
    expect(pool.statements).toEqual(['BEGIN', 'ROLLBACK']);
    expect(pool.released()).toBe(1);
  });

  it('keeps a nested unit of work inside the same transaction', async () => {
    const pool = fakePool();
    const connection = createPostgresConnection(pool);

    await connection.withTransaction(async client => {
      await client.withTransaction?.(async nested => {
        await nested.query('INSERT INTO settlements DEFAULT VALUES');
      });
    });

    expect(pool.statements).toEqual(['BEGIN', 'INSERT INTO settlements DEFAULT VALUES', 'COMMIT']);
  });

  it('releases the connection even when the rollback itself fails', async () => {
    const pool = fakePool({failOn: 'ROLLBACK'});
    const connection = createPostgresConnection(pool);

    await expect(connection.withTransaction(async () => Promise.reject(new Error('write failed')))).rejects.toThrow('write failed');
    expect(pool.released()).toBe(1);
  });

  it('closes the pool', async () => {
    const pool = fakePool();
    await createPostgresConnection(pool).close();
    expect(pool.ended()).toBe(1);
  });

  it('rejects an empty connection string and non-positive pool settings', () => {
    expect(() => createPostgresPool({connectionString: '  '})).toThrow('connection string is required');
    expect(() => createPostgresPool({connectionString: 'postgres://localhost/rosapay', maxConnections: 0}))
      .toThrow('maxConnections must be a positive integer');
  });

  it('reads pool options from the environment only when a database is configured', () => {
    expect(readPostgresOptions({})).toBeNull();
    expect(readPostgresOptions({DATABASE_URL: '   '})).toBeNull();
    expect(readPostgresOptions({DATABASE_URL: 'postgres://localhost/rosapay', DATABASE_SSL: 'true', DATABASE_MAX_CONNECTIONS: '4'}))
      .toEqual({connectionString: 'postgres://localhost/rosapay', maxConnections: 4, ssl: true});
  });

  /**
   * Supabase presents `Supabase Root 2021 CA`, which is in no system trust
   * store, so a verifying client rejects the pooler outright. The answer on
   * offer everywhere is `rejectUnauthorized: false`, which does not weaken
   * verification but removes it. Carrying the CA keeps it.
   */
  it('carries a certificate authority for a provider that runs its own', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
    expect(readPostgresOptions({DATABASE_URL: 'postgres://localhost/rosapay', DATABASE_SSL: 'true', DATABASE_CA_CERT: pem}))
      .toEqual({connectionString: 'postgres://localhost/rosapay', ssl: true, caCertificate: pem});
  });

  /**
   * A PEM pasted into a dashboard field or an unquoted shell variable arrives
   * with its newlines as the two characters `\` and `n`, and OpenSSL rejects
   * that as unparseable long after the deployment looked configured.
   */
  it('restores newlines a dashboard turned into escapes', () => {
    const options = readPostgresOptions({
      DATABASE_URL: 'postgres://localhost/rosapay',
      DATABASE_SSL: 'true',
      DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----',
    });
    expect(options?.caCertificate).toBe('-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----');
  });

  it('leaves the certificate out entirely when none is configured', () => {
    expect(readPostgresOptions({DATABASE_URL: 'postgres://localhost/rosapay', DATABASE_SSL: 'true'}))
      .toEqual({connectionString: 'postgres://localhost/rosapay', ssl: true});
  });
});
