import {createHash} from 'node:crypto';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import type {PostgresQueryClient} from '@rosapay/postgres';

export type Migration = {
  name: string;
  sql: string;
};

export class MigrationError extends Error {}

const MIGRATION_NAME = /^\d{3}_[a-z0-9_]+\.sql$/;

/** Reads `NNN_name.sql` files in lexical order; the numeric prefix is the order. */
export async function loadMigrations(directory: string): Promise<Migration[]> {
  const entries = (await readdir(directory)).filter(entry => entry.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  for (const entry of entries) {
    if (!MIGRATION_NAME.test(entry)) {
      throw new MigrationError(`Migration file must be named NNN_name.sql: ${entry}`);
    }
    migrations.push({name: entry, sql: await readFile(path.join(directory, entry), 'utf8')});
  }
  if (migrations.length === 0) {
    throw new MigrationError(`No migrations were found in ${directory}`);
  }
  return migrations;
}

/**
 * Applies pending migrations in order, each inside its own transaction, and
 * records a checksum so an already-applied file can never be edited silently.
 */
export async function runMigrations(
  client: PostgresQueryClient,
  migrations: readonly Migration[],
): Promise<string[]> {
  assertOrderedAndUnique(migrations);
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       checksum TEXT NOT NULL,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
  const applied = await client.query<{name: string; checksum: string}>(
    'SELECT name, checksum FROM schema_migrations ORDER BY name',
  );
  const appliedByName = new Map(applied.rows.map(row => [row.name, row.checksum]));

  const pending: string[] = [];
  for (const migration of migrations) {
    const checksum = checksumOf(migration.sql);
    const previous = appliedByName.get(migration.name);
    if (previous !== undefined) {
      if (previous !== checksum) {
        throw new MigrationError(`Migration ${migration.name} changed after it was applied`);
      }
      continue;
    }

    const apply = async (transaction: PostgresQueryClient) => {
      await transaction.query(migration.sql);
      await transaction.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        migration.name,
        checksum,
      ]);
    };
    if (client.withTransaction) {
      await client.withTransaction(apply);
    } else {
      // Driver-neutral test adapters may not expose transactions.
      await apply(client);
    }
    pending.push(migration.name);
  }
  return pending;
}

function assertOrderedAndUnique(migrations: readonly Migration[]): void {
  const names = migrations.map(migration => migration.name);
  if (new Set(names).size !== names.length) {
    throw new MigrationError('Migration names must be unique');
  }
  const sorted = [...names].sort();
  if (names.some((name, index) => name !== sorted[index])) {
    throw new MigrationError('Migrations must be applied in lexical order');
  }
}

function checksumOf(sql: string): string {
  return createHash('sha256').update(sql.trim()).digest('hex');
}
