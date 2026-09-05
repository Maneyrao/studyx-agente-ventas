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

-- La primera versión de esta migración podía haber creado ya la tabla. Los
-- ALTER siguientes corrigen esa forma existente; no dependen de que CREATE
-- TABLE haya sido quien materializó el esquema en esta aplicación.
ALTER TABLE agent_loop_rollout_v3
  DROP CONSTRAINT IF EXISTS agent_loop_rollout_v3_workspace_contact_membership_fk;
ALTER TABLE agent_loop_rollout_v3
  ADD CONSTRAINT agent_loop_rollout_v3_workspace_contact_membership_fk
  FOREIGN KEY (workspace_id, contact_id)
  REFERENCES workspace_contacts (workspace_id, contact_id)
  ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS agent_loop_rollout_v3_workspace_contact_key
  ON agent_loop_rollout_v3 (workspace_id, COALESCE(contact_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE OR REPLACE FUNCTION public.agent_loop_rollout_v3_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS agent_loop_rollout_v3_set_updated_at ON agent_loop_rollout_v3;
CREATE TRIGGER agent_loop_rollout_v3_set_updated_at
BEFORE UPDATE ON agent_loop_rollout_v3
FOR EACH ROW EXECUTE FUNCTION public.agent_loop_rollout_v3_touch_updated_at();

ALTER TABLE agent_loop_rollout_v3 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON agent_loop_rollout_v3 FROM orchestrator_role;
GRANT SELECT, INSERT, UPDATE ON agent_loop_rollout_v3 TO orchestrator_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON agent_loop_rollout_v3 FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON agent_loop_rollout_v3 FROM authenticated;
  END IF;
END $$;

DROP POLICY IF EXISTS orchestrator_access ON agent_loop_rollout_v3;
CREATE POLICY orchestrator_access ON agent_loop_rollout_v3
  FOR ALL TO orchestrator_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE agent_loop_rollout_v3 IS
  'Modo del agent loop v3. contact_id NULL = default del workspace. Resolución: contacto, luego workspace, luego off.';
