CREATE TABLE agus_users (
 id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
 email_verified boolean NOT NULL DEFAULT false, image text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 role text NOT NULL DEFAULT 'consumer' CHECK(role IN ('consumer','support','operations')),
 two_factor_enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE agus_sessions (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES agus_users(id) ON DELETE CASCADE,
 token text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 ip_address text, user_agent text
);
CREATE INDEX agus_sessions_owner ON agus_sessions(user_id,expires_at);
CREATE TABLE agus_auth_accounts (
 id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL,
 user_id text NOT NULL REFERENCES agus_users(id) ON DELETE CASCADE,
 access_token text, refresh_token text, id_token text, access_token_expires_at timestamptz,
 refresh_token_expires_at timestamptz, scope text, password text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider_id,account_id)
);
CREATE TABLE agus_verifications (
 id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agus_verification_identifier ON agus_verifications(identifier);
CREATE TABLE agus_two_factor (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES agus_users(id) ON DELETE CASCADE,
 secret text NOT NULL, backup_codes text NOT NULL, verified boolean NOT NULL DEFAULT true,
 failed_verification_count integer NOT NULL DEFAULT 0, locked_until timestamptz
);
CREATE INDEX agus_two_factor_user ON agus_two_factor(user_id);
CREATE TABLE agus_rate_limit (id text PRIMARY KEY, key text NOT NULL UNIQUE, count integer NOT NULL, last_request bigint NOT NULL);
CREATE TABLE agus_invitations (email text PRIMARY KEY, expires_at timestamptz NOT NULL, consumed_at timestamptz, created_by text NOT NULL);
CREATE TABLE agus_step_up (
 id text PRIMARY KEY, owner text NOT NULL REFERENCES agus_users(id), session_id text NOT NULL REFERENCES agus_sessions(id) ON DELETE CASCADE,
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'), action text NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agus_secret_envelopes (
 owner text NOT NULL, id text NOT NULL, purpose text NOT NULL, envelope jsonb NOT NULL,
 PRIMARY KEY(owner,id)
);
CREATE TABLE agus_jobs (
 id text PRIMARY KEY, owner text NOT NULL, kind text NOT NULL, effect_key text NOT NULL UNIQUE,
 payload jsonb NOT NULL, state text NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','leased','done','dead')),
 available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, lease_owner text,
 fence bigint NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0, last_error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agus_jobs_claim ON agus_jobs(state,available_at,lease_until);
CREATE TABLE agus_inbox (
 provider text NOT NULL, environment text NOT NULL, event_id text NOT NULL, request_hash text NOT NULL,
 envelope jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
 PRIMARY KEY(provider,environment,event_id)
);
CREATE TABLE agus_notifications (
 owner text NOT NULL, id text NOT NULL, effect_key text NOT NULL UNIQUE, resource_type text NOT NULL, resource_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz, PRIMARY KEY(owner,id)
);
CREATE TABLE agus_devices (
 owner text NOT NULL REFERENCES agus_users(id), id text NOT NULL, session_id text NOT NULL REFERENCES agus_sessions(id) ON DELETE CASCADE,
 push_envelope jsonb, platform text NOT NULL CHECK(platform IN ('android','ios','web')),
 push_state text NOT NULL CHECK(push_state IN ('denied','registered','invalid','unavailable')),
 preferences jsonb NOT NULL DEFAULT '{"inApp":true,"push":false}', PRIMARY KEY(owner,id)
);
CREATE TABLE agus_audit (
 id text PRIMARY KEY, owner text NOT NULL, resource_type text NOT NULL, resource_id text NOT NULL,
 action text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agus_audit_resource ON agus_audit(owner,resource_type,resource_id,created_at);
CREATE TABLE agus_legacy_archive (id text PRIMARY KEY, revision integer NOT NULL, payload jsonb NOT NULL, checksum text NOT NULL, archived_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE agus_legacy_batches (owner text NOT NULL, id text NOT NULL, status text NOT NULL, revision integer NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(owner,id));
CREATE TABLE agus_legacy_payments (owner text NOT NULL, batch_id text NOT NULL, id text NOT NULL, reference text NOT NULL UNIQUE, status text NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(owner,id), FOREIGN KEY(owner,batch_id) REFERENCES agus_legacy_batches(owner,id));
CREATE INDEX agus_legacy_reconcile ON agus_legacy_payments(status,owner,id);
CREATE TABLE agus_legacy_authority (owner text NOT NULL, batch_id text NOT NULL, digest text NOT NULL, consumed_at timestamptz NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(owner,batch_id), FOREIGN KEY(owner,batch_id) REFERENCES agus_legacy_batches(owner,id));
