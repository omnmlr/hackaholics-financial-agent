CREATE TABLE agus_crypto_chain_events (
  cluster text NOT NULL,
  signature text NOT NULL,
  slot bigint NOT NULL,
  block_time timestamptz,
  event jsonb NOT NULL,
  PRIMARY KEY (cluster,signature)
);
CREATE TABLE agus_crypto_wallet_events (
  owner text NOT NULL,
  wallet_id uuid NOT NULL,
  cluster text NOT NULL,
  signature text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner,wallet_id,cluster,signature),
  FOREIGN KEY (owner,wallet_id) REFERENCES agus_crypto_wallets(owner,id) ON DELETE CASCADE,
  FOREIGN KEY (cluster,signature) REFERENCES agus_crypto_chain_events(cluster,signature)
);
CREATE TABLE agus_crypto_feeds (
  owner text NOT NULL,
  wallet_id uuid NOT NULL,
  address text NOT NULL,
  head text,
  candidate_head text,
  continuation text,
  observed_at timestamptz,
  slot bigint,
  PRIMARY KEY (owner,wallet_id,address),
  FOREIGN KEY (owner,wallet_id) REFERENCES agus_crypto_wallets(owner,id) ON DELETE CASCADE
);
CREATE TABLE agus_crypto_scan_status (
  owner text NOT NULL,
  wallet_id uuid NOT NULL,
  checked_at timestamptz,
  claim_id uuid NOT NULL,
  claimed_until timestamptz NOT NULL DEFAULT now(),
  coverage jsonb,
  PRIMARY KEY (owner,wallet_id),
  FOREIGN KEY (owner,wallet_id) REFERENCES agus_crypto_wallets(owner,id) ON DELETE CASCADE
);
