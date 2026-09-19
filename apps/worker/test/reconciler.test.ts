import {afterEach, describe, expect, it, vi} from 'vitest';

/**
 * The reconciliation loop has to be runnable inside the API as well as beside
 * it. A settlement only ever reaches `confirmed` here, so a deployment that
 * cannot afford a second service - hosts charge for a background worker, and
 * these are demo volumes - would otherwise show a merchant nothing after a
 * payment that in fact succeeded on chain.
 *
 * Two things make that safe, and both are easy to break by accident: the loop
 * must borrow the caller's database pool rather than open a second against a
 * connection-counted plan, and it must leave a borrowed pool open when it stops.
 */
const rpcHealth = vi.fn(async () => ({status: 'healthy', latestLedger: 100}));

vi.mock('@rosapay/stellar', () => ({
  createStellarConfig: (network: string, overrides: Record<string, unknown>) => ({network, ...overrides}),
  StellarRpcClient: class {
    health = rpcHealth;
    async getTransaction() { return null; }
    async getEvents() { return {events: [], latestLedger: 100}; }
  },
}));

const createPostgresPool = vi.fn((_options: unknown) => undefined as unknown);
const readPostgresOptions = vi.fn(
  (_env?: unknown) => ({connectionString: 'postgres://example/db', ssl: true}) as unknown,
);

vi.mock('@rosapay/postgres', () => ({
  createPostgresPool: (options: unknown) => createPostgresPool(options),
  readPostgresOptions: (env?: unknown) => readPostgresOptions(env),
}));

const {startReconciler} = await import('../src/reconciler');

function poolStub() {
  return {
    close: vi.fn(async () => undefined),
    query: vi.fn(async () => ({rows: []})),
    withTransaction: vi.fn(),
  };
}

afterEach(() => {
  vi.clearAllMocks();
  readPostgresOptions.mockReturnValue({connectionString: 'postgres://example/db', ssl: true});
});

describe('the reconciliation loop inside another process', () => {
  it('borrows the pool it is handed instead of opening a second one', async () => {
    const connection = poolStub();

    const reconciler = await startReconciler({
      connection: connection as never,
      env: {STELLAR_NETWORK: 'testnet', WORKER_INTERVAL_MS: '50'} as never,
      log: () => undefined,
    });

    expect(reconciler).not.toBeNull();
    expect(createPostgresPool).not.toHaveBeenCalled();

    await reconciler!.stop();
    // Closing it would pull the database out from under the API that lent it.
    expect(connection.close).not.toHaveBeenCalled();
  });

  it('opens and closes its own pool when it is not handed one', async () => {
    const connection = poolStub();
    createPostgresPool.mockReturnValue(connection);

    const reconciler = await startReconciler({
      env: {STELLAR_NETWORK: 'testnet', WORKER_INTERVAL_MS: '50'} as never,
      log: () => undefined,
    });

    expect(createPostgresPool).toHaveBeenCalledTimes(1);

    await reconciler!.stop();
    expect(connection.close).toHaveBeenCalledTimes(1);
  });

  it('stays out of the way when there is no database to reconcile', async () => {
    readPostgresOptions.mockReturnValue(null);

    const reconciler = await startReconciler({env: {} as never, log: () => undefined});

    expect(reconciler).toBeNull();
    expect(createPostgresPool).not.toHaveBeenCalled();
    // No database means no RPC client either: nothing is asked of the network.
    expect(rpcHealth).not.toHaveBeenCalled();
  });
});
