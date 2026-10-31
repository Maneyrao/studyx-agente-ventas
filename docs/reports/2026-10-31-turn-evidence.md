# Evidencia durable de generación y entrega

Alcance: observabilidad, sin cambios del prompt, modelo productivo ni escenarios
golden. Corrección de registro separada en `d803e22`, autoridad P:13/15. Las
otras transformaciones del inventario permanecen pendientes, sin modificar.

## Datos y fronteras

- `agent.turn.evidence` en `audit_log`: borrador crudo antes de parseo y
  normalización, todos los intentos disponibles, errores de esquema (código y
  subject), rechazo que motivó cada reparación, resolución de propuestas,
  propuestas de commit y sus rechazos estructurados. Se escribe fuera de la
  transacción de decisión rechazada; puede existir sin `agent_decisions`.
- `agent.decision.committed`: texto autorizado y guardado dentro de la misma
  transacción que crea la decisión. Los mensajes físicos guardados y sus hashes
  siguen siendo la autoridad de cada parte.
- `provider_send_attempt`: payload exacto que se va a pasar a `createMessage`.
  `provider_accepted` registra el recibo de Botpress; las fallas inciertas se
  distinguen de bloqueos anteriores a contactar el proveedor.
- `outbound.delivery.reported`: estado durable existente, ID de proveedor y
  versión del backend. `submitted_to_botpress` no se presenta como recepción
  confirmada en el teléfono. Las confirmaciones `delivered` conservan su prueba.
- Postventa: generación cacheada mediante Workflow antes de escribir evidencia;
  propuesta recibida, rechazo, texto autorizado y envío administrado también se
  registran. El fallo de evidencia no libera el claim ni genera otra respuesta.
- Rutas SDK antiguas: `sdk_exit_observed` guarda el objeto que expone el runtime
  antes del parseo local, con `raw_provider_text_available=false`. No se inventa
  un texto crudo que Autonomous no expone.

Cada observación lleva versión canónica del prompt, brain y versión independiente
de código Botpress `studyx-botpress-turn-evidence-v1`. Es un identificador de
versión fuente, **no** un hash del bundle compilado. El SHA de backend se toma
en servidor de `STUDYX_RELEASE_SHA` o `VERCEL_GIT_COMMIT_SHA`, validado como SHA
completo. Si falta, se registra `null`; no se sustituye por una afirmación del
cliente. La aceptación local fija ese SHA al commit evaluado.

## Idempotencia y fallos

El endpoint requiere la misma autenticación/HMAC/replay que las demás rutas
agent, valida pertenencia al workspace y usa la identidad estable de cada
observación. La función existente de auditoría rechaza reutilizar una clave con
otro payload. Un retry conserva la primera identidad del servidor. El registro
no imprime borradores ni claves en logs.

Capturar el borrador es síncrono antes de cualquier transformación. Persistir
el journal ocurre después de cerrar el timeout del proveedor/compositor,
también cuando el parseo falla. Un fallo de persistencia tiene código propio;
no se interpreta como rechazo del modelo ni consume una generación nueva.
El predicate también reconoce el Error plano que ADK rehidrata desde un step.

## Revisión manual después de una falla de evidencia

Es una limitación operativa explícita: ante una falla persistente se conserva
la instancia para revisión, sin renovar automáticamente leases comerciales.
`state.evidenceReview` (turno) o `state.evidence_review` (postventa) registra
workflow ID, turno/notificación, motivo y ubicación de borradores/pendientes.
`studyxEvidenceReview=true` impide que `getOrCreate` elimine esa instancia.

Inspeccionar el ID con `adk workflows runs <workflow_id> --format json`:

1. Turno: recuperar `state.pendingEvidence` y los pasos cacheados de generación.
2. Postventa: recuperar `generate-post-sale.output.events` y `.narrative`.
3. Reenviar las observaciones pendientes al endpoint firmado con sus mismos
   `event_id`; comprobar auditoría y estados de outbounds antes de decidir
   cualquier recuperación. No iniciar otro workflow ni repetir generación/envío
   para reparar sólo observabilidad. La revisión humana decide el efecto que
   siga pendiente después de expirar una autorización.

La retención diferenciada conserva el comportamiento de reintento de un release
ordinario; sólo bloquea reemplazar instancias marcadas por evidencia pendiente.

## Aceptación sintética

Proveedor NVIDIA NIM, `deepseek-ai/deepseek-v4.1-flash`, límite compartido de
40 solicitudes/minuto y reintentos acotados por solicitud. Una única corrida.
v8 usó DeepSeek oficial v4-flash: es referencia, no criterio ni explicación
causal de diferencias entre proveedores/jueces. No se cambian las expectativas
de los escenarios. Gate del usuario: 16 casos/48 turnos evaluados, al menos
41 aprobados y casos 07/10/11/12/15 completamente aprobados.

El reporte conserva borradores frente a entrega, rechazos, capa hipotética,
llamadas y tokens; un JSON adicional exporta auditoría de la base sintética
antes de apagarla. Nunca despliega ni envía a un contacto real.

## Verificación previa a la corrida

- Unitarias/contratos: 4.836 aprobadas; 17 omitidas; 7 pendientes (todo).
- Integración/replay: 919 aprobadas; 1 omitida, 93 archivos.
- TypeScript, lint, build Next y comprobación offline ADK aprobados.
- Proveedor/comparación: 11 pruebas deterministas aprobadas, sin generación.
- El primer conjunto de integración tuvo 12 fallos de knowledge-projection por
  cola/estado compartido; las 14 pruebas de ese archivo pasaron aisladas. Se
  repitió el conjunto completo sobre base local recreada y cola inicial
  proyectada con embeddings sintéticos: 919 aprobadas. No se modificó ese
  código ni sus expectativas. El bootstrap nativo necesitó crear service_role
  antes de migrar; se adaptó una copia temporal del bootstrap, no migraciones.
- Revisión arquitectónica final: sin hallazgos materiales pendientes. Incluye
  clasificación estable de errores rehidratados, fallas anteriores al envío,
  revisión manual conservada y postventa sin regeneración por fallos de evidencia.

Esta verificación es técnica; la aceptación de conversación queda pendiente
del reporte de la única corrida sobre el SHA publicado.
