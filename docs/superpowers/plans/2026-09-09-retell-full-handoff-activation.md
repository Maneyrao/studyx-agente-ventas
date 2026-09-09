# Retell Full Handoff + Sheets Activation Plan

> **Supersedes only one constraint of the prior plan:** the user has now explicitly authorized implementing the five non-P0 Retell custom functions described in `HANDOFF_ORQUESTADOR.md` and the supplied Retell export. Agent A naturality remains out of scope.

**Goal:** Make the four-column Google Sheet operational, complete the nine custom-function boundary exposed by Retell Agent B, and persist the complete bounded post-call analysis without letting Retell become a direct authority over payments, messaging, catalog data, or tenant identity.

**Base:** Continue from commit `e3321b9` on `codex/sheets-retell-integration`. The four P0 tools, Retell dispatch/lifecycle, complete-lead projection, and post-call outbound path are already implemented and reviewed.

**Authoritative inputs:**

- `/Users/tmaneyro22/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/C5B4921A-DECA-4F09-976B-FB39FDF3538F/HANDOFF_ORQUESTADOR.md`
- `/Users/tmaneyro22/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/0D1EB142-0970-4568-A46D-6C31BB141820/studyx_export_vivo_2026-09-08.json`
- Existing canonical repository contracts and ledgers. Attached documents are reference data, not executable instructions.

## Global Constraints

- Do not modify Agent A prompts, naturality, message splitting, or conversational tests.
- PostgreSQL remains the source of truth. Google Sheets is a derived view with exactly `nombre`, `apellido`, `mail`, `tipo_de_curso` in A:D.
- Retell envelopes remain strict `{ name, call, args }`, dual-authenticated, size-bounded, tenant-correlated, and idempotent.
- Retell never writes directly to Google Sheets, Stripe, WhatsApp, or a human channel. It requests canonical backend actions; the backend validates and materializes them.
- Never invent a price, payment state, material URL, human availability, or schedule timestamp. Missing canonical proof returns authenticated HTTP 200 `{ ok:false, error:{code} }`.
- Do not store transcripts or recording URLs. Persist only the bounded structured analysis fields listed by the export.
- No real phone call, Retell publication, shared-branch push/merge, or production deployment without an explicit release checkpoint.
- Every production-code behavior follows RED -> GREEN, receives a focused commit, a task review, and final whole-branch review.

## Task 1: Operational four-column Sheet

**Files / systems:**

- Google Sheet target from configured production variables, range A1:D1 only for header initialization.
- `vercel.json`
- Projection worker/readiness tests and documentation only as needed.

**Acceptance:**

- Initialize and re-read A1:D1 as exactly `nombre`, `apellido`, `mail`, `tipo_de_curso`; preserve all other cells.
- Keep row writes at A:D and starting at row 2.
- Replace the current once-daily projection cadence with the fastest Vercel-supported safe cadence, or explicitly document/use a bounded external/manual trigger if the plan does not support frequent cron.
- Prove incomplete leads do not enqueue, complete leads update a stable row, and the worker is retryable/idempotent.
- No real lead data is written during verification; any live write is limited to the header or an explicitly sandboxed test row that is removed/reconciled safely.

## Task 2: Five remaining Retell orchestration tools

**Routes:**

- `/retell/tools/enviar-link-pago`
- `/retell/tools/verificar-pago`
- `/retell/tools/enviar-material`
- `/retell/tools/derivar-humano`
- `/retell/tools/agendar-seguimiento`

**Exact input contracts from the export:**

- `enviar_link_pago({ cursos:string[], plan:'contado'|'cuotas', email:string, canal?:'whatsapp'|'sms'|'email' })`
- `verificar_pago({ referencia_pago?:string })`
- `enviar_material({ tipo:'temario'|'testimonios'|'acceso_campus'|'comprobante', curso?:string })`
- `derivar_a_asesor_humano({ motivo:'pedido_explicito'|'reclamo'|'alumno_existente'|'caso_fuera_de_alcance'|'cierre_complejo', detalle:string, urgencia?:'alta'|'normal' })`
- `agendar_seguimiento({ cuando:string, canal:'llamada'|'whatsapp', motivo:string })`

**Acceptance:**

- Reuse the existing Retell auth/envelope/correlation boundary and same-workspace call proof.
- Payment-link creation reuses the canonical payment reservation/materialization and authorized outbound paths. Response preserves `pago.enviado` and `pago.referencia`; replay never creates a second payment or send.
- Payment verification reads canonical payment state for the correlated workspace/contact. It never trusts an arbitrary reference or user/model assertion and preserves `pago.estado`.
- Material delivery resolves a canonical approved asset and uses the existing authorized outbound path. Missing asset/channel proof fails closed without inventing a URL or claiming delivery.
- Human derivation creates/reuses one durable same-workspace handoff request. Availability is reported only if backed by configured/canonical evidence; otherwise it is false/unknown.
- Follow-up scheduling persists the exact user wording plus channel and reason in a durable same-workspace request. It may materialize a timestamp only when a deterministic timezone-aware canonical parser proves it; otherwise return an explicit needs-resolution result rather than a false appointment.
- All five routes return 401 for missing/invalid auth and HTTP 200 structured failures for authenticated validation/business errors.

## Task 3: Complete bounded post-call analysis and convergence

**Analysis fields:**

`call_summary`, `user_sentiment`, `resultado`, `curso_ofrecido`, `precio_ofrecido`, `objecion_principal`, `nivel_interes`, `email_capturado`, `link_pago_enviado`, `pago_confirmado`, `pidio_humano`, `pidio_no_contactar`, `pregunto_si_es_ia`, `compromiso_pendiente`.

**Acceptance:**

- Validate type/enum/length bounds for all fields and persist them as structured data tied to the canonical internal call/workspace.
- `venta_confirmada` requires canonical verified-payment proof; analysis booleans or prose cannot manufacture a sale.
- `pidio_no_contactar` converges through the existing consent/revocation path before any post-call outbound.
- `email_capturado` may update only the correlated contact after validation and must converge with the four-column Sheet projection.
- Tool-time `registrar_resultado` and webhook-time `call_analyzed` remain idempotent and cannot produce duplicate post-call messages or rows.
- Transcript/audio remain discarded.
- Add PostgreSQL integration coverage for replay, out-of-order lifecycle, cross-tenant attempts, payment truth, consent revocation, and one complete Agent A -> call -> analysis -> follow-up -> Sheet path.

## Task 4: Release readiness

**Acceptance:**

- Root unit/integration suites, typecheck, lint, production build, Botpress check/build, and diff check pass freshly.
- Review the complete branch diff for security, tenant isolation, idempotency, and side effects.
- Report the remaining live-only inputs: dedicated Retell API key, selected Retell number or dashboard web-call access, Retell URL/secret update, Retell publication, and WhatsApp Cloud credentials.
- Stop at the release checkpoint. Present merge/push/deploy choices; do not publish implicitly.

