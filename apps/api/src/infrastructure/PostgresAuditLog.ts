import type {PostgresQueryClient} from '@rosapay/postgres';
import type {AuditEvent, AuditEventName, AuditLogRepository} from '../application/AuditLog';
import {auditEvents} from '../application/AuditLog';

type AuditRow = {
  event: string;
  subject: string;
  actor: string | null;
  detail: unknown;
  occurred_at: Date | string;
};

export class PostgresAuditLog implements AuditLogRepository {
  constructor(private readonly client: PostgresQueryClient) {}

  async append(event: AuditEvent): Promise<void> {
    await this.client.query(
      `INSERT INTO audit_events (event, subject, actor, detail, occurred_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [event.event, event.subject, event.actor ?? null, JSON.stringify(event.detail ?? {}), event.occurredAt],
    );
  }

  async listForSubject(subject: string, limit: number): Promise<AuditEvent[]> {
    const result = await this.client.query<AuditRow>(
      `SELECT event, subject, actor, detail, occurred_at
         FROM audit_events
        WHERE subject = $1
        ORDER BY occurred_at DESC, id DESC
        LIMIT $2`,
      [subject, limit],
    );
    return result.rows.map(mapEvent);
  }
}

function mapEvent(row: AuditRow): AuditEvent {
  if (!isAuditEventName(row.event)) {
    throw new Error(`Unexpected audit event from PostgreSQL: ${row.event}`);
  }
  const detail = typeof row.detail === 'string' ? JSON.parse(row.detail) : row.detail;
  return {
    event: row.event,
    subject: row.subject,
    ...(row.actor === null ? {} : {actor: row.actor}),
    ...(detail && Object.keys(detail).length > 0 ? {detail} : {}),
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at,
  };
}

function isAuditEventName(value: string): value is AuditEventName {
  return (auditEvents as readonly string[]).includes(value);
}
