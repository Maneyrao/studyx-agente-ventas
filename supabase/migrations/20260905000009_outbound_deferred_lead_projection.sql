-- P1-C (re-review 2026-09-05, task-2.13-2.14-independent-rereview.md): the
-- commit transaction called `enqueueLeadProjection` directly
-- (commit-agent-turn-v3.ts), which left `sheet_projection_rows` in `pending`
-- — immediately claimable by `flushSheetProjections`/`claim_sheet_projection_rows`
-- — while the outbound message could still be `leased`, or never delivered at
-- all. A sales operator could then follow up in the spreadsheet on a
-- conversation the customer never saw.
--
-- `projection.service.ts` already documents the correct contract:
-- `enqueueLeadProjection` must run "always after channel delivery is
-- confirmed, never inside the canonical transaction". The payment path
-- (`payment_projection_jobs`, 20260825010001) already honors this for
-- `send_payment_link`, gating its own Sheets write on a `waiting_delivery` ->
-- `pending` transition performed at `submitted_to_botpress`.
--
-- Reused mechanism for the lead path: the SAME deferred-until-accepted
-- column pair already used for state patches
-- (`deferred_state_patch`/`deferred_patch_applied_on`, 20260905000002), not a
-- new parallel job table or scheduler. The lead projection input is captured
-- on the SAME `outbound_deliveries` row the message already has, and
-- `applyLeadProjectionOnAcceptedOutboundV3` (commit-agent-turn-v3.ts) turns it
-- into a claimable `sheet_projection_rows` row only from the existing
-- `recordDeliveryReport` `submitted_to_botpress` branch (decision.service.ts)
-- — the exact call site that already applies the deferred state patch and
-- marks the payment projection job delivered.
--
-- `submitted_to_botpress` means the channel ACCEPTED the message, not that
-- the customer has seen it: it is the strongest proof available for the
-- Telegram sandbox, which emits no delivery receipt. A delivery reported
-- `failed` leaves `deferred_lead_projection` populated but
-- `deferred_lead_projection_applied_on` NULL — the lead is never enqueued for
-- that attempt; if the delivery later succeeds on retry, the same
-- `submitted_to_botpress` report promotes it then. A retryable failure that
-- never recovers (exhausted into `dead_letter`) simply never projects the
-- lead — a defined terminal outcome, consistent with never chasing a lead for
-- a message the customer never received.
--
-- Plain column additions plus non-blocking CHECK validation: safe to apply
-- twice (IF NOT EXISTS / DROP+ADD NOT VALID/VALIDATE), no new function or
-- privilege change.

ALTER TABLE outbound_deliveries
  ADD COLUMN IF NOT EXISTS deferred_lead_projection jsonb,
  ADD COLUMN IF NOT EXISTS deferred_lead_projection_applied_on text;

ALTER TABLE outbound_deliveries
  DROP CONSTRAINT IF EXISTS outbound_deliveries_deferred_lead_projection_applied_on_check;
-- `NOT VALID` keeps the short catalog change separate from the table scan;
-- `VALIDATE` preserves the same constraint semantics with a weaker lock.
ALTER TABLE outbound_deliveries
  ADD CONSTRAINT outbound_deliveries_deferred_lead_projection_applied_on_check
  CHECK (deferred_lead_projection_applied_on IS NULL
         OR deferred_lead_projection_applied_on IN ('accepted')) NOT VALID;

ALTER TABLE outbound_deliveries
  VALIDATE CONSTRAINT outbound_deliveries_deferred_lead_projection_applied_on_check;

COMMENT ON COLUMN outbound_deliveries.deferred_lead_projection IS
  'Lead projection input captured at commit time (P1-C fix), applied by applyLeadProjectionOnAcceptedOutboundV3 only once the channel accepts the outbound (submitted_to_botpress). NULL when the committed turn had no prepare_lead_projection.';
COMMENT ON COLUMN outbound_deliveries.deferred_lead_projection_applied_on IS
  'Set to ''accepted'' the first time the deferred lead projection above was materialized into sheet_projection_rows. NULL means either no lead was prepared for this outbound, or delivery has not been accepted yet.';
