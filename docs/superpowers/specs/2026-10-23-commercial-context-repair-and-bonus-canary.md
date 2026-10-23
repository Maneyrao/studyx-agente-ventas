# Commercial Context, Repair, and Bonus Canary — Design

## Scope

This change fixes three production defects without changing rejected-turn
recovery, retry counts, abandonment, or any other silence behavior:

1. exact course interest and price objections were not durably connected;
2. three rewrites repeated an unauthorized commercial promise and were all
   rejected as `FACT_VALUE_MISMATCH:forbidden_promise`;
3. the existing Inglés 1 + Inglés 2 promotion must be testable without exposing
   it to every production contact.

The paid price remains USD 360. No invoice is added.

## Ownership

- Agent A continues to interpret the commercial phase, objection, and intent.
- Agent A continues to write all customer-facing prose.
- The backend validates catalog identities, commercial truth, promotion state,
  idempotency, and effects. It does not manufacture a sales reply.
- The commercial-truth guard remains fail-closed for invented discounts,
  bonuses, income guarantees, and unavailable promotions.

## Durable commercial context

`move.course_reference` remains the primary model-owned course signal. As a
non-blocking fallback, the backend may bind commercial interest only when the
agent's own accepted response names exactly one active canonical offering. It
does not classify customer prose and does not infer a course from an area or a
generic word such as “inglés”. Multiple named courses produce no fallback.

The resulting canonical course code is written to
`conversation_promotion_context_v1`. A model-owned `price_objection` memory
candidate increments the durable objection count for that course, capped at
two. Replaying the same source turn must not increment it twice. A course
change resets the count for the new course.

## Rejected promise repair

When `turn_rejection` contains `FACT_VALUE_MISMATCH:forbidden_promise`, Agent A
receives an explicit model-side repair rule:

- if no promotion effect is authorized, remove the promise and answer the
  objection through contextual value without claiming a discount or gift;
- if `request_promotion_review` is authorized, it may say naturally that it
  will check an alternative and execute that action, without naming a gift;
- if an offer is already available, it may mention only the authorized
  promotion and bonus offerings;
- never promise income, employment, approval, scarcity, or a completed effect.

The backend continues to reject an invalid rewrite. No silence/recovery path is
modified.

## Canary activation

Add `CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS`, a comma-separated set of exact
contact UUIDs. Promotion visibility, review actions, acceptance, and promoted
payment reservation are enabled when either the global bonus flag is on or the
current contact is in this canary set.

Global enablement remains off. The promotion row can be active because every
entry point is contact-fenced. A paused fulfillment worker may process a bonus
snapshot only for a canary contact; all other bonus jobs remain paused. The
ordinary paid-course path is unchanged.

## Acceptance criteria

- The recorded 4497-style transcript persists `ingles_1` without selecting it,
  counts repeated price objections, and exposes review only after evidence.
- Replaying one source turn does not double-count an objection.
- A `forbidden_promise` repair prompt tells Agent A exactly what to remove and
  which promotion action, if any, is authorized.
- A non-canary contact cannot see, request, accept, reserve, or fulfill a bonus
  while the global flag is off.
- The canary contact can complete the existing promotion flow.
- Existing rejected-turn recovery and silence behavior are byte-for-byte
  untouched.
