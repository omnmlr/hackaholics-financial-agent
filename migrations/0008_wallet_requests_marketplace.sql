CREATE TABLE agus_wallets (
 owner text NOT NULL REFERENCES agus_users(id), wallet text NOT NULL, network text NOT NULL CHECK(network='devnet'),
 challenge text NOT NULL, expires_at timestamptz NOT NULL, verified_at timestamptz,
 PRIMARY KEY(owner,wallet)
);
CREATE TABLE agus_payment_requests (
 owner text NOT NULL REFERENCES agus_users(id), id text NOT NULL, reference text NOT NULL UNIQUE,
 recipient text NOT NULL, asset text NOT NULL, mint text, amount_atoms text NOT NULL, scale integer NOT NULL,
 expires_at timestamptz NOT NULL, status text NOT NULL, revision integer NOT NULL DEFAULT 0,
 settlement_signature text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner,id)
);
CREATE TABLE agus_trader_eligibility (owner text PRIMARY KEY REFERENCES agus_users(id), environment text NOT NULL CHECK(environment='fixture'), eligible boolean NOT NULL DEFAULT false, evidence text NOT NULL);
CREATE TABLE agus_p2p_offers (
 owner text NOT NULL REFERENCES agus_users(id), id text NOT NULL UNIQUE, side text NOT NULL CHECK(side IN ('buy','sell')),
 available_atoms numeric(78,0) NOT NULL CHECK(available_atoms>=0), minimum_atoms numeric(78,0) NOT NULL CHECK(minimum_atoms>0), maximum_atoms numeric(78,0) NOT NULL,
 rate_numerator numeric(78,0) NOT NULL CHECK(rate_numerator>0), rate_denominator numeric(78,0) NOT NULL CHECK(rate_denominator>0),
 payment_method text NOT NULL CHECK(payment_method='bank-transfer-simulated'), expires_at timestamptz NOT NULL,
 revision integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'open', environment text NOT NULL CHECK(environment='fixture'),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner,id), CHECK(maximum_atoms>=minimum_atoms)
);
CREATE TABLE agus_p2p_quotes (
 owner text NOT NULL REFERENCES agus_users(id), id text NOT NULL, offer_id text NOT NULL REFERENCES agus_p2p_offers(id),
 offer_revision integer NOT NULL, token_atoms text NOT NULL, fiat_atoms text NOT NULL, expires_at timestamptz NOT NULL,
 instruction_hash text NOT NULL, instruction jsonb NOT NULL, PRIMARY KEY(owner,id)
);
CREATE TABLE agus_p2p_orders (
 owner text NOT NULL REFERENCES agus_users(id), id text NOT NULL UNIQUE, counterparty text NOT NULL REFERENCES agus_users(id),
 offer_id text NOT NULL REFERENCES agus_p2p_offers(id), quote_id text NOT NULL, token_atoms text NOT NULL, fiat_atoms text NOT NULL,
 state text NOT NULL, revision integer NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL,
 instruction_hash text NOT NULL, environment text NOT NULL CHECK(environment='fixture'), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner,id), FOREIGN KEY(owner,quote_id) REFERENCES agus_p2p_quotes(owner,id), UNIQUE(owner,quote_id)
);
CREATE TABLE agus_p2p_disputes (
 owner text NOT NULL, id text NOT NULL, order_id text NOT NULL REFERENCES agus_p2p_orders(id), reason text NOT NULL, state text NOT NULL DEFAULT 'open',
 PRIMARY KEY(owner,id)
);
