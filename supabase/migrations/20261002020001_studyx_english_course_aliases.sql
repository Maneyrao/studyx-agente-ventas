-- Owner-authored spoken aliases for the three StudyX English levels.
-- A shared `inglés` alias intentionally resolves to multiple candidates so
-- the voice agent asks for the level instead of claiming the course is absent.

BEGIN;

UPDATE offerings AS offering
SET metadata = COALESCE(offering.metadata, '{}'::jsonb) || jsonb_build_object(
  'aliases', CASE offering.code
    WHEN 'ingles_1' THEN jsonb_build_array('inglés', 'inglés básico', 'inglés inicial', 'nivel básico')
    WHEN 'ingles_2' THEN jsonb_build_array('inglés', 'inglés intermedio', 'nivel intermedio')
    WHEN 'ingles_3' THEN jsonb_build_array('inglés', 'inglés avanzado', 'nivel avanzado')
  END
), updated_at = now()
FROM workspaces AS workspace
WHERE offering.workspace_id = workspace.id
  AND workspace.slug = 'studyx'
  AND offering.code IN ('ingles_1', 'ingles_2', 'ingles_3');

COMMIT;
