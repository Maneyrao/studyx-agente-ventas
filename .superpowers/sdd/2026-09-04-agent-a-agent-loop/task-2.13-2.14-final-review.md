# Revisión final independiente — Tasks 2.13 y 2.14

Fecha: 2026-09-05

HEAD revisado: `d20d47198b8f91a73ddd2b127b02112329d9a940`

Commits principales: `4b602b54fdbb3aae98d2414cc6a40c06041d1d4c` y `fbbafcc907bb5e9430e5ee27af46f132a1cdb8f6`

Follow-ups inspeccionados hasta HEAD: incluidos. En particular, `24ef32d` agrega la evidencia del prompt efectivo al commit pero no implementa efectos para las cuatro preparaciones restantes. Los commits posteriores a `47b8b2f` sólo agregan informes/evidencia y no cambian el código revisado.

## Veredicto

| Alcance | Spec compliance | Calidad | Resultado |
|---|---|---|---|
| Task 2.13 | **FAIL** | **FAIL** | Las cuatro reservas se crean de forma inerte y con buena autoridad de workspace/turno, pero ninguna de las cuatro adquiere su efecto durable cuando el turno la incluye en `commit_preparations`. Llamada además no puede atravesar el commit por el whitelist de `response_type`. |
| Task 2.14 | **PASS** con la semántica de fallback posteriormente autorizada | **PASS**, con un gap P2 de prueba | Concurrencia optimista, expiración acotada y recuperación del fallback funcionan en PostgreSQL local. El test de crash no demuestra todavía la coherencia del turno siguiente. |
| Cierre conjunto | **FAIL / no habilitable** | **FAIL** | Task 2.13 deja una frontera crítica incompleta; los verdes actuales prueban reservas, no sus efectos al aceptar el turno. |

No encontré P0.

## Findings priorizados

### [P1] El commit sólo materializa pago; las otras cuatro preparaciones quedan marcadas como committed sin ejecutar su efecto

La spec §3.3 separa preparación y efecto: preparar debe ser inerte, pero el orquestador debe ejecutar exactamente las preparaciones listadas, una sola vez y dentro de la transacción de decisión, y encolar las proyecciones externas. La revisión previa de Task 2.10 ya dejó esta deuda expresamente asignada a Task 2.13 (`task-2.10-review.md:58`). El brief de Task 2.13 también dice que `reserveCallForDecision` debe ocurrir en el commit (`task-2.13-brief.md:106-108`).

En HEAD, `renderableArtifacts` sólo decodifica `prepare_payment_link` (`commit-agent-turn-v3.ts:300-313`), `committedPayment` sólo materializa artefactos de pago (`:684-686`) y el bloque común únicamente actualiza `committed_at` para todos los IDs (`:716-730`). El único efecto especializado posterior es `send_payment_link` más `payment_projection_jobs` (`:745-751`, `:806-835`). No existe allí una rama para contacto, llamada, memoria o lead.

El bloqueo abarca **las cuatro preparaciones**, no sólo llamada:

| Preparación | Comportamiento actual al aceptarla | Contrato durable esperado al aceptar el turno |
|---|---|---|
| `prepare_contact_details` | La fila queda `committed_at != NULL`; `contacts` no cambia. Además la reserva persiste sólo `recorded[]`/`still_missing[]`, no los valores propuestos (`agent-tools-prepare.ts:247-260`). | Los valores normalizados y autorizados de esa reserva deben quedar aplicados al contacto autoritativo dentro de la transacción aceptada, o quedar en un job durable equivalente. La reserva debe conservar suficiente valor/procedencia para hacerlo. Una preparación no listada debe permanecer sin efecto. |
| `prepare_call_request` | Tiene un bloqueo adicional: la integridad exige coherencia entre `call_confirmation` y la preparación (`integrity-check-v3.ts:142-148`), pero `call_confirmation` no está en `STORED_RESPONSE_TYPES` (`commit-agent-turn-v3.ts:87-97`), por lo que el commit termina en `RESPONSE_TYPE_NOT_AUTHORIZED` (`:696-699`). Aun superado eso, no se crea `call_sessions` ni su evento. | El commit debe reservar atómicamente la llamada mediante la frontera durable existente (`reserveCallForDecision`) y crear los registros internos requeridos, sin hacer despacho de red en esa transacción. Reintento/replay debe conservar exactamente una reserva por turno/decisión. |
| `prepare_memory` | La fila queda committed; no se crea `agent_a_memory_projection_jobs`, no se activan candidatos y no se desactivan los IDs de `supersedes`. | La misma transacción debe dejar el trabajo durable de memoria con IDs aceptados y relación exacta `supersedes`; el proyector posterior activa los nuevos recuerdos e invalida los superados. Sin commit no debe existir ese job/efecto. |
| `prepare_lead_projection` | La fila queda committed con `{ queued:false }`; no se crea trabajo durable de proyección. | El artefacto preparado sigue siendo `{ queued:false }`; al aceptarlo, el commit debe encolar una única proyección durable/outbox para el lead, sin llamar Sheets ni otra dependencia externa dentro de la transacción. |

Repro discriminante efímero, ejecutado contra el árbol exacto de `47b8b2f` y PostgreSQL local, agregó dos casos sin tocar el worktree: (1) confirmar una llamada preparada y (2) commitear el nombre `Ana`. Resultado: **2/2 FAIL esperados**. El primero devolvió `AgentTurnV3RejectedError: RESPONSE_TYPE_NOT_AUTHORIZED`; el segundo produjo `{ name: null, committed: true }`. El probe fue eliminado después de ejecutarse.

Los seis tests de `agent-tools-prepare-rest.test.ts` no capturan el defecto porque terminan después de preparar. Es correcto que comprueben cero efectos antes del commit (`:118-219`, `:222-300`), pero falta una segunda mitad que invoque `commitAgentTurnV3` para cada herramienta y compruebe el efecto durable exacto y el descarte de reservas no listadas.

### [P2] La autoridad técnica de memoria y su clave idempotente no representan todo el pedido

`prepareMemoryToolV1` sólo valida que cada `supersedes` tenga forma de UUID (`agent-tools-prepare.ts:288-303`); no prueba que ese ID pertenezca a una memoria autorizada del mismo workspace/contacto. Además la `canonical_key` usa únicamente los textos (`:305-321`): dos pedidos con igual texto pero distinto `type` o distinto `supersedes` colisionan y el segundo recibe el artefacto anterior como duplicado.

Esto es material para la regla de §3.10 según la cual una corrección debe invalidar la memoria anterior antes del turno siguiente. Un test discriminante debe cambiar sólo `type` y luego sólo `supersedes`, y debe intentar superseder un UUID existente de otro contacto/workspace; el resultado no puede reutilizar silenciosamente el primer artefacto ni aceptar autoridad ajena.

### [P2] El test de crash prueba expiración e inercia, pero no la coherencia del turno siguiente exigida por §6

`agent-loop-prepare-crash.test.ts:15-95` prepara, simula antigüedad, expira y comprueba que sobreviven la reserva committed y la fresca. Eso discrimina bien la limpieza. Sin embargo termina después del `DELETE`: no vuelve a preparar la misma clave desde un nuevo turno ni la commitea. La tabla de §6 exige además que “el turno siguiente es coherente”.

La extensión mínima es ejecutar un nuevo turno tras expirar, reservar la misma clave canónica y aceptar su commit, verificando un único efecto durable y ningún conflicto con la reserva eliminada.

## Aspectos conformes

### Task 2.13

- `loadAuthorizedContact` y `reserveAuthorized` atan turno inbound, conversación, contacto, membresía activa y un único workspace (`agent-tools-prepare.ts:83-205`). Los tests cubren turno/contacto ajenos y workspace ambiguo (`agent-tools-prepare-rest.test.ts:303-390`).
- La idempotencia del mismo turno devuelve el mismo `preparation_id` y el mismo `canonical_data`; un conflicto de otro turno falla cerrado.
- La preparación de llamada es realmente inerte: no crea sesión, evento, decisión, outbound, delivery ni outbox antes del commit (`agent-tools-prepare-rest.test.ts:153-219`).
- Contacto, memoria y lead respetan igualmente la inercia antes de aceptar el turno. Los artefactos públicos coinciden con §3.3.

### Task 2.14

- El test de concurrencia usa conexiones independientes: exactamente un commit gana con la versión inicial, el segundo recibe `STATE_VERSION_CONFLICT` y el retry con versión nueva se acepta.
- La expiración valida una edad entera positiva (`agent-tools-prepare.ts:342-355`) y delega a una función `SECURITY DEFINER` por workspace. La migración restringe ejecución a `orchestrator_role` y elimina sólo filas antiguas no committed de conversaciones con autoridad inequívoca (`20260905000004_agent_turn_preparations.sql:84-152`). El cron la ejecuta antes de las otras reconciliaciones.
- El test de fallback conserva curso, plan, etapa, preferencias, estado de oferta y espera; sólo avanza versión/contador técnico. El turno saludable siguiente entrega, reinicia el contador y conserva esos campos.
- La spec escrita en §3.8/§6 todavía dice “estado sin tocar”. Para esta revisión prevalece la instrucción posterior y específica del coordinador para Task 2.14: preservar campos comerciales y avanzar únicamente contador/versionado técnico. Bajo esa autoridad más reciente, el comportamiento es conforme; la discrepancia documental debería corregirse para que futuros reviewers no reviertan la semántica vigente.

## Evidencia reproducida

Sólo se usó `postgresql://postgres@127.0.0.1:55433/studyx_test`; no hubo API paga, DB remota ni despliegue.

```text
HEAD de código ejecutado: 47b8b2f3098443bb9d35c50b58e8f742fbcac215
HEAD final inspeccionado: d20d47198b8f91a73ddd2b127b02112329d9a940
# Entre ambos sólo cambiaron dos archivos de documentación/evidencia.

TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test \
  npx vitest run --config vitest.integration.config.mts \
  tests/integration/agent-loop-concurrency.test.ts \
  tests/integration/agent-loop-prepare-crash.test.ts \
  tests/integration/agent-loop-fallback-recovery.test.ts \
  tests/integration/agent-tools-prepare.test.ts \
  tests/integration/agent-tools-prepare-rest.test.ts \
  tests/integration/agent-loop-fallback-commit.test.ts
# PASS: 6 archivos, 23/23 tests

npx tsc --noEmit
# PASS

(cd agent-core && npx tsc --noEmit)
# PASS

npx eslint <2 sources + cron + 4 tests>
# PASS

git diff --check 4b602b5^..HEAD -- <alcance revisado>
# PASS

probe efímero commit contacto/llamada
# RED esperado: 1 archivo, 2/2 tests FAIL
# llamada: RESPONSE_TYPE_NOT_AUTHORIZED
# contacto: { name: null, committed: true }
```

La suite verde demuestra correctamente reserva inerte, autoridad, expiración, conflicto optimista y recuperación. No demuestra el contrato central faltante de Task 2.13: transformar cada preparación seleccionada en su efecto durable exactamente una vez.
