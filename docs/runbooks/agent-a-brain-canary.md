# Canary del cerebro conversacional del Agente A

Este runbook prepara una activación reversible del Agente A sin modificar
Retell, el `VoiceProvider` ni la frontera del Agente B. No autoriza por sí solo
push, migraciones remotas, deploy ni mensajes reales.

## Precondiciones obligatorias

1. Backend y Botpress deben construirse desde el **mismo SHA** aceptado.
2. La migración aditiva de estado/fallback y los jobs de memoria deben existir
   en el destino. No se revierten tablas para hacer rollback.
3. Botpress debe tener `DEEPSEEK_API_KEY` por presencia, sin imprimir el valor.
   El modelo primario esperado es `deepseek-v4-flash` y el prompt activo es
   `studyx-agent-a-brain-v4`.
4. Las tres corridas visibles y las tres held-out deben corresponder al SHA
   congelado: hard gates 20/20, cero silencio accidental/promesas falsas,
   p95 menor a 6 s, reparación no mayor al 5 %, y
   `conversation_quality_complete=true` con al menos 18/20 aprobadas.
5. Lint, unitarias/contratos, integración PostgreSQL, ambos typechecks,
   `adk check`, `adk build` y tres ciclos de migraciones deben estar verdes.

## Flags y modos

El brain conserva su rollback base:

| Modo | `AGENT_A_BRAIN_V1_ENABLED` | `AGENT_A_BRAIN_V1_SHADOW` |
| --- | ---: | ---: |
| Legacy | `false` | `false` |
| Shadow | `false` | `true` |
| Autoritativo | `true` | `false` |

Ambos en `true` es configuración inválida y debe fallar readiness. Sobre el
modo autoritativo se activan, de a uno:

| Orden | Flag | Capacidad |
| ---: | --- | --- |
| 1 | `AGENT_A_CONTEXT_SCOPING=true` | Contexto mínimo y `intake_missing`. |
| 2 | `AGENT_A_STATE_ASSERTIONS=true` | Hechos de estado/proceso con commit-before-outbound. |
| 3 | `AGENT_A_REPAIR_ENABLED=true` | Una reparación validada; nunca una segunda. |
| 4 | `AGENT_A_SINGLE_ROUTE=true` | Desactiva la ruta conversacional legacy sin borrarla. |

## Verificación local

La key se carga sólo en `.eval/.env.local`. Los scripts rechazan producción,
credenciales de canal/efectos, links Stripe reales, API ocupada y SHA distinto.

```bash
scripts/eval-agent-a.sh studyx-agent-a-conversational-baseline 3 base
scripts/eval-agent-a.sh studyx-agent-a-conversational-baseline 3 rep --repair
scripts/eval-agent-a.sh studyx-agent-a-brain-v1-heldout 3 heldout --repair

npm run lint
npm run test:unit
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55435/studyx_test npm run test:integration
npm run typecheck
npm --prefix botpress-agent run typecheck
npm --prefix botpress-agent run check
npm --prefix botpress-agent run build
STUDYX_MIGRATION_LOOP_PORT_BASE=55532 bash scripts/verify-native-postgres-loop.sh
```

La evaluación usa `--strict-brain-provider deepseek`: un fallback de proveedor
no puede convertir una falla de DeepSeek en un verde. Los transcripts redactados
se califican por un humano o modelo distinto; DeepSeek no se autoaprueba.

## Activación supervisada

1. Obtener autorización separada para push, migración, deploy, secretos y un
   mensaje Telegram.
2. Aplicar la migración aditiva y desplegar Vercel; exigir `/api/health` con el
   SHA esperado y `/api/ready` verde.
3. Desplegar Botpress desde el mismo SHA, con brain autoritativo y los cuatro
   flags nuevos inicialmente en `false`.
4. Activar los flags en el orden de la tabla. En cada paso trazar un turno
   seguro y verificar propuesta, validación, commit durable y outbound visible.
5. Recién con los tres primeros pasos verdes activar `AGENT_A_SINGLE_ROUTE`.
6. Ejecutar una conversación supervisada: descubrimiento, curso, oferta de
   llamada, preferencia chat, pagos y postergación. No pagar ni llamar realmente.

## Observabilidad

Registrar sólo códigos y tiempos: proveedor/modelo, SHA, ruta, rechazo,
reparación, fallback, transición de oferta, acción autorizada y
`event_to_visible_outbound_ms`. Nunca prompt, texto del cliente, PII, tokens ni
bodies del proveedor.

## Rollback

Ante un hard failure, apagar en **orden inverso** y verificar readiness después
de cada cambio:

```text
AGENT_A_SINGLE_ROUTE=false
AGENT_A_REPAIR_ENABLED=false
AGENT_A_STATE_ASSERTIONS=false
AGENT_A_CONTEXT_SCOPING=false
```

Si el problema persiste, volver el brain a legacy con
`AGENT_A_BRAIN_V1_ENABLED=false` y `AGENT_A_BRAIN_V1_SHADOW=false`. La ruta
anterior permanece en el código hasta que held-out y canary sean verdes. No
borrar datos, no revertir migraciones aditivas y no tocar Agente B.
