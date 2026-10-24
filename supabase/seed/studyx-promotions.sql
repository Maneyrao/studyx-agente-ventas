-- Disabled-by-default StudyX promotion catalog.
WITH catalog AS (
  SELECT
    w.id AS workspace_id,
    paid.id AS paid_offering_id,
    bonus.id AS bonus_offering_id
  FROM public.workspaces w
  JOIN public.offerings paid ON paid.workspace_id = w.id AND paid.code = 'ingles_1'
  JOIN public.offerings bonus ON bonus.workspace_id = w.id AND bonus.code = 'ingles_2'
  WHERE w.slug = 'studyx'
), inserted AS (
  INSERT INTO public.promotions (
    workspace_id, promotion_code, paid_offering_id, channels, active
  )
  SELECT workspace_id, 'ingles_1_mas_ingles_2', paid_offering_id,
    ARRAY['text','voice']::text[], false
  FROM catalog
  ON CONFLICT (workspace_id, promotion_code) DO NOTHING
  RETURNING id, workspace_id
), promotion AS (
  SELECT id, workspace_id FROM inserted
  UNION ALL
  SELECT p.id, p.workspace_id
  FROM public.promotions p
  JOIN catalog c ON c.workspace_id = p.workspace_id
  WHERE p.promotion_code = 'ingles_1_mas_ingles_2'
    AND NOT EXISTS (SELECT 1 FROM inserted)
)
INSERT INTO public.promotion_bonus_offerings (
  promotion_id, workspace_id, offering_id, position
)
SELECT p.id, c.workspace_id, c.bonus_offering_id, 1
FROM promotion p
JOIN catalog c ON c.workspace_id = p.workspace_id
ON CONFLICT (promotion_id, offering_id) DO NOTHING;
