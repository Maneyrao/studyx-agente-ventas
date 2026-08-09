# Matriz de integración y fallos

Ninguna suite finita demuestra “todos los casos posibles”. Esta matriz cubre las clases de fallo que pueden duplicar efectos, mezclar clientes o producir errores comerciales.

| Caso | Protección | Evidencia local |
|---|---|---|
| Diez reentregas del mismo evento | Ledger + dos claves únicas + hash canónico | 10 conexiones reciben un solo `event_id` |
| Mismo ID con otro contenido | Comparación SHA-256 y HTTP 409 | No se agrega evento ni mensaje |
| Veinte mensajes rápidos | Locks + índices parciales | 20 turns, una conversación abierta |
| Thread externo ligado a otro teléfono | Identidad inmutable y rollback | HTTP 409; el evento conflictivo no queda persistido |
| Dos decisiones para un turn | `agent_decisions.turn_id` único + hash | Se devuelve el resultado existente o conflicto |
| Contacto bloqueado | Política en servicio y trigger de delivery | No se crea outbound/delivery |
| Opt-out explícito | Evidencia append-only + proyección revocada | Sólo se admite `opt_out_ack` |
| “No quiero comprar” | Heurística separada de opt-out | No se interpreta como baja de contacto |
| Falla después de reservar evento | Transacción serializable | Reserva y escrituras hacen rollback juntas |
| OpenAI caído | Mensaje primero; job derivado después | Inbound aceptado y memoria semántica degradada |
| Embedding con contacto incorrecto | FK compuesta mensaje/contacto | PostgreSQL rechaza la escritura |
| Worker duplicado | Leases + `FOR UPDATE SKIP LOCKED` | Claims recuperables sin vector cero |
| Envío confirmado y luego error ambiguo | Estado `submitted` no retrocede | Se rechaza degradar o reenviar a ciegas |
| Firma alterada o vieja | HMAC del cuerpo exacto + ventana de 5 minutos | Proxy responde 401 |
| Migración no reproducible | Tres clústeres PostgreSQL 17 limpios | 3/3 pasaron desde cero |

## Fallos que permanecen fuera de la prueba local

- La integración oficial de WhatsApp no está instalada ni autenticada en Botpress.
- ADK 2.0.5 no expone una primitiva tipada de envío físicamente idempotente. Ante resultado ambiguo se pausa y reconcilia; no se promete exactamente una entrega física.
- No se probaron todavía restauración de backup, failover de Supabase ni carga de producción.
- El build de Botpress requiere un perfil autenticado para sincronizar interfaces internas. Tras tres intentos sin credenciales, typecheck y `adk check` pasan, pero el build/deploy externo queda bloqueado.

## Criterio de salida a producción

No habilitar autonomía hasta completar WhatsApp real, staging con secretos rotados, prueba de backup/reconciliación y observabilidad de p95, duplicados, backlog, dead letters y pedidos humanos resueltos automáticamente.
