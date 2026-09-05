-- Bandera RUNTIME. El rollback es un UPDATE: no exige publicar el bundle de
-- Botpress (hoy bloqueado por EXT-05) ni redeploy de Vercel.
-- El allowlist se indexa por contact_id, neutral al canal: un contacto de
-- Telegram tiene E.164 sintético y un allowlist telefónico no lo alcanzaría.
CREATE TABLE IF NOT EXISTS agent_loop_rollout_v3 (
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id   uuid            NULL REFERENCES contacts(id)   ON DELETE CASCADE,
  mode         text        NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_loop_rollout_v3_mode_check
    CHECK (mode IN ('off', 'shadow', 'authoritative'))
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_loop_rollout_v3_workspace_contact_key
  ON agent_loop_rollout_v3 (workspace_id, COALESCE(contact_id, '00000000-0000-0000-0000-000000000000'::uuid));

COMMENT ON TABLE agent_loop_rollout_v3 IS
  'Modo del agent loop v3. contact_id NULL = default del workspace. Resolución: contacto, luego workspace, luego off.';
