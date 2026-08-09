-- Phase 8: Sales tools — product catalog.
-- Additive. Keeps prices in minor units (ARS cents, USD cents) so integer
-- arithmetic never surprises us at the CHECK boundary; add a decimal view
-- later if humans need it in the dashboard. active=false soft-retires a SKU
-- without deleting historical references (e.g. from decisions log).

CREATE TABLE products (
  sku              text         PRIMARY KEY,
  name             text         NOT NULL,
  description      text,
  duration_weeks   int          NOT NULL CHECK (duration_weeks > 0),
  modality         text         NOT NULL CHECK (modality IN ('live', 'ondemand', 'hybrid')),
  price_ars_cents  bigint       NOT NULL CHECK (price_ars_cents >= 0),
  price_usd_cents  bigint       NOT NULL CHECK (price_usd_cents >= 0),
  promo_ars_cents  bigint       CHECK (promo_ars_cents IS NULL OR promo_ars_cents >= 0),
  promo_usd_cents  bigint       CHECK (promo_usd_cents IS NULL OR promo_usd_cents >= 0),
  promo_valid_to   timestamptz,
  active           boolean      NOT NULL DEFAULT true,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX products_active_idx ON products (active) WHERE active = true;

-- Trigger keeps updated_at fresh without depending on the ORM layer.
CREATE OR REPLACE FUNCTION products_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER products_updated_at_trg
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION products_touch_updated_at();
