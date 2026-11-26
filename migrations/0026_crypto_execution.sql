CREATE TABLE agus_crypto_reviews (
  owner text NOT NULL,
  id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  fingerprint text NOT NULL,
  review jsonb NOT NULL,
  PRIMARY KEY(owner,id),
  FOREIGN KEY(owner,wallet_id) REFERENCES agus_crypto_wallets(owner,id) ON DELETE CASCADE
);
CREATE TABLE agus_crypto_attempts (
  owner text NOT NULL,
  id uuid NOT NULL,
  review_id uuid NOT NULL,
  fingerprint text NOT NULL,
  state text NOT NULL CHECK (state IN ('ready','handoff','declined','pending','unknown','failed','expired','finalized')),
  signature text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  receipt_id uuid,
  PRIMARY KEY(owner,id),
  UNIQUE(owner,review_id),
  FOREIGN KEY(owner,review_id) REFERENCES agus_crypto_reviews(owner,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX agus_crypto_attempts_active ON agus_crypto_attempts(owner,fingerprint)
 WHERE state IN ('ready','handoff','pending','unknown');
CREATE INDEX agus_crypto_attempts_due ON agus_crypto_attempts(checked_at) WHERE state IN ('ready','handoff','pending','unknown');
CREATE TABLE agus_crypto_receipts (
  owner text NOT NULL,
  id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  cluster text NOT NULL,
  signature text NOT NULL,
  receipt jsonb NOT NULL,
  PRIMARY KEY(owner,id),
  UNIQUE(owner,attempt_id),
  UNIQUE(cluster,signature),
  FOREIGN KEY(owner,attempt_id) REFERENCES agus_crypto_attempts(owner,id) ON DELETE CASCADE
);
