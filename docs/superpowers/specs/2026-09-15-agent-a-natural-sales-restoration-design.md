# Agent A Natural Sales Restoration

Date: 2026-09-15
Status: approved in chat; pending written-spec review
Baseline: `6cbec4a` (Thursday conversational behavior)
Implementation base: `2b64302` on `codex/agent-a-naturalidad-cli`

## 1. Outcome

Restore the conversational qualities observed on Thursday while retaining the
operational improvements added afterward. Agent A must understand the customer's
combined intent, speak naturally in neutral Spanish, lead the sale proactively,
remember contact data, offer a call twice during an active sales journey, confirm
the complete purchase data, send one canonical payment link, and acknowledge a
reported payment without claiming that it was verified.

Natural language remains model-owned. The backend must not compose, shorten,
split, pad, or stylistically repair an otherwise safe answer.

## 2. Product invariants

### 2.1 Conversation

- DeepSeek reads the current customer intervention as a whole, including message
  fragments, corrections, abbreviations, spelling mistakes, and contact data
  distributed across messages.
- It responds to the customer's current meaning before advancing the sale.
- One or two short messages are normal. A third is allowed only when it separates
  a genuinely different idea. No fixed bubble count is imposed.
- It does not repeat a greeting, question, fact, recommendation, call invitation,
  or filler merely to create another message.
- It uses neutral Spanish, with no voseo or regionalisms.
- It may close questions and exclamations with `?` and `!`, but does not open them
  with inverted punctuation.
- It varies vocabulary and avoids stock chatbot openings.
- It may use an occasional emoji when appropriate.

### 2.2 Sales initiative

- The customer is a warm Meta lead. Agent A recommends and proposes a concrete
  next step instead of waiting for the customer to design the conversation.
- “Aggressive” means decisive and proactive: reduce unnecessary choices, explain
  the value, address the real objection, and ask for the next commitment. It does
  not mean pressure, manipulation, false urgency, or invented social proof.
- Sales phases are a map, not a blocking sequence. The agent may answer price
  first, change course, revisit a doubt, or advance directly when the customer is
  ready.
- Objections are handled contextually: acknowledge briefly, answer with an
  authorized fact or relevant plan, and propose a useful next step. There are no
  memorized objection scripts.

### 2.3 Call invitations

- The agent owns the wording and chooses the natural moment inside the conditions
  below. The backend does not author the invitation.
- First invitation: once the first name and a real course, area, or study goal are
  known, Agent A gives useful orientation and offers a call as a separate call
  offer.
- Second invitation: later in the same active sales journey, Agent A gives one
  differently worded reminder at the first useful closing moment: substantive
  questions, indecision, an objection, request for detail, or pre-payment
  friction. If none occurs, it happens before requesting final purchase data.
- The target is exactly two invitations during a sales journey that continues
  long enough to contain both opportunities.
- A direct call acceptance, completed purchase path, general opt-out, terminal
  handoff, or closed conversation ends the invitation obligation. A rejection of
  the current invitation prevents immediate repetition but does not erase the
  later reminder unless it is a general opt-out.
- PostgreSQL keeps the durable count and prevents a third invitation. This is an
  effect limit, not a writing rule.

### 2.4 Contact memory

- The channel phone is captured at first contact without asking the customer to
  repeat it.
- Any valid first name, surname, email, or phone appearing in the customer's
  current intervention is persisted immediately after the turn commits.
- Contact fields may arrive in any order and across multiple messages.
- A known field is never requested again. A correction replaces the previous
  value instead of creating another lead.
- The canonical lead identity remains the existing workspace/contact key. Sheets
  uses one idempotent row keyed by `lead:<workspace_id>:<contact_id>` and updates
  that row as information becomes available.
- Conversation memory helps resolve context but must not force an old course or
  old purchase state over an explicit current correction.

### 2.5 Payment journey

- Only the three canonical plans exist: 12 monthly payments of USD 30, 6 monthly
  payments of USD 60, or one payment of USD 360.
- The agent may discuss and recommend a plan naturally at any point once a real
  course is selected.
- Before requesting the payment link, the agent presents a concise confirmation
  containing name and surname, email, phone, course, and plan.
- If any contact field is missing, it requests only the missing fields and saves
  each answer. It does not repeat the entire form.
- The customer's confirmation or explicit request to advance authorizes the
  structured payment-link action.
- The backend appends exactly one configured Stripe URL. DeepSeek never writes or
  invents a URL.
- After the customer reports payment, the agent thanks them and explains that the
  team will verify the accreditation and, if confirmed, manage enrollment and
  access credentials. It must not claim that verification or access already
  happened.

## 3. Authority boundary

### DeepSeek owns

- interpretation of natural language and references;
- response wording, rhythm, vocabulary, and number of useful messages;
- course guidance and recommendations from visible catalog facts;
- sales initiative and objection handling;
- the proposed next commercial move;
- the wording and contextually useful timing of call invitations.

### The backend owns only

- canonical catalog and payment facts;
- persistence and correction of contact data;
- durable conversation state and call-offer count;
- permissions, opt-out, and human-review boundaries;
- Stripe link materialization;
- Sheets idempotency;
- call reservation and dispatch;
- replay and concurrency safety;
- rejection of fabricated facts or unauthorized sensitive effects.

The backend may ask DeepSeek for one repair when an unsafe fact or effect is
rejected. It must not replace safe model prose with canned commercial copy or
apply style-based pruning.

## 4. Prompt restoration

Use the Thursday prompt from `6cbec4a` as the behavioral source, not as a full
code rollback. Preserve its direct principles:

1. answer the present intention first;
2. use all batch messages as one intervention;
3. keep responses brief and naturally split;
4. write freely rather than copying examples;
5. recommend and advance rather than repeatedly interrogating;
6. use memory to listen, not to lock the customer into stale state.

Port only the following post-Thursday product decisions into that prompt:

- neutral Spanish and no opening inverted punctuation;
- the two-invitation call policy described above;
- progressive contact capture and final data confirmation;
- the current three payment plans;
- the post-payment human-verification statement;
- dynamic catalog behavior and current safety boundaries.

Do not add a phrase library, mandatory opening, fixed message count, backend
sales obligations, or textual heuristics for naturalness. The runtime preamble
contains only output-contract and authorization instructions; it must not repeat
the sales guide.

## 5. Consecutive-message coordination

The prompt cannot combine a message that has not reached the model. The transport
must therefore guarantee that late customer input cannot produce an obviously
stale answer.

- Inbound persistence starts before nonessential Botpress transcript cleanup.
- Messages arriving inside the ordinary batch window join the same batch.
- If a new inbound is persisted while a previous batch is generating, the
  existing supersession check discards the stale proposal before commit.
- If Botpress serializes handlers before persistence, transcript cleanup is moved
  out of the critical path or removed so the newer message becomes visible to
  the supersession check.
- Do not solve this by waiting 12–15 seconds before every answer. Preserve low
  latency for ordinary single-message turns.

## 6. Implementation scope

1. Replace the current canonical behavioral wording with a neutral-Spanish port
   of the Thursday core plus the minimal additions in section 4.
2. Reduce the Brain execution preamble to schema, current-turn integration,
   authorized facts, and sensitive-effect rules.
3. Audit response validation and remove style, length, bubble-count, or sales-copy
   transformations. Preserve only fact/effect safety and duplicate-delivery
   controls.
4. Preserve the existing contact-intake, conversation-state, Stripe, Sheets, and
   call ledgers. Fix only demonstrated persistence gaps.
5. Move Botpress transcript cleanup outside the inbound critical path and prove
   that a newer message can supersede an in-flight answer.
6. Regenerate the prompt artifact from its Markdown source.

No new planner, provider, database table, migration, or conversation framework is
introduced unless a failing test demonstrates that an existing durable field is
insufficient.

## 7. Verification

### 7.1 Free checks first

- Compare existing Thursday transcripts with current transcripts using the same
  quality rubric.
- Run deterministic tests for persistence, call count, Stripe, Sheets,
  idempotency, opt-out, and supersession.

### 7.2 Five real-workflow conversations

Run the real `processInboundTurn` path against isolated PostgreSQL. The five cases
cover:

1. general information split across several messages;
2. English-family ambiguity followed by a level choice;
3. course selection, initial call decline, continued chat, and later reminder;
4. price objection, plan selection, fragmented contact data, correction, and
   final confirmation;
5. payment-link delivery, replay, payment report, and post-payment response.

Each case includes abbreviations, spelling mistakes, corrections, and pauses on
both sides of the normal batching window. At least one sends a second message
while the first model call is still running.

### 7.3 Acceptance

- 5/5 functional journeys pass through the real workflow.
- No stale answer is delivered after newer input changes its meaning.
- No exact duplicate or semantic repetition appears.
- Normal responses contain one or two useful messages; a third is accepted only
  when independently useful.
- Neutral Spanish and punctuation requirements hold.
- The agent answers the present intention and advances the sale naturally.
- Two call invitations appear in every sufficiently long active sales journey,
  and never a third.
- Contact values persist once, survive later turns, and are not requested again.
- The confirmation contains the six required purchase fields.
- Exactly one canonical payment link and one Sheets lead row exist under replay.
- Payment reporting produces a pending-human-verification response, not a false
  success claim.
- A qualitative comparison finds the candidate at least as natural as the
  Thursday baseline and more complete commercially.

After local acceptance, deploy the same commit to Vercel and Botpress, verify both
identities, reset one supervised test conversation, and repeat a single Telegram
canary. Production is accepted only when that canary preserves the local behavior.

## 8. Explicit non-goals

- Rebuilding Agent B or the Retell/Xendra integration.
- Moving the knowledge base to Botpress.
- Fine-tuning a foundation model.
- Adding canned objection responses.
- Increasing prompt size to cover individual phrases.
- Weakening fact, payment, privacy, opt-out, or idempotency guarantees.
