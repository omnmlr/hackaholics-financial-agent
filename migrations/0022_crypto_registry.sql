CREATE TABLE agus_crypto_wallets (
  owner text NOT NULL REFERENCES agus_users(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  cluster text NOT NULL CHECK (cluster IN ('devnet','mainnet-beta')),
  address text NOT NULL,
  label text NOT NULL,
  declared boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  PRIMARY KEY (owner, id),
  UNIQUE (owner, cluster, address)
);
CREATE TABLE agus_crypto_routes (
  owner text NOT NULL,
  id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  provider text NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (owner, id),
  UNIQUE (owner, wallet_id, provider),
  FOREIGN KEY (owner, wallet_id) REFERENCES agus_crypto_wallets(owner, id) ON DELETE CASCADE
);
CREATE TABLE agus_crypto_challenges (
  owner text NOT NULL REFERENCES agus_users(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  session_id text NOT NULL,
  cluster text NOT NULL,
  address text NOT NULL,
  provider text NOT NULL,
  message text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  PRIMARY KEY (owner, id)
);
CREATE TABLE agus_crypto_operations (
  owner text NOT NULL REFERENCES agus_users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  key text NOT NULL,
  digest text NOT NULL,
  response jsonb,
  PRIMARY KEY (owner, kind, key)
);
CREATE TABLE agus_crypto_balances (
  owner text NOT NULL,
  wallet_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('sol','token')),
  observed_at timestamptz NOT NULL,
  slot bigint NOT NULL,
  value jsonb NOT NULL,
  PRIMARY KEY (owner, wallet_id, kind),
  FOREIGN KEY (owner, wallet_id) REFERENCES agus_crypto_wallets(owner, id) ON DELETE CASCADE
);
CREATE TABLE agus_crypto_token_accounts (
  owner text NOT NULL,
  wallet_id uuid NOT NULL,
  address text NOT NULL,
  PRIMARY KEY (owner, wallet_id, address),
  FOREIGN KEY (owner, wallet_id) REFERENCES agus_crypto_wallets(owner, id) ON DELETE CASCADE
);
