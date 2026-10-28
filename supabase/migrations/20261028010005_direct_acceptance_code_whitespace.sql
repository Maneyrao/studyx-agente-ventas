-- btrim() alone does not reject tab/newline-only direct promotion identities.
ALTER TABLE public.agent_decisions ADD CONSTRAINT agent_decisions_direct_acceptance_whitespace_check
CHECK (
  schema_version <> 4
  OR business_action IS NULL
  OR business_action->>'type' <> 'accept_promotion'
  OR NOT (business_action ? 'promotion_code')
  OR COALESCE(regexp_replace(business_action->>'promotion_code', '[[:space:]]', '', 'g') <> '', false)
);
