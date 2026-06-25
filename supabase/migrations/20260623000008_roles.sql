-- Two connection roles with their own LOGIN credentials.
-- Passwords must also be set in Supabase Dashboard → Project Settings → Database → Roles
-- so that Supavisor accepts them as connection identities.
--
-- Replace <orchestrator_password> and <audit_writer_password> with strong random strings
-- before running this migration against the remote database.

CREATE ROLE orchestrator_role LOGIN PASSWORD 'PN3ZbOq6x6xlUVJu+Jy4PWE8sNjrOTlj';
CREATE ROLE audit_writer       LOGIN PASSWORD 'QGyAhx1I+ggVft4wFm0zLDMIB2p87yJF';

-- orchestrator_role: business tables only — INSERT, UPDATE, SELECT; no DELETE
GRANT INSERT, UPDATE, SELECT ON contacts           TO orchestrator_role;
GRANT INSERT, UPDATE, SELECT ON conversations      TO orchestrator_role;
GRANT INSERT, UPDATE, SELECT ON messages           TO orchestrator_role;
GRANT INSERT, UPDATE, SELECT ON message_embeddings TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON contacts, conversations,
  messages, message_embeddings FROM orchestrator_role;

-- orchestrator_role has NO direct access to audit_log.
-- The only write path is write_audit_log() (SECURITY DEFINER owned by audit_writer).
REVOKE ALL ON audit_log FROM orchestrator_role;

-- audit_writer: INSERT + SELECT on audit_log only; no DELETE or UPDATE
GRANT INSERT, SELECT ON audit_log TO audit_writer;
REVOKE DELETE, TRUNCATE, UPDATE ON audit_log FROM audit_writer;

-- Grant EXECUTE on the write_audit_log function to orchestrator_role
-- (function is created in the next migration)
-- GRANT EXECUTE ON FUNCTION write_audit_log TO orchestrator_role;
-- (uncomment after running 20260623000009_audit_write_function.sql)
