-- Credentials are deliberately not versioned. After these migrations are applied,
-- provision LOGIN and a unique password for each role with a project-admin
-- connection. Store the resulting connection URLs only in `.env.local` / Vercel.
-- Example (run outside migrations, never commit the values):
--   ALTER ROLE orchestrator_role LOGIN PASSWORD '<generated-secret>';
--   ALTER ROLE audit_writer LOGIN PASSWORD '<generated-secret>';

CREATE ROLE orchestrator_role NOLOGIN;
CREATE ROLE audit_writer       NOLOGIN;

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
