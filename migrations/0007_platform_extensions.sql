ALTER TABLE agus_rate_limit ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE agus_connections ADD COLUMN state_envelope jsonb;
CREATE TABLE agus_api_operations (
 owner text NOT NULL, kind text NOT NULL, idempotency_key text NOT NULL, request_hash text NOT NULL,
 resource_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner,kind,idempotency_key)
);
