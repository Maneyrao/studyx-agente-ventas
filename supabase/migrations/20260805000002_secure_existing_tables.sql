-- Close the original public tables to Supabase client roles.
-- Server-side database roles retain only their previously granted capabilities.

BEGIN;

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON contacts, conversations, messages, message_embeddings, audit_log
  FROM anon, authenticated;

CREATE POLICY orchestrator_access ON contacts
  FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
CREATE POLICY orchestrator_access ON conversations
  FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
CREATE POLICY orchestrator_access ON messages
  FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
CREATE POLICY orchestrator_access ON message_embeddings
  FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);

CREATE POLICY audit_writer_read ON audit_log
  FOR SELECT TO audit_writer USING (true);
CREATE POLICY audit_writer_append ON audit_log
  FOR INSERT TO audit_writer WITH CHECK (true);

COMMIT;
