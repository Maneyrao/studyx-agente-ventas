# Task 2.13 — preparaciones restantes

## Resultado

Se implementaron las cuatro preparaciones pendientes sobre
`agent_turn_preparations`:

- `prepareContactDetailsToolV1` reserva `recorded` y `still_missing` sin
  modificar el contacto. El cálculo combina el intake durable con los campos
  propuestos y usa el contrato compartido de cuatro campos.
- `prepareCallRequestToolV1` reserva un `call_id` y `status: reserved`. No crea
  `call_sessions`, `call_events`, decisión, outbound, delivery ni outbox.
- `prepareMemoryToolV1` conserva los IDs generados para cada candidato y la
  relación `supersedes`; un replay devuelve exactamente el mismo artefacto.
- `prepareLeadProjectionToolV1` reserva `{ queued: false }` y no ejecuta la
  proyección.

Las cuatro usan una única frontera de reserva. La sentencia de inserción deriva
la conversación y el contacto desde un turno inbound, exige membresía activa y
exactamente un workspace activo, y vuelve a comprobar todo junto con el
`INSERT`. Contacto y llamada validan además que el `contact_id` declarado sea el
contacto autoritativo. Un conflicto idempotente sólo se acepta cuando la fila
existente pertenece al mismo turno.

## TDD

RED inicial contra el source sin las cuatro funciones:

```text
tests/integration/agent-tools-prepare-rest.test.ts
1 archivo FAIL; 5/5 tests FAIL
TypeError: prepareContactDetailsToolV1 / prepareCallRequestToolV1 /
prepareMemoryToolV1 / prepareLeadProjectionToolV1 is not a function
```

Después del mínimo funcional se agregaron mutaciones discriminantes para no
dar por probada la autoridad sólo con un caso feliz: turno de otra
conversación, `contact_id` ajeno y dos workspaces activos. Cada una de las
cuatro herramientas falla cerrado y deja cero reservas. Los caminos felices se
ejecutan con `SET LOCAL ROLE orchestrator_role`.

GREEN final:

```bash
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/studyx_test' \
  npx vitest run --config vitest.integration.config.mts \
  tests/integration/agent-tools-prepare-rest.test.ts \
  tests/integration/agent-tools-prepare.test.ts
# 2 archivos PASS; 17/17 tests PASS
```

La suite nueva aporta 6 casos y cubre éxito, duplicado, inercia, conservación
de IDs/supersedes y autoridad de turno/contacto/workspace. La suite previa de
pago aporta 11 regresiones y permaneció verde.

## Verificación

```text
npx tsc --noEmit                                      PASS
(cd agent-core && npx tsc --noEmit)                   PASS
(cd botpress-agent && npm run typecheck)              PASS
npx eslint <source> <test nuevo> --max-warnings=0     PASS
git diff --check -- <source> <test nuevo>             PASS
fixtures residuales workspace slug task-2-13-%        0
```

La única base usada fue
`postgresql://postgres@127.0.0.1:55433/studyx_test`. No se leyó configuración
de producción, no hubo APIs pagas, remoto ni despliegue.

## Archivos

- `src/features/conversation/application/agent-tools-prepare.ts`
- `tests/integration/agent-tools-prepare-rest.test.ts`
- `.superpowers/sdd/2026-09-04-agent-a-agent-loop/task-2.13-report.md`
