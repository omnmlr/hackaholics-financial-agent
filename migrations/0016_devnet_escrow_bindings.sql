CREATE TABLE agus_devnet_escrow_bindings (
 order_id text PRIMARY KEY REFERENCES agus_p2p_orders(id), protocol_digest text NOT NULL UNIQUE,
 terms jsonb NOT NULL, revision integer NOT NULL DEFAULT 0, funding_signature text UNIQUE,
 funding_observation jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
