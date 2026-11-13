CREATE TABLE IF NOT EXISTS agus_web_invoices (
  owner text NOT NULL,
  id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner,id)
);
CREATE TABLE IF NOT EXISTS agus_web_requests (
  owner text NOT NULL,
  id text NOT NULL,
  invoice_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner,id),
  FOREIGN KEY(owner,invoice_id) REFERENCES agus_web_invoices(owner,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS agus_web_settlement_once
  ON agus_web_requests ((payload->'evidence'->>'source'), (payload->'evidence'->>'transactionId'))
  WHERE payload->>'state'='confirmed';
CREATE TABLE IF NOT EXISTS agus_web_events (
  owner text NOT NULL,
  id text NOT NULL,
  payload jsonb NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner,id)
);
CREATE INDEX IF NOT EXISTS agus_web_events_owner_at ON agus_web_events(owner,at DESC);
