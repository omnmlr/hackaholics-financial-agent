CREATE TABLE agus_financial_accounts (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  tenant_id text NOT NULL DEFAULT 'default',
  institution_code text NOT NULL,
  institution_name text NOT NULL,
  institution_type text NOT NULL,
  account_number_masked text NOT NULL,
  account_name text NOT NULL,
  currency text NOT NULL CHECK (currency IN ('NGN','USD','USDC','EUR','GBP')),
  account_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb
);
CREATE INDEX agus_accounts_owner ON agus_financial_accounts(tenant_id, owner_id);

CREATE TABLE agus_statement_imports (
  id text PRIMARY KEY,
  file_hash text NOT NULL,
  file_name text NOT NULL,
  account_id text NOT NULL REFERENCES agus_financial_accounts(id) ON DELETE CASCADE,
  owner_id text NOT NULL,
  tenant_id text NOT NULL DEFAULT 'default',
  format text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  total_rows integer NOT NULL,
  imported_count integer NOT NULL,
  duplicate_count integer NOT NULL,
  skipped_count integer NOT NULL,
  opening_balance_atoms text,
  closing_balance_atoms text,
  as_of timestamptz,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE UNIQUE INDEX agus_statement_imports_file ON agus_statement_imports(account_id, file_hash);
CREATE INDEX agus_statement_imports_owner ON agus_statement_imports(tenant_id, owner_id, account_id);

CREATE TABLE agus_financial_transactions (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES agus_financial_accounts(id) ON DELETE CASCADE,
  owner_id text NOT NULL,
  tenant_id text NOT NULL DEFAULT 'default',
  posted_at timestamptz NOT NULL,
  value_at timestamptz,
  amount_atoms text NOT NULL,
  currency text NOT NULL CHECK (currency IN ('NGN','USD','USDC','EUR','GBP')),
  scale integer NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','posted','reversed','corrected','duplicate')),
  reversal_of_id text,
  raw_description text NOT NULL,
  clean_description text NOT NULL,
  counterparty jsonb NOT NULL DEFAULT '{}'::jsonb,
  category text NOT NULL,
  reference text,
  statement_balance_atoms text,
  fingerprint text NOT NULL,
  internal_transfer jsonb,
  user_override jsonb,
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX agus_transactions_fingerprint ON agus_financial_transactions(account_id, fingerprint);
CREATE INDEX agus_transactions_owner_posted ON agus_financial_transactions(tenant_id, owner_id, posted_at DESC);
CREATE INDEX agus_transactions_account_posted ON agus_financial_transactions(account_id, posted_at DESC);

CREATE TABLE agus_account_balance_observations (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES agus_financial_accounts(id) ON DELETE CASCADE,
  owner_id text NOT NULL,
  tenant_id text NOT NULL DEFAULT 'default',
  currency text NOT NULL,
  scale integer NOT NULL,
  available_atoms text,
  current_atoms text,
  ledger_atoms text,
  as_of timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('statement_closing_balance','statement_opening_balance','reconciled_verified','sync','manual','unverified_estimate','reconciled_ledger')),
  confidence text NOT NULL CHECK (confidence IN ('verified','reconstructed_estimate','unverified')),
  is_stale boolean NOT NULL DEFAULT false,
  staleness_reason text,
  evidence_provenance jsonb,
  observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agus_balance_obs_account ON agus_account_balance_observations(account_id, as_of DESC);
