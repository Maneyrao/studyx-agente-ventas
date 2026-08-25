# Informe — Suite v11 de 30 clientes realistas (Agente A)

Fecha: 2026-08-23/24
Prompt bajo prueba: `studyx-agent-a-sales-v11` (bump desde v10 por cambios de contrato conductual; ver "Cambios aplicados")
Suite: `botpress-agent/evals/personas/studyx-realistic-customers-v11.json` (sin modificaciones)
Entorno: Botpress Development + Next.js local (127.0.0.1:3000) + PostgreSQL desechable (127.0.0.1:55433/studyx_test)

## Veredicto

**NO APROBADO — bloqueado por infraestructura.**

Ninguna ronda limpia de 30 casos pudo completarse: el workspace de Botpress
Development agotó su límite de gasto de IA durante la primera corrida y todo
turno que requiere modelo devuelve el fallback técnico desde entonces. Los
defectos P0/P1 del informe anterior fueron corregidos en código y verificados
por tests unitarios y por evidencia parcial de PostgreSQL, pero la validación
conversacional de punta a punta 30/30×3 queda pendiente hasta que se levante
el límite de gasto del workspace.

## Bloqueo de infraestructura (causa raíz)

- Error literal en `cognitive.request` (traces `c5eb731d…` 20:39, `ed023333…` 22:05):
  `Workspace of bot ID b9e75642-da77-4748-a61c-f408d09ef7ca has reached its usage limit for ai spend`
- Afecta a toda la cadena de failover (`google-ai:gemini-3.6-flash` →
  `google-ai:gemini-3.5-flash` → `anthropic:claude-haiku-4-5`): las tres pasan
  por claves administradas por Botpress y facturan al mismo workspace. Las
  integraciones instaladas (google-ai, anthropic, openai, groq, cerebras)
  tienen `config: {}` — no existe una vía BYO-key para esquivar el límite.
- Protocolo de reintentos cumplido: 20:38, 20:40, 21:16, 22:05 (más una espera
  cruzando la medianoche UTC). El límite no se restableció.
- El fast-path determinista (saludo) sigue funcionando: el pipeline completo
  Botpress → Next.js → PostgreSQL está sano; sólo la generación con modelo está
  bloqueada.
- **Remediación (requiere acción humana):** subir el límite de AI spend del
  workspace en el dashboard de Botpress (o esperar su ciclo de reset) y
  relanzar el loop desde `realistic30-loop02`.

## Resultado por ronda

| Ronda | run-id | Resultado |
|---|---|---|
| 1 | `realistic30-loop01` | **Abortada/inválida.** Arrancó como baseline con código v10; a mitad de corrida (≈caso 12) el workspace agotó el gasto de IA y todos los turnos posteriores degradaron a fallback técnico. Además quedó contaminada porque los fixes de backend entraron por hot-reload durante la corrida. Sin JSON final (proceso detenido). |
| smoke | `smoke01` (1 caso, `real11_03`) | 0/1 — los 4 turnos devolvieron fallback técnico por el límite de gasto. **La captura de identidad y la persistencia funcionaron igualmente** (ver evidencia). |
| 2-10 | — | **No ejecutadas: bloqueo de infraestructura.** |

Tally final: 0 rondas limpias completadas; 0/3 corridas 30/30 consecutivas.

## Defectos conocidos: estado tras esta sesión

| # | Defecto (informe 2026-08-23) | Estado | Corrección |
|---|---|---|---|
| 1 | Falso opt-out con "no me mandes el link todavía" | **Corregido + test** | `src/lib/heuristics/opt-out.ts`: "no me mandes" sólo revoca consentimiento con objeto de mensajería general; se agregó además "sacame/borrame de la lista" como opt-out real (caso 26 turno 4). |
| 2 | "un único pago" no reconocido como contado | **Corregido + test** | `src/features/payments/domain/payment-choice-policy.ts` + espejo en botpress-agent, con test de paridad. |
| 3 | Silencio ante decisión inválida / 422 de pago | **Corregido + test** | `botpress-agent/src/workflows/processInboundTurn.ts`: gate local (`payment-choice` espejo) degrada un `send_payment_link` no autorizado a `clarification` determinista antes del commit; el 422 del backend queda como última defensa. |
| 4 | Links ante elecciones ambiguas | **Corregido + test** | Mismo gate: `AMBIGUOUS_OR_ABSENT_CHOICE` y `PLAN_MISMATCH` nunca envían link ni callan; piden confirmar una de las tres opciones. |
| 5 | Nombre/apellido/email/interés no persistidos | **Corregido + test + evidencia DB** | Captura determinista en ingesta (`src/lib/heuristics/contact-identity.ts` + `ingestion.service.ts`): "Soy Nombre Apellido, email" → `contacts.name/email`. Conservadora: exige verbo de presentación o nombre capitalizado pegado al email; nunca inventa. |
| 6 | Afirmar registro con DB vacía | **Mitigado (prompt v11)** | Regla dura: sólo afirmar registro cuando `context.contact.name` está presente (que ahora refleja la persistencia real); prohibido escribir el email del cliente en una respuesta. Verificación conversacional pendiente. |
| 7 | `offering_sku` descartado en Sheets | **Corregido + test** | `decision.service.ts`: la señal de proyección lleva `offering_sku` y lo resuelve al `display_name` canónico del catálogo; prompt v11 exige el `code` exacto del offering elegido. |
| 8 | Memoria vectorial en turnos posteriores | **Sin cambios; pendiente de validar** | Requiere rondas con modelo (casos 12, 28, 29). |
| 9 | Política de devolución inventada | **Mitigado (prompt v11)** | Regla dura fail-closed: nunca afirmar NI negar devolución/garantía; derivar al equipo de inscripciones. Verificación conversacional pendiente (caso 17). |
| 10 | Saludos repetidos / presión de llamada | **Sin cambios nuevos** | `withoutRepeatedGreeting` ya existía; pendiente de medición en rondas. |
| 11 | desk-hitl 404 | **Aislado, no resuelto** | Aparece como `botpress.client 404` post-commit en los traces; no afecta la respuesta del turno. Pendiente decidir si se deshabilita el plugin `desk-hitl` (no hay cola humana en el producto). |
| 12 | Identidad sintética por conversación | **Reforzado** | El runner ya registraba `sandbox_identities` por caso; ahora verifica también nombre/email/curso e ids de trace por decisión. |

## Cambios aplicados (archivos)

Backend Next.js:
- `src/lib/heuristics/opt-out.ts` — falso opt-out corregido; nuevas frases de baja real.
- `src/lib/heuristics/contact-identity.ts` — **nuevo**: extracción determinista de nombre/email + `splitFullName`.
- `src/lib/services/ingestion.service.ts` — captura de identidad en la transacción de ingesta (last-wins, nunca borra) + refresco de proyección de identidad post-transacción.
- `src/lib/services/projection.service.ts` — campos comerciales opcionales con merge sobre payload existente; **nuevo** `refreshLeadIdentityProjection` (sólo refresca filas ya existentes; nunca crea leads por identidad sola; falla suave).
- `src/lib/services/decision.service.ts` — la señal `payment_link_sent` proyecta `nombre/apellido/email` del contacto y `curso_interes` canónico resuelto desde `offerings` por `offering_sku`.
- `src/features/payments/domain/payment-choice-policy.ts` — variante "un único pago".

Botpress ADK:
- `botpress-agent/src/utils/payment-choice.ts` — **nuevo** espejo del policy determinista (con test de paridad que lo ata al backend).
- `botpress-agent/src/workflows/processInboundTurn.ts` — downgrade determinista de `send_payment_link` no autorizado a clarificación (nunca silencio, nunca link).
- `botpress-agent/src/prompts/agent-a-sales-bridge.ts` — **v11**: devoluciones fail-closed con derivación a inscripciones; honestidad de registro de datos y prohibición de eco del email; `offering_sku` obligatorio cuando el offering está identificado.

Runner / verificador (sólo reforzado, nada debilitado):
- `scripts/lib/agent-a-conversation-runner.ts` — tipo `customer` cableado; latencia por turno registrada (`turn_latencies_ms`); aserción automática de que el email del cliente nunca se ecoa.
- `scripts/lib/agent-a-persistence-verifier.ts` — nuevas aserciones: `contacts.name/email` persistidos cuando el cliente los entregó; identidad y `curso_interes` canónico en la fila de Sheets; `trace_id` presente en todas las decisiones.
- `scripts/run-agent-a-conversations.ts` — trae la nueva evidencia (name/email del contacto, nombre/apellido/email/curso del payload de Sheets, decisiones con trace) y pasa el `runId` al verificador.

## Pruebas de regresión agregadas

- `tests/unit/heuristics/opt-out.test.ts` — 4 casos de deferral-de-link que no son opt-out + 4 frases de baja real (incl. "Sacame de la lista").
- `tests/unit/heuristics/contact-identity.test.ts` — **nuevo**, 10 tests (capturas válidas, falsos positivos rechazados, split nombre/apellido con apellidos compuestos).
- `tests/unit/payments/payment-link.test.ts` — "un único pago" en 3 variantes.
- `tests/unit/botpress/payment-choice-mirror.test.ts` — **nuevo**: paridad espejo/backend sobre corpus de 24 frases.
- `tests/unit/botpress/process-inbound-turn-hot-path.test.ts` — 3 tests del downgrade (ambiguo → clarificación, mismatch → clarificación, elección válida → acción intacta).
- `tests/unit/botpress/agent-a-sales-bridge-prompt.test.ts` — 3 tests de las reglas v11.
- `tests/unit/scripts/agent-a-persistence-verifier.test.ts` — 4 tests nuevos (identidad no persistida, fila de Sheets sin identidad/curso, identidad no exigida cuando no fue entregada, trace_id faltante).

Verificación al cierre (todo verde):
`npm run test:unit` (795 passed / 7 skipped), `npm run typecheck`, `npm run lint`,
`cd botpress-agent && npm run typecheck`, `adk check` (valid), `cd botpress-agent && npm run build`,
`npm run build` (producción Next.js).

## Evidencia de PostgreSQL (smoke `smoke01`, caso real11_03, aún bajo fallback de modelo)

- `contacts`: `name='Diego Farías'`, `email='diego.real11_03+smoke01@example.com'` — capturados determinísticamente pese a que el modelo estaba caído.
- 4 inbound / 4 outbound / 4 decisiones, todas con `trace_id` (`decisions_with_trace=4`).
- `prompt_version` registrado: `studyx-agent-a-sales-v11`.
- Identidad sandbox registrada (`sandbox_identities`), teléfono sintético `+999…`.
- Sheets/memoria/link: no evaluables sin modelo (el turno degradó a fallback técnico, correctamente detectado por el runner como fallo del caso: no se relajó nada).

## Latencias

Única muestra íntegra (smoke01, 4 turnos, incluye ventana de batching + reintentos de modelo fallidos): 25.7s / 28.2s / 28.8s / 30.2s → p50 ≈ 28.5s, máx 30.2s. No representativas de operación normal (el modelo agotaba su timeout); las latencias reales deben medirse al reanudar las rondas — el runner ya las registra por turno (`turn_latencies_ms`).

## Tabla de los 30 clientes

Ningún caso tiene resultado válido de ronda limpia. Estado uniforme:
**pendiente — bloqueado por límite de gasto de IA del workspace** para los 30
casos (`real11_01` … `real11_30`). Los casos diseñados para ejercer defectos
conocidos (17 devolución, 26 opt-out real, 27 falso opt-out) tienen su
corrección de código con test unitario, pero su validación conversacional
sigue pendiente.

## Riesgos pendientes

1. **Bloqueo de gasto de IA** (arriba): sin acción humana no hay validación posible.
2. Reglas de prompt v11 (devoluciones, honestidad de registro, offering_sku) verificadas sólo estructuralmente: el comportamiento del modelo debe confirmarse en rondas reales.
3. Casos 25 y 29: la secuencia "elige plan → se arrepiente/cambia" depende de que el modelo no emita `send_payment_link` prematuro; el gate determinista lo degrada a clarificación (sin link), pero la aserción `no_payment_link_before_turn` podría requerir iteración de prompt.
4. `desk-hitl` 404 post-commit: ruido en traces; decidir deshabilitar el plugin.
5. La ronda 1 dejó ~29 contactos con decisiones de fallback en la DB desechable; usar run-ids nuevos (las corridas nuevas crean conversaciones e identidades nuevas, no interfieren).
6. Latencia por turno (~25-30s con ventana de batching): revisar presupuesto cuando el modelo vuelva.

## Cómo reanudar

1. Levantar el límite de AI spend del workspace Botpress (dashboard) — bot `b9e75642-da77-4748-a61c-f408d09ef7ca`.
2. `cd botpress-agent && adk dev` (el server quedó corriendo con el código nuevo; `--no-watch`).
3. Loop desde la ronda 2: `npm run test:agent-a -- --file botpress-agent/evals/personas/studyx-realistic-customers-v11.json --verify-db --database-url postgresql://postgres@127.0.0.1:55433/studyx_test --timeout 1m --run-id realistic30-loop02` (incrementar run-id por ronda; criterio: 30/30 en tres corridas consecutivas).
