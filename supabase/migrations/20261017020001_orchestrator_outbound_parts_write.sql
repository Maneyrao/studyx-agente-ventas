-- Multi-bubble delivery stores immutable decision-to-message links. This
-- table was added after the original role grant migration and must follow the
-- same append-only boundary as the rest of the decision ledger.
GRANT SELECT, INSERT ON agent_decision_outbound_parts TO orchestrator_role;
REVOKE UPDATE, DELETE, TRUNCATE ON agent_decision_outbound_parts FROM orchestrator_role;
