-- Preserve legacy acceptance; direct acceptance always names a nonblank code.
ALTER TABLE public.agent_decisions ADD CONSTRAINT agent_decisions_direct_acceptance_code_check
CHECK (
  schema_version <> 4
  OR business_action IS NULL
  OR business_action->>'type' <> 'accept_promotion'
  OR NOT (business_action ? 'promotion_code')
  OR COALESCE(btrim(business_action->>'promotion_code') <> '', false)
);
