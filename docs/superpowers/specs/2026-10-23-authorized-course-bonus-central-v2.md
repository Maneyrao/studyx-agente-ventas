# Authorized Course Bonus Negotiation with Central v2 — Design Specification

## Source and status

This design reconciles the StudyX orchestrator with Lucas's committed handoff
`856d623` and Central contract `cd45ce5` on `origin/main`.

Lucas supplied the wire contract and the orchestrator handoff. He did not
supply orchestrator implementation. The Central v2 code is reported as present
locally in `Api_enrollments.php`, but it is not committed, not deployed, and has
not passed a complete Moodle test.

## Goal

When price is a proven blocker, Agent A may review and offer an active,
business-configured related course at no additional cost. The paid price remains
USD 360. One verified payment produces one coordinated Central v2 job covering
the paid course and every authorized bonus course. Moodle may complete those
steps incrementally, but the orchestrator does not declare the job complete
until every requested enrollment is verified.

## Commercial ownership

- Agent A interprets questions, first objections, persistent resistance,
  acceptance, and the lead's motivation from the full conversation.
- The backend never classifies the customer's prose. It authorizes promotion
  identities, effects, timing, payment correlation, and fulfillment facts.
- A price question is not an objection. A first price objection receives
  contextual value and may receive one later check-in; it does not automatically
  unlock a gift.
- When Agent A judges that price remains the blocker, it may request an
  authorized review and say naturally that it will check an alternative.
- A durable Botpress event runs about 60 seconds later. Its provider receipt is
  persisted; a minute-level recovery dispatcher recreates an event when the
  first scheduling attempt fails or the process stops before recording it.
  Claim and delivery revalidate the latest conversation and either send the
  authorized offer once or send nothing.
- A formally selected course is not required, but the current paid-course
  interest must resolve exactly. Generic catalog browsing cannot reserve a
  promotion.
- The initial business rule is `ingles_1` paid plus `ingles_2` at no additional
  cost. Agent A may not invent another pair, a discount, human approval,
  scarcity, or guaranteed income.
- A rejected promotion side effect must never suppress an otherwise valid
  conversational response.

## Promotion and payment state

The source of truth is PostgreSQL:

- `promotions` stores workspace, `promotion_code`, paid offering, one to three
  bonus offerings, channels, validity, and active state.
- `promotion_offers` stores the concrete conversation/contact promotion offered,
  delivery evidence, acceptance, expiration, and eventual payment association.
- `course_bonus_followups` stores the delayed review or one first-objection
  check-in, scheduling attempts, provider event, claim lease, and terminal
  state.
- `promotion_offer_bonus_offerings` freezes the complete, exact gift set before
  the offer is sent. `promotion_offers.bonus_snapshot_sealed_at` prevents a
  later catalog change or retry from appending another promised course.
- `payment_bonus_offerings` snapshots the bonus offering code, display name, and
  promotion code from that sealed offer in the same transaction that reserves
  the payment.
- A replay of payment reservation must compare the frozen promotion set. A
  different set is an idempotency conflict.
- The snapshot becomes immutable before the payment URL can leave the system.
  It is not recalculated from the live catalog during webhook processing or
  Central retries.

## Stripe checkout decision

The existing production Payment Link path already reserves a canonical payment
and adds `client_reference_id=<payment_id>` before sending the URL. Therefore a
promotion can be attached to that exact payment before delivery.

The MVP keeps this correlated static-link path. It does not migrate promoted
sales to the dormant dynamic checkout path, which currently refuses live Stripe
checkout and does not model all three StudyX plans. `promotion_code` remains in
the database/payment event and Central v2 request; Stripe metadata is not a
source of truth.

If a test proves that the deployed Stripe Payment Link does not return the
client reference in its signed webhook, promoted checkout must fail closed. It
must not silently fall back to an uncorrelated link.

## Agent contracts

Agent A receives bounded capabilities describing whether it may request a
promotion review, accept an active offer, or send a promoted payment link. A
review-only context does not reveal hidden bonus course names.

The active proposal/decision contracts add:

- `request_promotion_review` with only the exact paid offering code.
- `schedule_price_objection_checkin` with only the exact paid offering code.
- `accept_promotion` with only the durable promotion-offer id.
- optional `promotion_code` on `send_payment_link`.

The backend derives the bonus offerings, delay, price, identities, and URLs. It
validates `promotion_code` against a delivered and active offer for the same
workspace, contact, conversation, paid offering, and channel.

## Central v2 contract

The existing endpoint remains unchanged:

```http
POST /api/v1/enrollments
Idempotency-Key: <payment_id>
```

Without bonus courses, the worker sends schema v1 exactly as today. With a
frozen bonus snapshot, it sends schema v2 and adds:

```json
{
  "schema_version": 2,
  "bonus_offerings": [
    {
      "code": "ingles_2",
      "display_name": "Inglés 2",
      "promotion_code": "ingles_1_mas_ingles_2"
    }
  ]
}
```

The same `payment_id`, fulfillment job, POST, and GET reconciliation are used.
A 200/201 response is complete only when `bonus_enrollments` contains exactly
the requested codes and every item is `active`. A 202 remains processing. The
worker dead-letters explicit `unknown_offering`, `unsupported_schema_version`,
and `idempotency_conflict` outcomes.

## Post-sale

- The post-sale service reads the frozen payment bonus rows and the verified
  Central v2 response.
- It names the gift only after a valid 200/201 v2 result proves every course is
  active.
- The bonus line is deterministic backend copy so the protected-fact egress
  guard cannot remove or invent it.
- Credentials, campus URL, and official contacts stay unchanged. No invoice is
  generated or mentioned.
- The Central welcome email does not name the gift; the verified WhatsApp
  post-sale message is the customer-facing confirmation.

## Voice

Voice already has `enviar_link_pago`, which routes the link back to the original
WhatsApp or Telegram conversation. The voice work is an extension: return active
promotions from `consultar_oferta`, persist the accepted promotion, and pass its
code through the existing payment-link bridge. It is not a new checkout system.

## Enablement and external gate

`CENTRAL_CARGA_BONUS_ENABLED=false` stops new promotion visibility, offers, and
promoted payment reservations. A promoted payment is rejected before URL
delivery while the flag is off. Already-paid snapshots remain obligations: the
worker continues retry/reconciliation when Central is healthy. An emergency
fulfillment pause requires a separate operator control, an alert, and manual
completion; it must never degrade a paid v2 snapshot into v1.

Production enablement requires all of the following evidence from the Central:

1. v2 code committed and deployed;
2. `ingles_1` and `ingles_2` mapped in Central configuration;
3. complete Moodle test for new and existing students;
4. replay of the same v2 request is idempotent;
5. partial Moodle failure resumes without duplicate enrollment or email.

Refund behavior is outside the MVP. A refund involving a bonus creates an alert
and requires manual removal until a revocation contract is agreed.

## Acceptance scenarios

1. A direct price question never exposes or reserves a promotion.
2. A first objection receives value-based persuasion, not an automatic gift.
3. Persistent resistance with exact `ingles_1` interest schedules one review.
4. Fragmented messages are treated as one semantic objection, not a counter.
5. A course change, purchase, rejection, or opt-out during the minute cancels the
   stale offer.
6. An accepted offer can attach only to a matching `ingles_1` payment.
7. Reservation replay with a different promotion set fails closed.
8. A payment without a promotion continues through Central v1 unchanged.
9. A promoted payment cannot be delivered while the bonus flag is off.
10. Central v2 retry uses the same payment id and never creates a second job.
11. An incomplete or mismatched bonus response never produces an access claim.
12. Verified completion sends one message naming both Inglés 1 and Inglés 2.
13. A scheduler failure or process stop leaves a recoverable database row; it
    never silently loses the promised one-minute review.
14. Once the lead sees a gift set, neither a catalog edit nor a replay can add,
    remove, or replace a promised course.
