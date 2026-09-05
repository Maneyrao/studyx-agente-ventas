-- El estado que depende de que el cliente haya visto el mensaje viaja acá y se
-- aplica recién cuando el canal ACEPTA el outbound. `applied_on` registra la
-- calidad de la prueba: 'accepted' (submitted) o 'delivered'.
ALTER TABLE outbound_deliveries
  ADD COLUMN IF NOT EXISTS deferred_state_patch jsonb,
  ADD COLUMN IF NOT EXISTS deferred_patch_applied_on text;

ALTER TABLE outbound_deliveries
  DROP CONSTRAINT IF EXISTS outbound_deliveries_deferred_patch_applied_on_check;
ALTER TABLE outbound_deliveries
  ADD CONSTRAINT outbound_deliveries_deferred_patch_applied_on_check
  CHECK (deferred_patch_applied_on IS NULL
         OR deferred_patch_applied_on IN ('accepted', 'delivered'));
