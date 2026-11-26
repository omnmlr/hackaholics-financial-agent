CREATE TABLE agus_crypto_conversations (
  owner text NOT NULL REFERENCES agus_users(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  scope jsonb NOT NULL,
  PRIMARY KEY(owner,id)
);
CREATE TABLE agus_crypto_turns (
  owner text NOT NULL,
  conversation_id uuid NOT NULL,
  id uuid NOT NULL,
  client_turn_id uuid NOT NULL,
  request_digest text NOT NULL,
  lease_until timestamptz NOT NULL,
  result jsonb,
  PRIMARY KEY (owner,client_turn_id),
  FOREIGN KEY (owner,conversation_id) REFERENCES agus_crypto_conversations(owner,id) ON DELETE CASCADE
);
CREATE INDEX agus_crypto_turns_recent ON agus_crypto_turns(owner,lease_until);
CREATE TABLE agus_crypto_ai_budgets (
  bucket text NOT NULL,
  utc_day date NOT NULL,
  used int NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket,utc_day)
);
