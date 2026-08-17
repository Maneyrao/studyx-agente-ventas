-- Deactivate placeholder catalog products.
--
-- Context: data/catalog.seed.json shipped three PLACEHOLDER-* products with
-- active = true. Once /api/agent/tools/catalog stops failing on timestamptz
-- normalization, those rows would become quotable — the agent would state
-- invented prices. Defense in depth:
--   1. The seed now ships them with active = false.
--   2. The service excludes sku LIKE 'PLACEHOLDER-%' in SQL and in code.
--   3. This migration deactivates any placeholder row already present.
--
-- Idempotent and auditable: re-running affects zero rows once applied; the
-- audit_log row records exactly which SKUs were touched.

DO $$
DECLARE
  affected_skus text[];
BEGIN
  SELECT COALESCE(array_agg(sku ORDER BY sku), ARRAY[]::text[])
    INTO affected_skus
    FROM products
   WHERE sku LIKE 'PLACEHOLDER-%'
     AND active = true;

  UPDATE products
     SET active = false
   WHERE sku LIKE 'PLACEHOLDER-%'
     AND active = true;

  IF array_length(affected_skus, 1) IS NOT NULL THEN
    INSERT INTO audit_log (actor, action, entity_type, entity_id, payload)
    VALUES (
      'migration',
      'catalog.placeholders_deactivated',
      'products',
      NULL,
      jsonb_build_object('skus', to_jsonb(affected_skus))
    );
  END IF;
END $$;
