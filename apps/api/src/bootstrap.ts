import {
  createPostgresPool,
  readPostgresOptions,
  type PostgresConnection,
  type PostgresPoolOptions,
} from '@rosapay/postgres';
import type {IntentRepository} from './application/IntentService';
import type {MerchantProfileRepository} from './application/MerchantProfileService';
import {InMemoryWalletRepository, type WalletRepository} from './application/WalletRepository';
import {InMemoryAuditLog, type AuditLogRepository} from './application/AuditLog';
import {InMemoryIntentRepository} from './infrastructure/InMemoryIntentRepository';
import {InMemoryMerchantProfileRepository} from './infrastructure/InMemoryMerchantProfileRepository';
import {PostgresIntentRepository} from './infrastructure/PostgresIntentRepository';
import {PostgresMerchantProfileRepository} from './infrastructure/PostgresMerchantProfileRepository';
import {PostgresWalletRepository} from './infrastructure/PostgresWalletRepository';
import {PostgresAuditLog} from './infrastructure/PostgresAuditLog';
import {InMemoryDeviceAuthRepository, type DeviceAuthRepository} from './application/DeviceAuthService';
import {PostgresDeviceAuthRepository} from './infrastructure/PostgresDeviceAuthRepository';

export type ApiStorageMode = 'postgres' | 'memory';

export type ApiRuntime = {
  repository: IntentRepository;
  merchantProfiles: MerchantProfileRepository;
  wallets: WalletRepository;
  auditLog: AuditLogRepository;
  deviceAuth: DeviceAuthRepository;
  storage: ApiStorageMode;
  /**
   * Present only on a database-backed runtime, so the in-process reconciler can
   * share this pool rather than opening a second one against the same hosted
   * database on a plan that counts connections.
   */
  connection?: PostgresConnection;
  close(): Promise<void>;
};

export type ApiRuntimeOptions = {
  env?: NodeJS.ProcessEnv;
  createConnection?: (options: PostgresPoolOptions) => PostgresConnection;
};

/**
 * Chooses the intent storage for a process. A deployment supplies `DATABASE_URL`
 * to get the transaction-capable pool; `API_REQUIRE_DATABASE=true` refuses to
 * start on memory so production can never silently lose settlements, while the
 * local emulator flow keeps the in-memory default.
 */
export function createApiRuntime({
  env = process.env,
  createConnection = createPostgresPool,
}: ApiRuntimeOptions = {}): ApiRuntime {
  const options = readPostgresOptions(env);
  if (!options) {
    if (env.API_REQUIRE_DATABASE === 'true') {
      throw new Error('DATABASE_URL is required when API_REQUIRE_DATABASE is true');
    }
    return {
      repository: new InMemoryIntentRepository(),
      merchantProfiles: new InMemoryMerchantProfileRepository(),
      wallets: new InMemoryWalletRepository(),
      auditLog: new InMemoryAuditLog(),
      deviceAuth: new InMemoryDeviceAuthRepository(),
      storage: 'memory',
      close: async () => undefined,
    };
  }

  const connection = createConnection(options);
  return {
    repository: new PostgresIntentRepository(connection),
    merchantProfiles: new PostgresMerchantProfileRepository(connection),
    wallets: new PostgresWalletRepository(connection),
    auditLog: new PostgresAuditLog(connection),
    deviceAuth: new PostgresDeviceAuthRepository(connection),
    storage: 'postgres',
    connection,
    close: () => connection.close(),
  };
}
