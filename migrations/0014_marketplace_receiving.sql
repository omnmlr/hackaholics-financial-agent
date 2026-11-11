ALTER TABLE agus_p2p_orders ADD COLUMN buyer text REFERENCES agus_users(id);
ALTER TABLE agus_p2p_orders ADD COLUMN seller text REFERENCES agus_users(id);
ALTER TABLE agus_p2p_orders ADD COLUMN capacity_restored boolean NOT NULL DEFAULT false;
UPDATE agus_p2p_orders o SET buyer=CASE WHEN f.side='sell' THEN o.owner ELSE o.counterparty END,
 seller=CASE WHEN f.side='sell' THEN o.counterparty ELSE o.owner END,
 capacity_restored=o.state IN ('cancelled','expired') FROM agus_p2p_offers f WHERE f.id=o.offer_id;
ALTER TABLE agus_p2p_orders ALTER COLUMN buyer SET NOT NULL;
ALTER TABLE agus_p2p_orders ALTER COLUMN seller SET NOT NULL;
CREATE TABLE agus_p2p_events (
 id text PRIMARY KEY, order_id text NOT NULL REFERENCES agus_p2p_orders(id), actor text NOT NULL,
 action text NOT NULL, revision integer NOT NULL, instruction_hash text NOT NULL, at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(order_id,revision)
);
CREATE TABLE agus_fixture_escrow_authorities (
 id integer PRIMARY KEY CHECK(id=1), verifier text NOT NULL REFERENCES agus_users(id), arbitrators jsonb NOT NULL
);
CREATE TABLE agus_fixture_token_balances (
 owner text PRIMARY KEY REFERENCES agus_users(id), atoms numeric(78,0) NOT NULL DEFAULT 1000000000 CHECK(atoms>=0)
);
CREATE TABLE agus_fixture_escrows (
 order_id text PRIMARY KEY REFERENCES agus_p2p_orders(id), amount_atoms numeric(78,0) NOT NULL CHECK(amount_atoms>0),
 verifier text NOT NULL REFERENCES agus_users(id), arbitrators jsonb NOT NULL, state text NOT NULL DEFAULT 'funded',
 fiat_verifier text REFERENCES agus_users(id), cancellation_votes jsonb NOT NULL DEFAULT '[]',
 arbitration_votes jsonb NOT NULL DEFAULT '[]', arbitration_choice text, prior_state text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agus_usd_customers (
 owner text PRIMARY KEY REFERENCES agus_users(id), id text NOT NULL UNIQUE, revision integer NOT NULL DEFAULT 0,
 eligibility text NOT NULL, receiving_status text NOT NULL, details_envelope jsonb NOT NULL,
 provider text NOT NULL CHECK(provider='fixture'), environment text NOT NULL CHECK(environment='fixture'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agus_usd_incoming (
 owner text NOT NULL REFERENCES agus_users(id), id text PRIMARY KEY, provider_reference text NOT NULL UNIQUE,
 amount_atoms numeric(78,0) NOT NULL CHECK(amount_atoms>0), revision integer NOT NULL DEFAULT 0,
 status text NOT NULL CHECK(status IN ('received','conversion_claimed','return_claimed','returned')),
 purpose text NOT NULL CHECK(purpose IN ('freelance','salary')), observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agus_usd_quotes (
 owner text NOT NULL REFERENCES agus_users(id), id text PRIMARY KEY, incoming_id text NOT NULL REFERENCES agus_usd_incoming(id),
 incoming_revision integer NOT NULL, instruction jsonb NOT NULL, instruction_hash text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agus_usd_conversions (
 owner text NOT NULL REFERENCES agus_users(id), id text PRIMARY KEY, incoming_id text NOT NULL UNIQUE REFERENCES agus_usd_incoming(id),
 instruction jsonb NOT NULL, instruction_hash text NOT NULL, revision integer NOT NULL DEFAULT 0,
 conversion_status text NOT NULL DEFAULT 'pending', delivery_status text NOT NULL DEFAULT 'not_started',
 payout_status text NOT NULL DEFAULT 'not_started', return_status text NOT NULL DEFAULT 'not_started',
 observed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agus_usd_effects (
 id text PRIMARY KEY, resource_id text NOT NULL, kind text NOT NULL, request_hash text NOT NULL,
 status text NOT NULL, simulated boolean NOT NULL DEFAULT true CHECK(simulated),
 submissions integer NOT NULL DEFAULT 1 CHECK(submissions=1), observed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(resource_id,kind)
);
