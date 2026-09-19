export const auditEvents = [
  'payment_intent_created',
  'payment_authorized',
  'payment_submitted',
  'merchant_profile_created',
  'merchant_registered_on_chain',
  'wallet_provisioned',
  'relayer_signed_settlement',
  'countersignature_requested',
  'countersignature_supplied',
] as const;

export type AuditEventName = (typeof auditEvents)[number];

export type AuditEvent = {
  event: AuditEventName;
  /** What the event is about: an intent ID, a profile ID, a wallet address. */
  subject: string;
  /** The Stellar address that acted, when one is known. */
  actor?: string;
  detail?: Record<string, string | number | boolean>;
  occurredAt: string;
};

export interface AuditLogRepository {
  append(event: AuditEvent): Promise<void>;
  listForSubject(subject: string, limit: number): Promise<AuditEvent[]>;
}

export class InMemoryAuditLog implements AuditLogRepository {
  private readonly events: AuditEvent[] = [];

  async append(event: AuditEvent) {
    this.events.push(event);
  }

  async listForSubject(subject: string, limit: number) {
    return this.events
      .filter(event => event.subject === subject)
      .slice(-limit)
      .reverse();
  }
}

/**
 * Records what happened without ever recording how it was authorized. A payment
 * trail has to survive review, so it holds addresses and identifiers that are
 * already public on the ledger and nothing else.
 */
export class AuditLog {
  constructor(private readonly repository: AuditLogRepository) {}

  async record(
    event: AuditEventName,
    subject: string,
    options: {actor?: string; detail?: Record<string, string | number | boolean>} = {},
  ): Promise<void> {
    if (!subject.trim()) throw new Error('An audit event needs a subject');
    await this.repository.append({
      event,
      subject,
      ...(options.actor ? {actor: options.actor} : {}),
      ...(options.detail ? {detail: redact(options.detail)} : {}),
      occurredAt: new Date().toISOString(),
    });
  }

  history(subject: string, limit = 50): Promise<AuditEvent[]> {
    return this.repository.listForSubject(subject, limit);
  }
}

// Public keys and addresses are fine; anything that names a secret is not.
const forbidden = /secret|seed|password|signature|authorization|private/i;

/** A detail that names a secret is dropped rather than stored and masked later. */
function redact(detail: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(detail).filter(([key]) => !forbidden.test(key)));
}
