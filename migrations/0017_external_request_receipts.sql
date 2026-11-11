CREATE TABLE agus_request_chain_observations (
 signature text PRIMARY KEY, request_id text NOT NULL REFERENCES agus_payment_requests(id),
 kind text NOT NULL CHECK(kind IN ('primary','additional')), slot bigint NOT NULL CHECK(slot>=0),
 sender text NOT NULL, amount_atoms text NOT NULL, asset text NOT NULL, mint text,
 block_time timestamptz, observed_at timestamptz NOT NULL DEFAULT now(),
 evidence jsonb NOT NULL
);
CREATE UNIQUE INDEX agus_request_primary_observation ON agus_request_chain_observations(request_id) WHERE kind='primary';
CREATE INDEX agus_request_observations_page ON agus_request_chain_observations(request_id,signature);
