-- Remove the direct Neon defaults that would bypass the restricted group.
-- Run with psql -v ON_ERROR_STOP=1 after scripts/sql/runtime-role.sql.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'agus_crypto_devnet_20261124'
     OR current_user <> 'agus_staging_owner' THEN
    RAISE EXCEPTION 'CRYPTO_OWNER_CONNECTION_REQUIRED';
  END IF;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE agus_staging_owner IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM agus_crypto_devnet_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE agus_staging_owner IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM agus_crypto_devnet_runtime;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM agus_crypto_devnet_runtime;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM agus_crypto_devnet_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON
  agus_crypto_chain_events, agus_crypto_wallet_events, agus_crypto_receipts,
  agus_crypto_reviews, agus_audit
FROM agus_runtime;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['agus_crypto_chain_events','agus_crypto_wallet_events',
      'agus_crypto_receipts','agus_crypto_reviews','agus_audit']) AS immutable(table_name)
    WHERE has_table_privilege('agus_crypto_devnet_runtime', immutable.table_name, 'UPDATE,DELETE,TRUNCATE')
       OR has_any_column_privilege('agus_crypto_devnet_runtime', immutable.table_name, 'UPDATE')
       OR NOT has_table_privilege('agus_crypto_devnet_runtime', immutable.table_name, 'INSERT')
       OR NOT has_table_privilege('agus_crypto_devnet_runtime', immutable.table_name, 'SELECT')
  ) OR NOT has_table_privilege('agus_crypto_devnet_runtime', 'agus_crypto_attempts', 'UPDATE')
    OR NOT has_column_privilege('agus_crypto_devnet_runtime', 'agus_invitations', 'consumed_at', 'UPDATE') THEN
    RAISE EXCEPTION 'EFFECTIVE_ACL_MISMATCH';
  END IF;
END $$;
COMMIT;
