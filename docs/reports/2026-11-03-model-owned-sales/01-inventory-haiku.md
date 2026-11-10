# Inventario read-only (Haiku) — HEAD 12d564b

Producido por un subagente Haiku de sólo lectura. Rutas relativas al worktree.

## A. Reglas comerciales en runtime
- Regla C (pregunta del precio): `decidePriceProbeRuleV1` src/shared/conversation/deterministic-sales-rules.ts:250. Disparo: regex `priceConcernTextV1` :155-165 O memoria `objection/price_objection` con cita (`draftRecordsPriceObjectionV1` :367). Control de "una vez" leyendo el historial saliente :259-266. Efecto: PRICE_PROBE_REQUIRED → reescritura → anexo fijo (`withPriceProbeV1` :276). Mezcla juicio por regex y permiso.
- Regla B (llamada forzada): `decideCallRuleV1` :648 (may_offer_call, call_offer_status, ventana `agentResponseOrdinalV1` :643). Regex de canal/llamada: deterministic-rules-turn.ts:94-96 (channel-preference-evidence.ts). Efecto: CALL_OFFER_REQUIRED → reescritura → `call_offer` fijo (`withFixedCallOfferV1` deterministic-rules-turn.ts:225).
- Regla A (bonificación): `decideBonusRuleV1` :423-466. Estado/permiso + disparadores por regex `priceExpressionHintV1` :447, :454. Efecto: BONUS_OFFER_REQUIRED → reescritura → reemplazo del turno completo.
- Tabla de afinidad: `BONUS_AFFINITY_TABLE_V1` :14-61, `MAX_RULE_BONUS_COURSES_V1`=3 :67, `bonusSequenceForPaidCourseV1` :70, `nextRuleBonusCodeV1` :81; usada en read-course-bonus-capability.ts:452 y direct-course-bonus-service.ts:312. Hecho/permiso.
- `promotionTaskV1` :539 (texto de prompt). `draftFulfillsPromotionTaskV1` :595-614: juicio por regex de calidad (PRICE_OPENING :586, DRY_BONUS_OPENING :590, "te entiendo", EXPENSE_COMPARISON :583, DISCOUNT_CLAIM :584, DEFENSIVE :585, PRICE_UNCHANGED :587, ADMINISTRATIVE_REGISTER_V1 :589, máx. 2 burbujas, máx. 1 "?"). Rechaza → reescritura → texto fijo.
- Cierres "?!" y tú: sólo prompt/texto fijo (:542-543, :552, :623).
- Regla D: `passiveRuleAppliesV1` :237, `PASSIVE_CLOSING` :217, `passiveClosingSentencesV1` :219 → reescritura → `withoutPassiveClosingV1` :225 borra oraciones. Juicio léxico.
- Regla E: `decideRetentionRuleV1` :683-697 (+ regex OPT_OUT_OR_END :677, INSULT :678); marca literal `RETENTION_MARKER_V1` :676; `draftFulfillsRetentionV1` :723; texto fijo `retentionOfferMessageV1` :708.
- Auxiliares: `bonusInterruptsDataCollectionV1` :381, `isCheckoutV1` :398, `draftPresentsBonusV1` :497.
- Ensamblado: `decideDeterministicRulesV1` botpress-agent/src/lib/conversation/deterministic-rules-turn.ts:81, `ruleRejectionV1` :124, `draftSatisfiesRulesV1` :159, contexto :24-62.
- Rutas sin modelo: `routeCommercialTurn` botpress-agent/src/utils/commercial-router.ts:613; fast paths transaction-fast-path.ts:367-543; llamado en processInboundTurn.ts:1204.
- Validador del brain: `validateAgentATurnProposalV1` agent-a-brain.ts:1732-2169.
- Censores backend: `enforceCommercialTruthV1` commercial-truth-guard.ts:573 (sólo decision.service.ts:1385, ruta no-v3). Egreso: `verifyAuthorizedEgress` egress-guard.ts:285; copia portable processInboundTurn.ts:3495-3510.

## B. Transformadores de mensajes
- Respaldo Regla A: `bonusFallbackProposalV1` deterministic-rules-turn.ts:186 / `bonusFallbackMessagesV1` deterministic-sales-rules.ts:616 — REEMPLAZA el turno.
- Respaldo C/D: `withFixedPriceRulesV1` deterministic-rules-turn.ts:170 — borra oraciones pasivas y ANEXA la pregunta.
- Último recurso: burbuja de pregunta de precio reemplaza el turno (`resolveDeterministicRulesTurnV1` :300-422). `withoutUnsupportedCourseLogisticsV1` :232.
- Plannerless: resolve-agent-a-plannerless.ts `resolveAgentAPlannerlessProposalV2` :469 (una reparación), `pruneRejectedActionV1` :652 (quita sólo la acción), `withoutUnsupportedPrerequisiteClausesV1` agent-a-brain.ts:1532.
- Composición legacy: `buildSafeAgentABrainCompositionV1` agent-a-brain.ts:1136; `transactionalFallback` :1269; `safeContextualOpening` :1285.
- `normalizeCustomerFacingSpanishV1` agent-a-brain.ts:863 (quita ¿ ¡).
- Backend: canonical-response-assembler.ts:328-330; vacío → TECHNICAL_FALLBACK_TEXT_V1 :488. Otros cortes: operational-promise-guard.ts :161, :261, :540; agent-turn-policy-v2.ts:358, :382.
- Nunca silencio: processInboundTurn.ts:2134 → `technicalFallback` decision-policy.ts:39; `modelUnavailableFallback` ~:280-296; `technicalContinuityFallback` :59-69 (usado :1981, :2874); technical-fallback.ts `resolveTechnicalFallbackV1` :48.
- Hueco: falla de egreso processInboundTurn.ts:3503-3510 → entrega fallida sin texto al cliente.

## C. Validadores de hecho / permiso / efecto
- agent-a-brain.ts: FACT_NOT_AUTHORIZED :1791, FACT_VALUE_MISMATCH :1823, ACTION_NOT_AUTHORIZED :1968, UNSUPPORTED_OPERATIONAL_CLAIM :1948/:2011, MISSING_INTAKE :2011, CALL_OFFER_MESSAGE_BOUNDARY_INVALID :2129, presupuesto de llamadas :2109, preferencia de canal :2112, respuesta repetida :1755.
- COURSE_ROLE_UNDECLARED: course-mentions.ts:42; agent-turn-policy-v2.ts:671-672; processInboundTurn.ts:471-473.
- Requisitos: agent-a-brain.ts:1097, :1494.
- Consentimiento: processInboundTurn.ts:460-462, :1092-1094, :2877-2879; commit-agent-turn-v3.ts:1123-1149.
- Link de pago: payment-link-claim.ts:32 (si dispara, rechaza la propuesta entera: resolve-agent-a-plannerless.ts:208, :652-673).
- accept_promotion: direct-course-bonus-service.ts:363-388. Límites :310, :326, swaps :52. Config course-bonus-flow-config.ts:16-21. Checkout :205, :219, :286, :288, :236, :273, :237, :335.
- Integridad: integrity-check-v3.ts:31 → commit-agent-turn-v3.ts:884/:896. Call-offer policy: call-offer-policy.ts:90 → claim-batch.ts:468.

## D. Estado reconstruido desde frases
- sales-flow-markers.ts:26-53 (pregunta del precio por texto saliente, sí/no por regex, retención por marca literal). Sin tests directos. Inyectado en read-course-bonus-capability.ts:669, :682-683, :731-735.
- deterministic-sales-rules.ts:250-274, AFFIRMATIVE :188, :690-691, :643. customer-bonus-request.ts:34, :36.

## E. Contexto al modelo
- `buildAgentAContextV1` agent-a-context.ts:476. Esquema botpress-agent/src/schemas/agent-a-brain.ts (turn :127, customer :150, commercial_state :179, catalog :250, capabilities :300). Objetivo/experiencia/interés sólo como memorias.
- `buildAgentABrainInstructionsV1` agent-a-brain-v1.ts:401; tareas :304; reparación :166-197.

## F. Tests
Ver el informe del subagente: deterministic-sales-rules.test.ts, deterministic-rules-turn.test.ts, deterministic-sales-rules-runtime.test.ts, zero-silence.test.ts, agent-a-brain*.test.ts, resolve-agent-a-plannerless.test.ts, direct-course-bonus-*.test.ts, customer-chosen-bonus.test.ts, goldens evals/golden/owner-rules-scenarios.ts (casos 17–26).

## G. Versiones
brain v157 agent-a-brain-v1.ts:10; canónico v103 (generated.ts ×2); provenance scripts/lib/botpress-release-provenance.mjs:153 + REVIEWED_SOURCE_HASHES :13-16; scripts/generate-release-manifest.mjs:146-150; pins en tests (agent-a-brain-prompt.test.ts:441, botpress-release-provenance.test.ts:93, etc.).

## Banderas
1. El encabezado dice que la pista de precio nunca dispara sola, pero dispara en :387, :447, :454 y abre la Regla C en :156/:169.
2. Energía/tú sólo en el prompt.
3. `evaluateSalesObjectionTurnV1` sin llamador en runtime.
4. Coexisten commit-agent-turn-v3 y decision.service; no verificado cuál está vivo.
5. `readSalesFlowFlagsV1` sin test directo.
