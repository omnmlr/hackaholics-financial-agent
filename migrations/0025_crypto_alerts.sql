CREATE TABLE agus_crypto_alert_rules (
  owner text NOT NULL,
  id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  minimum jsonb,
  enabled boolean NOT NULL DEFAULT true,
  activated_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  PRIMARY KEY(owner,id),
  FOREIGN KEY (owner,wallet_id) REFERENCES agus_crypto_wallets(owner,id) ON DELETE CASCADE
);
CREATE INDEX agus_crypto_alert_rules_due ON agus_crypto_alert_rules(checked_at) WHERE enabled;
CREATE TABLE agus_crypto_alert_observations (
  owner text NOT NULL,
  rule_id uuid NOT NULL,
  signature text NOT NULL,
  PRIMARY KEY (owner,rule_id,signature),
  FOREIGN KEY (owner,rule_id) REFERENCES agus_crypto_alert_rules(owner,id) ON DELETE CASCADE
);
CREATE TABLE agus_crypto_alerts (
  owner text NOT NULL,
  id uuid NOT NULL,
  rule_id uuid NOT NULL,
  cluster text NOT NULL,
  signature text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  PRIMARY KEY (owner,id),
  UNIQUE (owner,rule_id,cluster,signature),
  FOREIGN KEY (owner,rule_id) REFERENCES agus_crypto_alert_rules(owner,id) ON DELETE CASCADE,
  FOREIGN KEY (cluster,signature) REFERENCES agus_crypto_chain_events(cluster,signature)
);
