# Prioridades 1–4 aplicadas, sin generación ni despliegue

Código evaluado: `1a24d763045193aa134a85021229ad5c259c8bb3`, rama `codex/studyx-bonus-staged-release`. El commit posterior de evidencia conserva exactamente ese código. Prompt canónico `studyx-agent-a-canonical-v101` y marcador de brain/prompt `studyx-agent-a-brain-v145`, sin cambios. La identidad de este cambio de backend la da el SHA; no se modificó el modelo de producción.

## Cambios

| Prioridad | Implementación | Garantía conservada |
|---|---|---|
| 1. Respuestas completas | `literalConversationVariants` se reemplazó por `completeConversationProposals`: devuelve únicamente la propuesta completa. Primero se pide la reparación acotada al agente; agotada, se revalidan candidatos completos del turno, empezando por el más reciente. Se retiró también la poda silenciosa de afirmaciones en la recuperación activa de `resolve-agent-a-plannerless`. | Un candidato con un hecho o efecto inválido sigue rechazado. No se elige una oración ni una burbuja para hacerlo pasar. Si ninguno completo resulta autorizado, queda la continuidad operativa no vacía. |
| 2. Postventa | Se quitó la whitelist positiva de frases sobre contraseña. Se validan credenciales, URLs, cursos efectivamente activados y que el cambio de contraseña no sea un requisito. Se conservan literalmente intro y sugerencia válidas; la sugerencia puede estar vacía. Los bloques añadidos contienen datos canónicos, sin bienvenida, contactos ni decoración impuesta. Un rechazo devuelve al agente la narrativa rechazada y su motivo para una reparación completa. | Fuente de pago/alta verificada, protección de credenciales, cursos bonificados confirmados, egress, entrega durable e idempotencia. No basta con mencionar un curso autorizado para legitimar otro acceso inventado. |
| 3. Confirmación de llamada | Una solicitud autorizada pasa por la redacción normal de Agent A. Se validan por separado el efecto y el progreso real del proveedor. La contingencia cuando no hay redacción es sólo “Recibí tu solicitud de llamada.” y pasa por `agent_turn_v2` con revalidación de consentimiento. | No confunde solicitud, despacho y conexión. No pierde el efecto autorizado por una caída del proveedor de texto ni lo ejecuta con consentimiento revocado. |
| 4. Contingencias | Se retiraron las defensas internas de la continuidad activa. Se pide una aclaración breve: “Qué dato o qué curso revisamos?” o, en comparación, “Qué dos cursos comparamos?”. Ante revocación confirmada y reparaciones agotadas, la continuidad es “Seguimos por acá.”. | Nunca silencio, sin afirmar acciones, precios, cursos ni resultados nuevos. Estas cadenas mínimas son la contingencia operativa expresamente autorizada por el usuario, no la redacción del flujo normal. |

Autoridad: P:17/19/206–212/228–230/236 y B:71/89–90, donde P es `docs/authority/prompt-agente-a-studyx-v2.md` y B es `docs/authority/spec-backend-bonificacion.md`. No se editaron esos documentos ni las expectativas de comportamiento golden. Las fixtures unitarias que protegían recortes o prosa fija se corrigieron con esas referencias. La eliminación de ¿/¡ se conserva según P:15.

La cobertura de llamada reveló un problema adicional dentro de esa prioridad: una reparación podía volver a construir consentimiento después de una negativa. El backend ahora rechaza ese efecto con `call_consent_revoked`/`call_consent_missing`. La continuidad de revocación tiene un marcador tipado, admite sólo conversación sin efectos y vuelve a comprobar la negativa actual; una autorización nueva concurrente no se pisa. Los tests cubren negativa, agotamiento de reparación, dos “sí” posteriores sin solicitud explícita, idempotencia y nueva autorización. No se agregaron reglas que juzguen cómo vender.

Las prioridades 5–6 del inventario siguen pendientes salvo la poda de la recuperación activa, retirada para que la prioridad 1 no recortara por otra vía. No se migraron los compositores ni las rutas heredadas restantes.

## Replay y pruebas

- [Tabla de los 19 turnos afectados](evidence/2026-10-31-four-priority-replay/casos-afectados.md), con borradores completos, entrega histórica, etapa actual, rechazos y alcance. [CSV](evidence/2026-10-31-four-priority-replay/casos-afectados.csv).
- [Tabla de todos los borradores](evidence/2026-10-31-four-priority-replay/por-borrador.md), [CSV](evidence/2026-10-31-four-priority-replay/por-borrador.csv), [datos reproducidos](evidence/2026-10-31-four-priority-replay/replay.json), [resumen](evidence/2026-10-31-four-priority-replay/resumen.json) y [controles](evidence/2026-10-31-four-priority-replay/checks.json).

| Control | Resultado |
|---|---|
| Unitarias y contratos | **4.871 aprobadas**, 17 omitidas y 7 pendientes (`todo`); 258 archivos aprobados, 2 omitidos. |
| Integración y replay de workflows con proveedores simulados | **922 aprobadas**, 1 omitida; 93 archivos aprobados, sobre PostgreSQL desechable con migraciones limpias y embeddings de fixture. |
| Postventa después del ajuste final de campos canónicos | 38 unitarias y 6 de integración aprobadas. Incluidas también en la repetición completa de unitarias del SHA. |
| Replay histórico sobre el SHA exacto, sin cambios de producto pendientes | **1 prueba aprobada**, 427 apariciones fuente conservadas; 59 son duplicados exactos del parcial rotulado v6 y no aumentan el impacto. |
| Tipos, lint, build de Next y validación offline ADK | Aprobados. |
| Revisión del arquitecto | Aprobada después de corregir hallazgos sobre consentimiento, recuperación completa y comprobación factual de postventa. Sin hallazgos materiales pendientes para estas cuatro prioridades. |

Una repetición de unitarias con el paralelismo por defecto agotó los 5 s de la prueba de descubrimiento ADK: 4.870 aprobadas y ese único timeout. Se repitió la suite completa con `--maxWorkers=2`, sin cambiar plazos ni código, y pasaron las 4.871. El incidente y los hashes de los logs están en `checks.json`.

Las cinco narrativas reconstruidas de postventa que antes caían por la whitelist ahora pasan el ensamblador y conservan intro y sugerencia completas. Los siete turnos con recorte histórico se revalidan sin generar subconjuntos de texto. En las cuatro confirmaciones históricas no existía borrador: el replay acredita el recibo mínimo del helper, mientras los tests locales cubren redacción simulada, rechazo, reparación, efecto y revocación. Las tres contingencias históricas ya no muestran la defensa interna.

El corpus contiene respuestas reales guardadas de evaluaciones v3–v8, **no chats de clientes de producción**. De los informes principales hay 368 intentos: 362 con texto y 6 errores del proveedor sin borrador. Se conservan además las 59 apariciones duplicadas por procedencia. El replay bloquea la red y no ejecuta efectos, persistencia comercial ni entrega. El contexto durable completo no fue restaurado: preparación/precommit quedan condicionados a las proyecciones grabadas; postventa reconstruye narrativa y fuente sintética documentada. Una reparación histórica se reproduce como entrada independiente, nunca como respuesta a un rechazo nuevo.

Por eso los 308 borradores que llegan a precommit condicionado **no son una tasa de aprobación de las golden**, y el texto hasta esa etapa no se presenta como entregado. No se hizo aceptación de naturalidad con modelo ni prueba en producción. La tabla marca las reparaciones nuevas y las entregas actuales como desconocidas cuando corresponda.

## Reproducción

Desde el checkout de código indicado, con dependencias instaladas:

```sh
npx vitest run --config evals/golden/offline-replay.config.mts
python3 evals/golden/summarize-offline-replay.py
python3 docs/reports/evidence/2026-10-31-four-priority-replay/build-affected-table.py
npm run test:unit -- --maxWorkers=2 --reporter=dot
```

La evidencia de la corrida anterior sobre `06ec3e5` queda archivada en `evidence/2026-10-31-offline-replay/`; la nueva corrida escribe en otro directorio. El replay identifica SHA, función completa ejercitada, hashes y estado limpio del código de producto.

**Llamadas a modelos: 0. Tokens nuevos: 0. Despliegues: 0.**
