import {describe, expect, it} from 'vitest';
import type {PostgresConnection, PostgresPoolOptions} from '@rosapay/postgres';
import {createApiRuntime} from '../src/bootstrap';
import {InMemoryIntentRepository} from '../src/infrastructure/InMemoryIntentRepository';
import {PostgresIntentRepository} from '../src/infrastructure/PostgresIntentRepository';

function fakeConnection() {
  const state = {closed: 0, options: undefined as PostgresPoolOptions | undefined};
  const create = (options: PostgresPoolOptions): PostgresConnection => {
    state.options = options;
    return {
      async query<Row>() {
        return {rows: [] as Row[]};
      },
      async withTransaction(work) {
        return work({query: async <Row>() => ({rows: [] as Row[]})});
      },
      async close() {
        state.closed += 1;
      },
    };
  };
  return {create, state};
}

describe('API runtime', () => {
  it('uses the in-memory repository when no database is configured', async () => {
    const runtime = createApiRuntime({env: {}});
    expect(runtime.storage).toBe('memory');
    expect(runtime.repository).toBeInstanceOf(InMemoryIntentRepository);
    await expect(runtime.close()).resolves.toBeUndefined();
  });

  it('builds the PostgreSQL repository from DATABASE_URL and closes the pool', async () => {
    const {create, state} = fakeConnection();
    const runtime = createApiRuntime({
      env: {DATABASE_URL: 'postgres://localhost/rosapay', DATABASE_SSL: 'true'},
      createConnection: create,
    });

    expect(runtime.storage).toBe('postgres');
    expect(runtime.repository).toBeInstanceOf(PostgresIntentRepository);
    expect(state.options).toMatchObject({connectionString: 'postgres://localhost/rosapay', ssl: true});
    await runtime.close();
    expect(state.closed).toBe(1);
  });

  it('refuses to start on memory when a database is required', () => {
    expect(() => createApiRuntime({env: {API_REQUIRE_DATABASE: 'true'}}))
      .toThrow('DATABASE_URL is required when API_REQUIRE_DATABASE is true');
  });
});
