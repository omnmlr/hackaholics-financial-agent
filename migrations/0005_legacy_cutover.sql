ALTER TABLE agus_legacy_batches ADD COLUMN ordinal integer NOT NULL DEFAULT 0;
ALTER TABLE agus_legacy_payments ADD COLUMN ordinal integer NOT NULL DEFAULT 0;
CREATE TABLE agus_legacy_audit (id text PRIMARY KEY, actor text NOT NULL, batch_id text, ordinal integer NOT NULL, payload jsonb NOT NULL);
