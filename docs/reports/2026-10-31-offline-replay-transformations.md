# Replay offline v3–v8 y correcciones pendientes

Se ejecutaron las funciones reales de `06ec3e5ac85825bb51cfec23df10d0c22b72298d`, sin llamadas a modelos, sin persistir efectos, sin enviar mensajes y sin desplegar. El checkout es `7c39135`; su diferencia respecto de `06ec3e5` contiene sólo evidencia de la evaluación NIM anterior, no código de producto. Prompt `studyx-agent-a-canonical-v101`; brain `studyx-agent-a-brain-v145`.

**El replay completo de entrega no puede reconstruirse con estos archivos.** Sí se ejecutaron parser, normalización y resolver; la preparación y el control factual se ejercitaron con el contexto grabado. Falta parte del estado durable que el commit vuelve a consultar. El resultado se entrega como diagnóstico parcial, sin presentar un texto condicionado como mensaje realmente autorizado o entregado.

## Evidencia y cobertura

- [Tabla por borrador](evidence/2026-10-31-offline-replay/por-borrador.md): original, texto obtenido por etapa, rechazo, transformación y autoridad.
- [CSV completo](evidence/2026-10-31-offline-replay/por-borrador.csv): permite filtrar los 427 registros fuente y comparar textos completos.
- [Datos y trazas](evidence/2026-10-31-offline-replay/replay.json), [resumen de conteos](evidence/2026-10-31-offline-replay/resumen.json) e [índice de procedencia](evidence/2026-10-31-offline-replay/offline-replay-index.json).

| Fuente de informes finales | Turnos | Intentos guardados | Con texto | Sin borrador | Con JSON/contexto runtime para texto | Postventa reconstruida |
|---|---:|---:|---:|---:|---:|---:|
| v3 | 48 | 77 | 77 | 0 | 76 | 1 |
| v4 | 48 | 60 | 60 | 0 | 59 | 1 |
| v5 | 48 | 59 | 58 | 1 | 58 | 0 |
| v6 | 48 | 57 | 55 | 2 | 54 | 1 |
| v7 | 48 | 59 | 59 | 0 | 58 | 1 |
| v8 | 48 | 56 | 53 | 3 | 52 | 1 |
| Total | 288 | 368 | 362 | 6 | 357 | 5 |

No son conversaciones reales de clientes de producción: los runtime declaran `execution_harness=processInboundTurn`, conversaciones `golden-*` y entrega a adaptador local. Son respuestas reales del proveedor conservadas en evaluaciones.

Además se revisaron todos los parciales disponibles. **El archivo rotulado `baseline-v6-observations.partial.json` corresponde al SHA de v7** (`8a46ee15b9e0f0bba37455362afb17706793e717`): sus 59/59 intentos coinciden exactamente con v7, incluida postventa. Se preservaron esas 59 apariciones adicionales en la tabla, marcadas como duplicadas de v7. No aumentan el número de borradores nuevos ni las frecuencias de impacto. Así se revisan 427 registros fuente, 421 con texto, sin confundirlos con 427 llamadas o generaciones distintas.

V3 declara reclasificación sin llamada nueva y usa el parcial v2 como origen: coincide en 77/77 intentos. V4, v5 y v8 coinciden con sus parciales; no existe parcial v7 con ese nombre. En v5 no se guardaron intentos para los dos turnos del caso 12. Los cuatro turnos de disponibilidad de llamada v4/v6/v7/v8 tampoco tienen borrador porque usaron un fast-path.

El índice usa huella completa del intento, caso y texto del cliente. Se mejoró el vínculo con la salida capturada, se preservaron candidatos alternativos y no se asignó una ejecución por su hora. Los identificadores semánticos de las golden no se compararon con UUID de base de datos. Hay 361 grupos por caso/turno/cliente/huella entre los 368 intentos finales; una huella igual no prueba por sí sola una única generación.

## Qué prueba el replay actual

1. **Parser y resolver reales:** cada borrador HTTP disponible vuelve a pasar por `parseAgentATurnProposalV1` y `resolveAgentAPlannerlessProposalV2`. Se conserva también el JSON original del proveedor. Las reparaciones históricas son entradas independientes; ninguna se hace pasar por respuesta a un rechazo nuevo.
2. **Preparación condicionada:** `prepareAgentTurnV2` recibe catálogo, intake, evidencia de consentimiento, pago y capacidad de bonificación grabados. Para los datos capturados después de generar se usa la respuesta histórica de captura de perfil de ese intento. Esto no equivale a revalidar hoy el perfil contra una base restaurada.
3. **Estado incompleto explícito:** `conversation_state_v1` del claim ya fue proyectado y puede modificar curso, plan y etapa respecto del estado persistido (`claim-batch.ts:1122–1171`). No se lo presenta como el estado que habría recargado el commit. Los timestamps ausentes no reciben fechas inventadas; se evita una segunda expiración. El workspace ausente usa sólo un marcador de identidad, sin consultar ni escribir base. Los campos desconocidos de ledger/fallback fallan si se acceden.
4. **Verdad comercial condicionada:** se ejecuta el guard actual con los hechos recuperables. La proyección no conserva todo `delivery`/metadata; un rechazo dependiente de información logística ausente no es prueba de un error del modelo. No se reserva un link ni se aplica una bonificación para completar la salida.
5. **Recortes:** se ejecuta la función privada original por extracción de AST, con hash de su código. Los candidatos potenciales pasan por resolver blocking, exclusión de bonificación y preparación sin efectos. Se distinguen de recortes históricamente confirmados: no prueban qué candidato elegiría un workflow completo después de reparaciones nuevas.
6. **Postventa:** el reporte sólo conserva `intro + suggestion` unidos por salto de línea. Se reconstruye esa separación y se ejerce el ensamblador contra los datos sintéticos documentados del setup. No acredita `NarrativeSchema`, autorización durable de fuente, egress completo, fulfillment ni envío. El fallback ensamblado coincide exactamente con las cinco salidas históricas primarias.

En las 362 apariciones primarias con texto: 308 llegan a preparación/precommit condicionado; 22 requieren una reparación nueva no disponible; 16 son rechazadas por el resolver; 7 por el guard factual condicionado; 3 por preparación y 1 por esquema. Las otras 5 son postventa reconstruida. **Estas cifras no son una tasa de aprobación de las golden.** Para todos los borradores el campo `delivered_today` queda desconocido: no hubo commit ni entrega.

Los seis errores de proveedor se conservan como ausencia de borrador, no se inventan respuestas. La tabla incluye también un anexo para los seis turnos de los informes sin ningún intento guardado.

## Lista priorizada, sin aplicar

Las frecuencias siguientes excluyen los duplicados del parcial v6. Las unidades se indican porque no todas las fuentes permiten identificar una ejecución única.

| Prioridad | Transformación pendiente | Impacto observado | Evidencia y autoridad | Corrección propuesta |
|---|---|---|---|---|
| 1 | Recortes de `literalConversationVariants`, `processInboundTurn.ts:329`, usados en `:1889/:2654` | **7 turnos con traces únicos**, evento de floor y coincidencia literal con la salida. Las 9 apariciones entre todas las fuentes incluyen 2 duplicados. | P:17/236 y B:71 asignan la reparación al agente. Conservar palabras no conserva necesariamente sentido, alcance ni intención. | Reemplazar la selección de subconjuntos y oraciones por rechazo estructurado y reparación del agente sobre el mismo sujeto. Conservar borrador, rechazo y recibos de efectos. Si se agota la reparación, pasar a recuperación durable y contingencia operativa segura; no entregar un recorte elegido por el backend ni una promesa descartada. |
| 2 | Whitelist de contraseña + fallback y bloques fijos de postventa, `post-sale/service.ts:260–302`, `post-sale-instructions.ts:16–30` | **5 borradores distintos**, uno por v3/v4/v6/v7/v8, rechazados por `POST_SALE_CHANGE_MUST_BE_OPTIONAL`; los 5 terminan en el mismo fallback. El parcial agrega un duplicado. | P:230 permite sugerir el cambio de contraseña sin exigirlo; P:17/236 deja la prosa al agente. Los datos verificados de acceso están permitidos, no toda la decoración ni los contactos anexados. | Sustituir la whitelist de formulaciones por rechazo/reparación sólo de la obligación incumplida, conservando variantes realmente opcionales. Mantener la obligación de no imponer cambio de contraseña, fuente verificada, protección de credenciales y egress. Preservar intro/sugerencia válidas y agregar sólo los datos canónicos expresamente permitidos, incluidos cursos efectivamente habilitados según B:89–90. Quitar prosa decorativa y contactos extra; no sustituir toda la narrativa por una bienvenida fija. |
| 3 | Confirmación fija de llamada y demás bypasses, `call-handoff-fast-path.ts:26–27` | **4 apariciones de turnos sin modelo**: disponibilidad en v4/v6/v7/v8. Cada una tiene múltiples runtime equivalentes para ese texto; no se atribuyen a un trace único. | P:7/17/206–212/236. El efecto puede necesitar continuidad técnica, pero eso no autoriza un guion. “Nuestra asesora intenta comunicarse ahora” excede una mera reserva si el proveedor todavía no aceptó la llamada. | Conservar consentimiento, datos, idempotencia y ejecución independiente del proveedor de texto. Preparar narrativa condicionada al resultado y liberarla sólo con recibo del efecto confirmado. Guardar/reintentar la confirmación de forma durable. Si falta modelo, contingencia operativa mínima sin afirmar despacho/conexión ni atención humana no comprobada. |
| 4 | Frases de contingencia, `decision-policy.ts:39–172/:289`, `technical-fallback.ts:19–43` | **3 turnos con runtime único** entregan exactamente la cadena actual `technicalFallback`: v6/04/expensive, v8/09/definitive y v8/13/duration_followup. | P:19/236. “No quiero suponer algo incorrecto…” expone la defensa interna y devuelve una pregunta genérica. No es continuidad contextual del agente. | Mantener el aviso operativo que evita silencio mientras se prepara una recuperación durable. Dejar de usar una contingencia para preguntar por el curso, descubrir, vender o afirmar efectos. No borrar el último aviso hasta cerrar el mecanismo que lo reemplaza. |
| 5 | Aperturas/requisitos/composición fija y sustitución de email, `agent-a-brain.ts:1119/:1203/:1252/:1268`; `canonical-response-assembler.ts:283` | **Sin ejecución atribuida en este corpus**: no equivale a impacto cero en otras rutas. | P:17/220/236. El valor factual no autoriza la redacción agregada. | En una etapa posterior, retirar decisiones de redacción de esos compositores y conservar sólo validación/rechazo y campos canónicos permitidos. Verificar específicamente rutas alternativas, resumen de datos y postventa. No migrar silenciosamente el legado en este cambio. |
| 6 | Borrado de burbuja por URL/placeholder y plantilla de pago, `agent-a-brain.ts:853–906`; poda factual después de reparación fallida, `resolve-agent-a-plannerless.ts:662` y helpers; `decision.service.ts:495` | **Sin activación atribuida de esas transformaciones en las etapas independientes probadas.** Hay rechazos de hechos; no se cuentan como transformación de estilo. | P:50/222/236 y B:71. Un precio inventado se rechaza; no se reemplaza ni se borra silenciosamente para hacer pasar otra respuesta. | Mantener URLs exclusivamente del backend; devolver al agente el sujeto inválido para que conserve o reescriba su prosa. Mantener inserción canónica y división física, sin introducir frases de transición. Cambiar la poda silenciosa por rechazo/reparación. |

Ejemplo de recorte confirmado: v4, caso 14, `bonus_1`, trace `4b948416-8dc9-43b7-8015-75c61ed04627`. El borrador tenía dos mensajes; el primero hablaba del freno del precio y ofrecía un curso. Se entregó sólo el segundo, empezando por “Por tu objetivo con tiendas online…”. El runtime registra `studyx.turn.agent_a_precommit_conversational_floor`. Hoy ese borrador exige reparación en el resolver; no se afirma que el recorte histórico se repita bajo las nuevas validaciones.

Ejemplo de postventa: v8 rechazó “Si quieres, cambia la contraseña cuando entres para dejar tu cuenta a tu gusto.” La opcionalidad ya está expresada. El ensamblador sigue rechazándola por la whitelist actual y el fallback reproduce la salida histórica. Se prueba el rechazo y la sustitución del ensamblador; el envío actual sigue sin probarse.

## Garantías y decisiones que no se deben mezclar

- **Nunca silencio:** no se quitó ninguna contingencia. La eliminación absoluta de cadenas fijas, cuando ningún modelo está disponible, deja una tensión real con P:236. La propuesta mantiene por ahora el aviso operativo mínimo y exige definir esa excepción explícitamente antes de eliminar el último recurso. Este informe no convierte una excepción propuesta en autoridad aprobada ni demuestra disponibilidad de producción.
- **Efectos reales:** el replay no ejecutó ninguno. Un permiso del snapshot no prueba que la acción ocurriera. La confirmación de llamada, bonificación, pago o alta debe liberarse sólo junto al recibo durable correspondiente. Ante rechazo de un nuevo regalo se conservan los ya entregados, como exige la autoridad.
- **Hechos autorizados:** se conservan validadores de precio, curso, pago, consentimiento y egress. Rechazar y reparar una falsedad es correcto. La salida segura de un guard no se presenta como permiso para corregir el borrador silenciosamente.
- **Bonificación `d2c836a`:** el resolver actual marca `FACT_VALUE_MISMATCH:forbidden_promise` en 10 apariciones primarias de borrador; 1 adicional del parcial es duplicada. Es evidencia de contención en esos datos, no prueba universal de que toda promesa se materialice: no se ejecutó el ledger ni el fulfillment.
- **Voseo:** el normalizador anterior cambiaría el registro en 226 apariciones primarias de borrador. `06ec3e5` conserva esas palabras; sólo elimina ¿/¡ según P:15. Esto prueba el arreglo de esa etapa, no que el modelo siempre elija correctamente el registro del cliente.

## Revisión y reproducción

El arquitecto revisó el método antes de ejecutarlo y el resultado después. Se incorporaron sus hallazgos: límites del estado proyectado, no reutilizar reparaciones para rechazos nuevos, revalidación estricta de candidatos, plan de prueba USD 0,50, clasificación de errores postventa y separación entre transformación histórica, ejecución parcial actual y candidato hipotético. Aprobó publicar el diagnóstico parcial con estos límites y la priorización; no aprobó un despliegue ni una aceptación del agente.

Reproducción local, sin secretos ni conexión a proveedores:

```sh
python3 evals/golden/build-offline-replay-index.py --output docs/reports/evidence/2026-10-31-offline-replay/offline-replay-index.json
npx vitest run --config evals/golden/offline-replay.config.mts
python3 evals/golden/summarize-offline-replay.py
```

El harness bloquea `fetch`, sustituye el acceso a base por un error, verifica identidad exacta de los intentos y comprueba que el código de producto coincide con `06ec3e5`. La prueba offline sólo se habilita con su configuración específica; no se añade a la aceptación habitual. No se tocaron prompt, modelo de producción, expectativas golden ni transformaciones pendientes. **Llamadas a modelos: 0. Tokens nuevos: 0. Despliegues: 0.**
