-- Local reset support only. PostgreSQL 17 can grant membership while denying
-- SET ROLE; integration tests deliberately enter the production application
-- roles to exercise their least-privilege grants.
GRANT orchestrator_role TO postgres WITH INHERIT FALSE, SET TRUE;
GRANT audit_writer TO postgres WITH INHERIT FALSE, SET TRUE;
