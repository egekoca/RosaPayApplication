import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import type {PostgresQueryClient} from '@rosapay/postgres';
import {loadMigrations, MigrationError, runMigrations} from '../src/infrastructure/migrations';

function fakeClient(applied: Array<{name: string; checksum: string}> = []) {
  const statements: Array<{text: string; values: readonly unknown[]}> = [];
  const client: PostgresQueryClient & {statements: typeof statements; transactions: number} = {
    statements,
    transactions: 0,
    async query<Row>(text: string, values: readonly unknown[] = []) {
      statements.push({text, values});
      if (text.startsWith('SELECT name, checksum')) return {rows: applied as Row[]};
      return {rows: [] as Row[]};
    },
    async withTransaction<T>(work: (transaction: PostgresQueryClient) => Promise<T>) {
      client.transactions += 1;
      return work(client);
    },
  };
  return client;
}

describe('migrations', () => {
  it('applies pending migrations in order, each in its own transaction', async () => {
    const client = fakeClient();
    const applied = await runMigrations(client, [
      {name: '001_initial.sql', sql: 'CREATE TABLE users ();'},
      {name: '002_devices.sql', sql: 'CREATE TABLE devices ();'},
    ]);

    expect(applied).toEqual(['001_initial.sql', '002_devices.sql']);
    expect(client.transactions).toBe(2);
    expect(client.statements[0]?.text).toContain('CREATE TABLE IF NOT EXISTS schema_migrations');
    expect(client.statements.map(statement => statement.text)).toContain('CREATE TABLE devices ();');
  });

  it('skips an applied migration and rejects one that was edited afterwards', async () => {
    const applyOnce = fakeClient();
    await runMigrations(applyOnce, [{name: '001_initial.sql', sql: 'CREATE TABLE users ();'}]);
    const insert = applyOnce.statements.find(statement => statement.text.startsWith('INSERT INTO schema_migrations'));
    const checksum = String(insert?.values[1]);

    const reapply = fakeClient([{name: '001_initial.sql', checksum}]);
    await expect(runMigrations(reapply, [{name: '001_initial.sql', sql: 'CREATE TABLE users ();'}]))
      .resolves.toEqual([]);
    await expect(runMigrations(reapply, [{name: '001_initial.sql', sql: 'CREATE TABLE users (id UUID);'}]))
      .rejects.toThrow('changed after it was applied');
  });

  it('rejects duplicate or unordered migration names', async () => {
    await expect(runMigrations(fakeClient(), [
      {name: '002_devices.sql', sql: ''},
      {name: '001_initial.sql', sql: ''},
    ])).rejects.toThrow('lexical order');
    await expect(runMigrations(fakeClient(), [
      {name: '001_initial.sql', sql: ''},
      {name: '001_initial.sql', sql: ''},
    ])).rejects.toThrow('unique');
  });

  it('loads the repository migration directory', async () => {
    const migrations = await loadMigrations(path.resolve(import.meta.dirname, '../db/migrations'));
    expect(migrations[0]?.name).toBe('001_initial.sql');
    expect(migrations[0]?.sql).toContain('CREATE TABLE IF NOT EXISTS payment_intents');
    expect(migrations.at(-1)?.name).toBe('009_wallet_recovery.sql');
    expect(migrations.at(-1)?.sql).toContain('recovery_credential_id');
  });

  it('rejects a badly named migration file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'rosapay-migrations-'));
    await writeFile(path.join(directory, 'initial.sql'), 'SELECT 1;');
    await expect(loadMigrations(directory)).rejects.toBeInstanceOf(MigrationError);
  });
});
