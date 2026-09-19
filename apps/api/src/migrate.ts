import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPostgresPool, readPostgresOptions} from '@rosapay/postgres';
import {loadMigrations, runMigrations} from './infrastructure/migrations';

const options = readPostgresOptions();
if (!options) {
  console.error(JSON.stringify({level: 'error', event: 'migration_skipped', reason: 'DATABASE_URL is not set'}));
  process.exit(1);
}

const directory = process.env.DATABASE_MIGRATIONS_DIR
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/migrations');
const connection = createPostgresPool(options);
try {
  const applied = await runMigrations(connection, await loadMigrations(directory));
  console.info(JSON.stringify({level: 'info', event: 'migrations_applied', directory, applied}));
} finally {
  await connection.close();
}
