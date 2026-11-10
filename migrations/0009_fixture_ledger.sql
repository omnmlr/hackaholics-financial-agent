ALTER TABLE agus_test_effects ADD COLUMN instruction jsonb NOT NULL DEFAULT '{}';
ALTER TABLE agus_test_effects ADD COLUMN reserved boolean NOT NULL DEFAULT false;
ALTER TABLE agus_test_effects ADD COLUMN settled boolean NOT NULL DEFAULT false;
ALTER TABLE agus_test_effects ADD COLUMN reversed boolean NOT NULL DEFAULT false;
CREATE TABLE agus_test_balances (account_id text PRIMARY KEY,ledger_atoms numeric(78,0) NOT NULL DEFAULT 50050000,reserved_atoms numeric(78,0) NOT NULL DEFAULT 50000,CHECK(ledger_atoms>=reserved_atoms AND reserved_atoms>=0));
