-- ============================================================================
-- AGUS Crypto Least-Privilege Role Hardening & Audit Immutability Remediation
-- Task: AG-03 Financial Security & Reliability Audit
-- Target: PostgreSQL runtime connection role ('agus_runtime')
-- ============================================================================
--
-- INSTRUCTIONS:
-- Execute this script as the PostgreSQL superuser / schema owner AFTER running
-- migrations (migrations/0001_initial.sql through 0027_crypto_requests.sql).
-- Never execute this using application runtime credentials.
--
-- PROBLEM STATEMENT & FINDING:
-- In scripts/sql/runtime-role.sql and tests/helpers/shared-platform.ts, the
-- 'agus_runtime' role receives:
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO agus_runtime;
-- While legacy tables (agus_p2p_events, agus_legacy_authority) had UPDATE and DELETE
-- revoked, no such revocation was applied to the financial crypto tables or audit tables.
--
-- Consequently, a compromised web worker, application memory vulnerability, or
-- SQL injection vulnerability could:
--   1. Mutate or delete finalized settlement receipts (agus_crypto_receipts).
--   2. Alter or truncate on-chain transaction history (agus_crypto_chain_events).
--   3. Modify pre-authorized financial review terms (agus_crypto_reviews).
--   4. Delete or tamper with historical audit trails (agus_audit).
--
-- REMEDIATION:
-- Explicitly revoke UPDATE and DELETE privileges on immutable ledger, receipt,
-- review, and audit tables.
-- ============================================================================

-- 1. Ensure runtime role exists
DO $$ 
BEGIN 
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'agus_runtime') THEN 
    CREATE ROLE agus_runtime NOLOGIN; 
  END IF; 
END $$;

-- 2. Schema-level hygiene
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO agus_runtime;

-- 3. Revoke mutation privileges on append-only financial and audit tables
REVOKE UPDATE, DELETE ON 
  agus_crypto_chain_events,
  agus_crypto_receipts,
  agus_crypto_reviews,
  agus_audit
FROM agus_runtime;

-- 4. Re-affirm legacy table protections
REVOKE INSERT, UPDATE, DELETE ON 
  agus_migrations,
  agus_legacy_archive,
  agus_institutions,
  agus_institution_capabilities,
  agus_invitations,
  agus_fixture_escrow_authorities 
FROM agus_runtime;

REVOKE UPDATE, DELETE ON 
  agus_legacy_authority,
  agus_p2p_events,
  agus_request_chain_observations 
FROM agus_runtime;

GRANT UPDATE(consumed_at) ON agus_invitations TO agus_runtime;

-- ============================================================================
-- ARCHITECTURAL GAP ANALYSIS: POSTGRESQL ROW LEVEL SECURITY (RLS)
-- ============================================================================
--
-- Current State:
-- PostgreSQL Row Level Security (RLS) is currently NOT enabled across any table
-- in the schema. Application tenant isolation relies 100% on application code
-- discipline: every query in src/server/crypto/*.ts must include "WHERE owner = $1".
--
-- Identified Architectural Gap:
-- If an engineer introduces a new query or an administrative tool that omits
-- "WHERE owner = $1", or if a dynamic filter condition evaluates to true,
-- cross-tenant data leakage occurs immediately because the database connection
-- has broad SELECT access across all rows of every tenant.
--
-- Future Defense-in-Depth Recommendation:
-- 1. Enable RLS on all tenant-owned tables:
--      ALTER TABLE agus_crypto_wallets ENABLE ROW LEVEL SECURITY;
--      ALTER TABLE agus_crypto_wallet_routes ENABLE ROW LEVEL SECURITY;
--      ALTER TABLE agus_crypto_reviews ENABLE ROW LEVEL SECURITY;
--      ALTER TABLE agus_crypto_attempts ENABLE ROW LEVEL SECURITY;
--      ALTER TABLE agus_crypto_receipts ENABLE ROW LEVEL SECURITY;
--      ALTER TABLE agus_crypto_wallet_events ENABLE ROW LEVEL SECURITY;
--      ALTER TABLE agus_crypto_alerts ENABLE ROW LEVEL SECURITY;
--      ALTER TABLE agus_crypto_requests ENABLE ROW LEVEL SECURITY;
--
-- 2. Define tenant isolation policies using transaction-scoped session context:
--      CREATE POLICY crypto_tenant_isolation ON agus_crypto_wallets
--        FOR ALL
--        TO agus_runtime
--        USING (owner = current_setting('app.current_user_id', true)::uuid);
--
-- 3. Set session context in the connection pool / transaction wrapper:
--      await client.query("SELECT set_config('app.current_user_id', $1, true)", [principal.id]);
-- ============================================================================

-- Verification query (run to confirm privileges):
-- SELECT table_name, privilege_type 
-- FROM information_schema.role_table_grants 
-- WHERE grantee = 'agus_runtime' 
--   AND table_name IN ('agus_crypto_chain_events', 'agus_crypto_receipts', 'agus_crypto_reviews', 'agus_audit')
-- ORDER BY table_name, privilege_type;
