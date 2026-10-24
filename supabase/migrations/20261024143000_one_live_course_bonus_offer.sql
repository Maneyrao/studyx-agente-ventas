-- A conversation may negotiate only one live bonus package for the same paid
-- course. Never discard an accepted commitment in favor of a later review.
UPDATE public.promotion_offers
SET status = 'cancelled',
    cancel_reason = 'EXPIRED_BEFORE_UNIQUE_GUARD',
    updated_at = now()
WHERE status IN ('pending_review','offered','accepted')
  AND payment_id IS NULL
  AND expires_at IS NOT NULL
  AND expires_at <= now();

WITH ranked AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY conversation_id, paid_offering_id
      ORDER BY
        CASE status
          WHEN 'accepted' THEN 0
          WHEN 'offered' THEN 1
          ELSE 2
        END,
        created_at DESC,
        id DESC
    ) AS position
  FROM public.promotion_offers
  WHERE status IN ('pending_review','offered','accepted')
    AND payment_id IS NULL
)
UPDATE public.promotion_offers offer
SET status = 'cancelled',
    cancel_reason = 'SUPERSEDED_BEFORE_UNIQUE_GUARD',
    updated_at = now()
FROM ranked
WHERE offer.id = ranked.id
  AND ranked.position > 1;

CREATE UNIQUE INDEX promotion_offers_one_live_paid_course_uq
  ON public.promotion_offers (conversation_id, paid_offering_id)
  WHERE status IN ('pending_review','offered','accepted')
    AND payment_id IS NULL;
