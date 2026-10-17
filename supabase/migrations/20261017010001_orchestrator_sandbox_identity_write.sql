-- The ingest pipeline registers an explicit sandbox identity in the same
-- transaction as the first inbound message. The runtime role needs INSERT for
-- that safety lock to be durable before any downstream effect can run.
--
-- Keep the boundary append-only: runtime code may read and insert the lock,
-- but cannot mutate or remove it.
GRANT SELECT, INSERT ON sandbox_identities TO orchestrator_role;
REVOKE UPDATE, DELETE, TRUNCATE ON sandbox_identities FROM orchestrator_role;
