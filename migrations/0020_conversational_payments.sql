CREATE TABLE IF NOT EXISTS agus_web_payment_plans (
  owner text NOT NULL,
  id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS agus_web_outgoing_transaction_once
  ON agus_web_payment_plans ((payload->'evidence'->>'transactionId'))
  WHERE payload->>'state'='confirmed';
CREATE TABLE IF NOT EXISTS agus_web_contacts (
  owner text NOT NULL,
  id text NOT NULL,
  label text NOT NULL,
  asset text NOT NULL,
  address text NOT NULL,
  network text NOT NULL CHECK(network='testnet'),
  PRIMARY KEY(owner,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS agus_web_contact_label_asset
  ON agus_web_contacts(owner,lower(label),asset);
