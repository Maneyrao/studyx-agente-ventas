-- Apply to the backend role, including sessions behind transaction pooling.
-- Do not change postgres/admin deadlines used for migrations and maintenance.
-- Existing pool server connections must be recycled/verified before activation.
ALTER ROLE orchestrator_role SET statement_timeout = '8s';
ALTER ROLE orchestrator_role SET lock_timeout = '1500ms';
ALTER ROLE orchestrator_role SET idle_in_transaction_session_timeout = '10s';
