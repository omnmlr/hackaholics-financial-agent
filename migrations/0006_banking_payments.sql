CREATE TABLE agus_institutions (id text PRIMARY KEY, legal_name text NOT NULL, provider_ids jsonb NOT NULL DEFAULT '{}');
INSERT INTO agus_institutions(id,legal_name) VALUES
 ('opay','OPay'),('palmpay','PalmPay'),('moniepoint','Moniepoint'),('mtn-momo','MTN MoMo PSB'),('kuda','Kuda'),
 ('gtbank','Guaranty Trust Bank'),('access','Access Bank'),('zenith','Zenith Bank'),('firstbank','First Bank of Nigeria'),('uba','United Bank for Africa'),('union','Union Bank'),
 ('wema','Wema Bank / ALAT'),('fcmb','First City Monument Bank'),('fidelity','Fidelity Bank'),('sterling','Sterling Bank'),('stanbic','Stanbic IBTC'),('ecobank','Ecobank Nigeria'),
 ('jaiz','Jaiz Bank'),('providus','Providus Bank'),('polaris','Polaris Bank'),('keystone','Keystone Bank'),('standard-chartered','Standard Chartered Nigeria'),('vfd','VFD Microfinance Bank');
CREATE TABLE agus_institution_capabilities (
 institution text NOT NULL REFERENCES agus_institutions(id), operation text NOT NULL,
 environment text NOT NULL DEFAULT 'live', accepted boolean NOT NULL DEFAULT false,
 provider text, evidence jsonb NOT NULL DEFAULT '[]', observed_at timestamptz,
 PRIMARY KEY(institution,operation,environment), CHECK(NOT accepted OR (provider IS NOT NULL AND jsonb_array_length(evidence)>0 AND observed_at IS NOT NULL))
);
INSERT INTO agus_institution_capabilities(institution,operation)
 SELECT id,operation FROM agus_institutions CROSS JOIN unnest(ARRAY['link','accounts','balances','history','reauthorize','revoke','source_payment']) AS operation;
CREATE TABLE agus_connections (
 owner text NOT NULL REFERENCES agus_users(id), id text NOT NULL, provider text NOT NULL, environment text NOT NULL,
 institution text NOT NULL REFERENCES agus_institutions(id), state_hash text NOT NULL UNIQUE, state_expires_at timestamptz NOT NULL,
 callback_consumed_at timestamptz, status text NOT NULL, revision integer NOT NULL DEFAULT 0,
 credential_envelope jsonb, revoked_at timestamptz, provider_revocation_pending boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner,id)
);
CREATE TABLE agus_grants (
 owner text NOT NULL, id text NOT NULL, connection_id text NOT NULL, scopes jsonb NOT NULL,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, revision integer NOT NULL DEFAULT 0,
 PRIMARY KEY(owner,id), FOREIGN KEY(owner,connection_id) REFERENCES agus_connections(owner,id)
);
CREATE TABLE agus_source_accounts (
 owner text NOT NULL, id text NOT NULL, connection_id text NOT NULL, grant_id text NOT NULL,
 provider_account_id text NOT NULL, currency text NOT NULL, scale integer NOT NULL,
 display_name text NOT NULL, simulated boolean NOT NULL, sync_cursor text, history_complete boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 0, PRIMARY KEY(owner,id), UNIQUE(owner,connection_id,provider_account_id),
 FOREIGN KEY(owner,connection_id) REFERENCES agus_connections(owner,id), FOREIGN KEY(owner,grant_id) REFERENCES agus_grants(owner,id)
);
CREATE TABLE agus_balance_snapshots (
 owner text NOT NULL, id text NOT NULL, account_id text NOT NULL, available_atoms text NOT NULL CHECK(available_atoms ~ '^[0-9]+$'),
 ledger_atoms text NOT NULL CHECK(ledger_atoms ~ '^[0-9]+$'), observed_at timestamptz NOT NULL, provider text NOT NULL, environment text NOT NULL,
 simulated boolean NOT NULL, PRIMARY KEY(owner,id), FOREIGN KEY(owner,account_id) REFERENCES agus_source_accounts(owner,id)
);
CREATE TABLE agus_bank_transactions (
 owner text NOT NULL, id text NOT NULL, account_id text NOT NULL, provider_id text NOT NULL, revision integer NOT NULL,
 amount_atoms text NOT NULL CHECK(amount_atoms ~ '^[0-9]+$'), direction text NOT NULL CHECK(direction IN ('credit','debit')),
 status text NOT NULL, occurred_at timestamptz NOT NULL, observed_at timestamptz NOT NULL,
 provider text NOT NULL, environment text NOT NULL, simulated boolean NOT NULL, description text NOT NULL,
 PRIMARY KEY(owner,id), UNIQUE(owner,account_id,provider_id), FOREIGN KEY(owner,account_id) REFERENCES agus_source_accounts(owner,id)
);
CREATE TABLE agus_beneficiaries (
 owner text NOT NULL REFERENCES agus_users(id), id text NOT NULL, bank_code text NOT NULL, account_envelope jsonb NOT NULL,
 identity_hash text NOT NULL, verified_name text NOT NULL, provider text NOT NULL, environment text NOT NULL,
 verified_at timestamptz NOT NULL, simulated boolean NOT NULL, PRIMARY KEY(owner,id)
);
CREATE TABLE agus_payments (
 owner text NOT NULL, id text NOT NULL, source_account_id text NOT NULL, grant_id text NOT NULL, beneficiary_id text NOT NULL,
 provider text NOT NULL, environment text NOT NULL, amount_atoms text NOT NULL CHECK(amount_atoms ~ '^[1-9][0-9]*$'),
 currency text NOT NULL, scale integer NOT NULL, fee_atoms text NOT NULL CHECK(fee_atoms ~ '^[0-9]+$'),
 fee_quote_version text NOT NULL, expires_at timestamptz NOT NULL, grant_revision integer NOT NULL,
 revision integer NOT NULL DEFAULT 0, status text NOT NULL, instruction_hash text NOT NULL,
 idempotency_key text NOT NULL, request_hash text NOT NULL, provider_reference text NOT NULL UNIQUE,
 instruction jsonb NOT NULL, simulated boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner,id), UNIQUE(owner,idempotency_key),
 FOREIGN KEY(owner,source_account_id) REFERENCES agus_source_accounts(owner,id),
 FOREIGN KEY(owner,grant_id) REFERENCES agus_grants(owner,id), FOREIGN KEY(owner,beneficiary_id) REFERENCES agus_beneficiaries(owner,id)
);
CREATE INDEX agus_payment_reconciliation ON agus_payments(status,provider,environment,id);
CREATE TABLE agus_payment_attempts (
 owner text NOT NULL, payment_id text NOT NULL, id text NOT NULL UNIQUE, state text NOT NULL,
 claimed_at timestamptz NOT NULL DEFAULT now(), observed_at timestamptz, provider_status text,
 PRIMARY KEY(owner,payment_id), FOREIGN KEY(owner,payment_id) REFERENCES agus_payments(owner,id)
);
CREATE TABLE agus_receipts (
 owner text NOT NULL, id text NOT NULL, payment_id text NOT NULL, revision integer NOT NULL,
 status text NOT NULL, evidence_kind text NOT NULL, observed_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL,
 PRIMARY KEY(owner,id), UNIQUE(owner,payment_id,revision), FOREIGN KEY(owner,payment_id) REFERENCES agus_payments(owner,id)
);
CREATE TABLE agus_disputes (
 owner text NOT NULL, id text NOT NULL, payment_id text NOT NULL, reason text NOT NULL, status text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner,id), FOREIGN KEY(owner,payment_id) REFERENCES agus_payments(owner,id)
);
CREATE TABLE agus_test_effects (
 reference text PRIMARY KEY, request_hash text NOT NULL, submissions integer NOT NULL DEFAULT 1,
 scenario text NOT NULL, status text NOT NULL, observed_reads integer NOT NULL DEFAULT 0
);
