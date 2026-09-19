import type {EventCursor, EventCursorStore} from './confirmationWorker';

export type PostgresCursorQueryClient = {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{rows: Row[]}>;
};

type CursorRow = {
  cursor: string;
  start_ledger: number | string;
};

/** PostgreSQL-backed checkpoint for RPC event pagination. */
export class PostgresEventCursorStore implements EventCursorStore {
  constructor(
    private readonly client: PostgresCursorQueryClient,
    private readonly name = 'settlement_events',
  ) {}

  async load(): Promise<EventCursor | null> {
    const result = await this.client.query<CursorRow>(
      `SELECT cursor, start_ledger
         FROM worker_event_cursors
        WHERE name = $1`,
      [this.name],
    );
    const row = result.rows[0];
    if (!row) return null;
    const startLedger = Number(row.start_ledger);
    if (!row.cursor || !Number.isSafeInteger(startLedger) || startLedger <= 0) {
      throw new Error('Invalid worker event cursor stored in PostgreSQL');
    }
    return {cursor: row.cursor, startLedger};
  }

  async save(cursor: EventCursor): Promise<void> {
    if (!cursor.cursor.trim() || !Number.isSafeInteger(cursor.startLedger) || cursor.startLedger <= 0) {
      throw new Error('Worker event cursor must contain a cursor and positive ledger');
    }
    await this.client.query(
      `INSERT INTO worker_event_cursors (name, cursor, start_ledger)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET
         cursor = EXCLUDED.cursor,
         start_ledger = EXCLUDED.start_ledger,
         updated_at = now()`,
      [this.name, cursor.cursor, cursor.startLedger],
    );
  }
}
