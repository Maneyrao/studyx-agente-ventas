# Canary de Agent A Brain V2

Este runbook activa el cerebro conversacional sin cambiar la frontera del Agente B.
No contiene secretos ni autoriza un smoke real por sí solo.

## Precondiciones

1. El mismo SHA debe estar construido en backend y Botpress.
2. Las migraciones aditivas de `conversation_sales_context_*_v1` y los jobs de
   memoria deben existir en la base destino.
3. Deben estar presentes, sin imprimir valores: la key HMAC del orquestador, el
   signing secret, `OPENAI_API_KEY`, credenciales PostgreSQL y credenciales de canal.
   La clave de OpenAI se configura directamente en Botpress y no se guarda en Git.
4. Gates locales: 20/20 conversaciones held-out; naturalidad >=18/20; p95 del
   cerebro <=6 s; unitarias, integraciones seleccionadas, ambos typechecks y
   `adk check/build` verdes.

## Modos

| Modo | `AGENT_A_BRAIN_V1_ENABLED` | `AGENT_A_BRAIN_V1_SHADOW` | Efecto |
|---|---:|---:|---|
| Apagado | `false` | `false` | Camino anterior; rollback inmediato. |
| Shadow | `false` | `true` | Evalúa una propuesta, no planifica ni muta estado. |
| Canary | `true` | `false` | Brain V2 autoritativo con planner y egress backend. |

La configuración que activa ambos flags es inválida y debe fallar readiness.

## Verificación local

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/studyx_test \
  npx tsx scripts/run-agent-a-conversations.ts \
  --suite studyx-agent-a-brain-v1-heldout \
  --transport local --provider groq --verify-db \
  --database-url postgresql://postgres:postgres@127.0.0.1:55432/studyx_test \
  --min-turn-interval-ms 60000

npm run test:unit
npm run typecheck
npm --prefix botpress-agent run typecheck
cd botpress-agent && adk check && adk build
```

El cerebro usa `gpt-5.6-terra` y hace un único failover acotado a
`gpt-5.6-luna`. Los 429 se registran como fallos de transporte; nunca se
convierten en éxito conversacional. `--provider groq` sólo conserva el camino
de compatibilidad para decisiones legacy fuera de Brain V2.

## Activación y observación

1. Aplicar migraciones aditivas verificadas.
2. Desplegar backend y comprobar `/api/health` y `/api/ready` con el SHA esperado.
3. Verificar por presencia que Botpress tiene `OPENAI_API_KEY` y desplegar con
   el mismo SHA/configuración.
4. Activar shadow, observar logs estructurados sin texto de cliente.
5. Con aprobación humana separada, pasar a canary autoritativo.
6. Ejecutar una sola conversación supervisada: información de curso → preferencia
   chat → continuación. No incluir pago, Sheets ni llamada real en ese smoke.
7. Confirmar `event_to_visible_outbound_ms < 8s`, un outbound visible y cero
   acciones protegidas no autorizadas.

## Señales y rollback

Observar `brain_source`, `brain_failure_reason`, `brain_model`,
`call_offer_transition`, `authorized_action_type`, `agent_a_brain_ms` y el SHA.
Nunca registrar prompt, mensajes, claves ni bodies del proveedor.

Ante regresión, fijar ambos flags en `false`, volver a desplegar sólo la capa cuya
configuración cambió y comprobar readiness. Las tablas V1 y jobs son aditivos: no
se borran ni se revierten para apagar el camino. El puerto `VoiceProvider` y los
outbounds de Lucas permanecen sin cambios.
