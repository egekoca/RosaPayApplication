-- Who did what, and when. The table is append-only and deliberately holds no
-- key material, no raw authorization payloads and no customer identifiers
-- beyond the Stellar addresses that are already public on the ledger.
CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  event TEXT NOT NULL,
  subject TEXT NOT NULL,
  actor TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_events_subject_idx ON audit_events(subject, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_event_idx ON audit_events(event, occurred_at DESC);
