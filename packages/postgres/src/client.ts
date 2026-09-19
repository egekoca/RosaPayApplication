import pg from 'pg';

export type PostgresQueryResult<Row> = {rows: Row[]};

/** Driver-neutral port shared by the API repository and the worker adapters. */
export type PostgresQueryClient = {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>>;
  withTransaction?<T>(work: (client: PostgresQueryClient) => Promise<T>): Promise<T>;
};

/** Minimal `pg.PoolClient` surface, so tests can inject a fake pool. */
export type PostgresPooledClientLike = {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>>;
  release(): void;
};

/** Minimal `pg.Pool` surface, so tests can inject a fake pool. */
export type PostgresPoolLike = {
  connect(): Promise<PostgresPooledClientLike>;
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>>;
  end(): Promise<void>;
};

export type PostgresConnection = {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>>;
  withTransaction<T>(work: (client: PostgresQueryClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

export type PostgresPoolOptions = {
  connectionString: string;
  maxConnections?: number;
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
  statementTimeoutMs?: number;
  ssl?: boolean;
};

/**
 * Wraps a connection pool as a transaction-capable query client. Work inside
 * `withTransaction` runs on one checked-out connection so the API can persist an
 * intent and its settlement atomically; a nested call reuses the same
 * transaction instead of opening a second one.
 */
export function createPostgresConnection(pool: PostgresPoolLike): PostgresConnection {
  return {
    query: (text, values) => pool.query(text, values),
    async withTransaction<T>(work: (client: PostgresQueryClient) => Promise<T>): Promise<T> {
      const connection = await pool.connect();
      const transactional: PostgresQueryClient = {
        query: (text, values) => connection.query(text, values),
        // A nested unit of work is already inside this transaction.
        withTransaction: nested => nested(transactional),
      };
      try {
        await connection.query('BEGIN');
        const result = await work(transactional);
        await connection.query('COMMIT');
        return result;
      } catch (error) {
        await connection.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        connection.release();
      }
    },
    close: () => pool.end(),
  };
}

/** Creates the production `pg.Pool` used by the API and worker runtimes. */
export function createPostgresPool(options: PostgresPoolOptions): PostgresConnection {
  if (!options.connectionString.trim()) {
    throw new Error('A PostgreSQL connection string is required');
  }
  for (const [name, value] of Object.entries({
    maxConnections: options.maxConnections,
    connectionTimeoutMs: options.connectionTimeoutMs,
    idleTimeoutMs: options.idleTimeoutMs,
    statementTimeoutMs: options.statementTimeoutMs,
  })) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`PostgreSQL ${name} must be a positive integer`);
    }
  }

  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    idleTimeoutMillis: options.idleTimeoutMs ?? 30_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    ...(options.ssl ? {ssl: {rejectUnauthorized: true}} : {}),
  });
  // An idle client error must not take the process down before shutdown runs.
  pool.on('error', error => {
    console.error(JSON.stringify({level: 'error', event: 'postgres_idle_client_error', message: (error as Error).message}));
  });
  // `pg` generics are narrower than the port; the runtime shape is identical.
  return createPostgresConnection(pool as unknown as PostgresPoolLike);
}

/** Reads pool settings from the environment; returns null when no database is configured. */
export function readPostgresOptions(env: NodeJS.ProcessEnv = process.env): PostgresPoolOptions | null {
  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString) return null;
  return {
    connectionString,
    ...(env.DATABASE_MAX_CONNECTIONS ? {maxConnections: Number(env.DATABASE_MAX_CONNECTIONS)} : {}),
    ...(env.DATABASE_STATEMENT_TIMEOUT_MS ? {statementTimeoutMs: Number(env.DATABASE_STATEMENT_TIMEOUT_MS)} : {}),
    ssl: env.DATABASE_SSL === 'true',
  };
}
