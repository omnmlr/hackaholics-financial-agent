CREATE TABLE agus_crypto_request_records (
  owner text NOT NULL,
  id text NOT NULL,
  wallet_id uuid NOT NULL,
  invoice jsonb,
  checked_at timestamptz,
  observation text CHECK (observation IN ('needs_review','settled')),
  receipt_id uuid,
  receipt jsonb,
  PRIMARY KEY (owner,id),
  UNIQUE (owner,receipt_id),
  FOREIGN KEY (owner,id) REFERENCES agus_payment_requests(owner,id) ON DELETE CASCADE,
  FOREIGN KEY (owner,wallet_id) REFERENCES agus_crypto_wallets(owner,id) ON DELETE CASCADE
);
