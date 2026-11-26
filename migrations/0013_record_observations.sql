ALTER TABLE agus_payments ADD COLUMN observed_at timestamptz;
ALTER TABLE agus_source_accounts ADD COLUMN observed_at timestamptz;
-- Historical rows remain unknown; do not fabricate freshness during migration.
ALTER TABLE agus_source_accounts ALTER COLUMN observed_at SET DEFAULT now();
