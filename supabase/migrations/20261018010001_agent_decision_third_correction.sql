-- Agent A may make one final, bounded correction after two rejected drafts.
-- Keep the immutable diagnostic receipt aligned with that physical request
-- budget so a valid third draft is not rejected by PostgreSQL at commit time.

ALTER TABLE agent_decisions
  DROP CONSTRAINT IF EXISTS agent_decisions_diagnostics_shape_check;

ALTER TABLE agent_decisions
  ADD CONSTRAINT agent_decisions_diagnostics_shape_check CHECK (
    diagnostics IS NULL OR (
      jsonb_typeof(diagnostics) = 'object'
      AND diagnostics - ARRAY[
        'schema_version',
        'generation_attempts',
        'failure_stage',
        'failure_codes',
        'action_status'
      ] = '{}'::jsonb
      AND diagnostics ->> 'schema_version' = '1'
      AND jsonb_typeof(diagnostics -> 'generation_attempts') = 'number'
      AND (diagnostics ->> 'generation_attempts')::integer BETWEEN 0 AND 3
      AND diagnostics ->> 'failure_stage' IN (
        'none',
        'provider_generation',
        'proposal_validation',
        'action_authorization',
        'backend_commit'
      )
      AND jsonb_typeof(diagnostics -> 'failure_codes') = 'array'
      AND jsonb_array_length(diagnostics -> 'failure_codes') <= 8
      AND NOT jsonb_path_exists(
        diagnostics,
        '$.failure_codes[*] ? (@.type() != "string")'
      )
      AND diagnostics ->> 'action_status' IN (
        'none',
        'authorized',
        'needs_input',
        'rejected'
      )
    )
  );
