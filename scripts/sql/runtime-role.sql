-- Execute as the schema owner AFTER migrations, never using application credentials.
-- Create a separately managed LOGIN and grant membership in this NOLOGIN role.
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='agus_runtime') THEN CREATE ROLE agus_runtime NOLOGIN; END IF; END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO agus_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO agus_runtime;
REVOKE INSERT,UPDATE,DELETE ON agus_migrations,agus_legacy_archive,agus_institutions,agus_institution_capabilities,agus_invitations,agus_fixture_escrow_authorities FROM agus_runtime;
REVOKE UPDATE,DELETE ON agus_legacy_authority FROM agus_runtime;
REVOKE UPDATE,DELETE ON agus_p2p_events,agus_request_chain_observations FROM agus_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON agus_crypto_chain_events,agus_crypto_wallet_events,agus_crypto_receipts,agus_crypto_reviews,agus_audit FROM agus_runtime;
GRANT UPDATE(consumed_at) ON agus_invitations TO agus_runtime;
