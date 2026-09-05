-- Manifiesto verificable por turno. Permite responder qué prompt corrió en
-- producción desde la base, sin acceso al Control Panel de Botpress.
ALTER TABLE agent_decisions
  ADD COLUMN IF NOT EXISTS release_manifest jsonb;

COMMENT ON COLUMN agent_decisions.release_manifest IS
  'ReleaseManifestV1: git_sha, botpress_artifact_sha, prompt_version, model, prompt_sha256, tool_contract_version.';
