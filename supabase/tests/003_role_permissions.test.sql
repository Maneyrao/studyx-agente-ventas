BEGIN;
SELECT plan(11);

SELECT ok(EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orchestrator_role'), 'orchestrator role exists');
SELECT ok(EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_writer'), 'audit writer role exists');

SELECT ok(has_table_privilege('orchestrator_role', 'public.contacts', 'SELECT'), 'orchestrator reads contacts');
SELECT ok(has_table_privilege('orchestrator_role', 'public.contacts', 'INSERT'), 'orchestrator inserts contacts');
SELECT ok(NOT has_table_privilege('orchestrator_role', 'public.contacts', 'DELETE'), 'orchestrator cannot delete contacts');
SELECT ok(NOT has_table_privilege('orchestrator_role', 'public.audit_log', 'SELECT'), 'orchestrator cannot read audit log directly');

SELECT ok(has_table_privilege('audit_writer', 'public.audit_log', 'SELECT'), 'audit writer reads audit log');
SELECT ok(has_table_privilege('audit_writer', 'public.audit_log', 'INSERT'), 'audit writer inserts audit events');
SELECT ok(NOT has_table_privilege('audit_writer', 'public.audit_log', 'UPDATE'), 'audit writer cannot mutate audit events');
SELECT ok(NOT has_table_privilege('audit_writer', 'public.audit_log', 'DELETE'), 'audit writer cannot delete audit events');
SELECT ok(NOT has_table_privilege('audit_writer', 'public.contacts', 'SELECT'), 'audit writer cannot read business contacts');

SELECT * FROM finish();
ROLLBACK;
