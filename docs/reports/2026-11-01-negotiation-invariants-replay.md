# Golden 06 y 14: invariantes y replay sin modelos

Código y evaluador: `961c991bcb2a6afc3ea6b0f30d56a7ec0b0f60b8`, subido a `codex/studyx-bonus-staged-release`. Ejecuciones originales: `10d7b3e5e7b5cdce3c88901cfedd3493346ecce2`, brain v146 / prompt canónico v101. **Cero llamadas nuevas a DeepSeek o NIM; sin despliegue.**

| Caso | Corrida grabada 1 | Corrida grabada 2 |
|---|---|---|
| 06 — negociación/límite | INDETERMINATE | INDETERMINATE |
| 07 — postergación, sin cambios | PASS | PASS |
| 14 — negociación/cambio de curso | INDETERMINATE | FAIL |

**No se habilita la corrida completa de 16.** El requisito confirmado por el usuario exige 06/07/14 completos en ambas. El fallo real de `14/bonus_1` en la segunda corrida alcanza por sí solo para impedirlo; no hace falta gastar otra evaluación para confirmar ese punto. Los indeterminados tampoco cuentan como aprobados. No hay un nuevo resultado de aceptación de 48 turnos ni se convierte el 10/22 original en un porcentaje aprobado por descarte.

Los originales tienen 68 incidencias de fallo entre 06 y 14 de ambas muestras: **46 comprobaciones por posición o etiqueta se retiran**, 17 incidencias semánticas conservan su análisis de portabilidad, tres corresponden a precondiciones históricas no ejercitadas y dos faltantes literales de «USD 30» se sustituyen por evaluación semántica de cuotas en la trayectoria, todavía indeterminada. De las incidencias semánticas se reutiliza un fallo portable; las otras no se convierten en aprobados. Son incidencias, no 68 turnos. Las causas retiradas no se transforman en aprobados nuevos: se reemplazan por comprobaciones sobre la trayectoria y sus efectos. Los scores y juicios originales permanecen intactos. Los casos 03/04 conservan sus resultados y 07 conserva sus dos aprobados originales.

El evaluador activo de 06/14 utiliza historia entregada, hechos autorizados y citas utilizadas de cada turno, estado previo de negociación y ledger de efectos. Ya no exige regalar en un turno llamado `bonus_1`, alcanzar cierto paquete en un número de intervención ni elegir una etiqueta de move sin consecuencias. Las expectativas históricas permanecen disponibles para comparación; el modo activo `negotiation_invariants` las sustituye por requisitos condicionales de conversación. Los otros 14 casos y los 48 estímulos del cliente no cambiaron.

Se mantienen estas exigencias, con autoridad explícita:

- Regla 10: tres objeciones previas registradas y llamada ofrecida/rechazada o no autorizada. Se recalculan los hechos; no se toma `eligible` como prueba. `AGENTS.md`, regla 10; prompt :106-120.
- Orden de valor, cuotas, aislamiento/cierre condicional, llamada apropiada y bonificación; afinidad, cierre, precio inmutable y ausencia de insinuaciones sin efecto. El contador por sí solo no demuestra esos pasos. Prompt :106-112, :122-124 y :129.
- Una incorporación por turno, sin duplicados ni curso pago como regalo, catálogo válido y máximo configurado/hoy tres. Se comprueban todas las mutaciones del paquete, incluso sin acción declarada y desde el primer snapshot vacío de estos fixtures. Prompt :121-122; spec :59-67.
- Recapitulación del paquete según su composición real. No se exigen nombres completos literales ni una fórmula de redacción: se evalúa semánticamente. Prompt :124.
- Límite de tres y negativa a una cuarta: para acreditar la prueba debe haberse llegado realmente al tope y recibido otro pedido. No llegar no viola a Gabi ni obliga a vender tres; significa que ese control no fue ejercitado. Spec :64 y :103.
- Cambio de curso con paquete previo: evidencia de que la promoción anterior está `cancelled`. Una promoción nueva vacía no demuestra por sí sola que la anterior se canceló. Spec :40 y :106.
- Mención/insinuación de un regalo nuevo necesita `offer_course_bonus` ejecutada. Recordar un curso ya ofrecido y materializado puede apoyarse en su efecto anterior, sin volver a ofrecerlo. Prompt :123-124 y :129; spec :69-73.

Los hechos y el workflow conservan sus validaciones, incluidos `enabled`, máximo configurado y memoria previa, aplicadas cuando hay una propuesta o efecto de bono, independientemente del turno. El juez semántico recibe la historia con los hechos de cada intervención; por ejemplo, no usa los hechos actuales de Marketing para juzgar una afirmación anterior sobre Fotografía. Puede citar historia o ledger y sus citas deben existir literalmente en esas fuentes. La composición es un hecho; la naturalidad o insinuación no se clasifica con regex.

El replay sólo reutiliza un juicio histórico si coinciden criterio y evidencia. El juez anterior no recibía toda la historia: sus veredictos sobre “debía llamar ahora” o “el tercero aquí” no pueden certificar los nuevos requisitos de trayectoria. Lo que carece de juicio portable queda `INDETERMINATE`; lo que no sucedió queda `NOT_EXERCISED`. En una corrida futura, el nuevo juez recibe esa historia y puede medirlo directamente. La aceptación completa mantiene 41/48 y críticos 07/10/11/12/15; además no puede aprobarse como completa con invariantes nuevos indeterminados o sin ejercitar. Es un control de completitud de medición, no una nueva regla comercial.

En R1 las dos ofertas ejecutadas cumplen la regla 10, incorporación única y correspondencia con efectos. `14/call_step` puede usar la invitación ya ofrecida antes; no se exige repetirla. La cancelación posterior al cambio de curso queda acreditada. En 06 se ofreció sólo un curso: no se ejercitó el límite de tres/cuarta. Recapitulación y parte de la semántica quedan indeterminadas por falta de un juicio portable equivalente, no por una comprobación textual fallida.

En R2 no hubo ofertas ejecutadas. `14/bonus_1` sigue fallando: la reparación entregó «si sumo un curso extra a tu inscripción, sin cambiar los USD 360, te ayudaría a avanzar?» con `proposed_action=none` y sin efecto. El juicio original ya identifica esa insinuación. El mapeo portable conserva texto exacto, requisito, cita, fuente, evidencia y explicación; no reutiliza la exigencia de bonificar en ese turno. La falta de paquete tampoco acredita la prueba de cancelación ni la de cuarta oferta.

La reparación se reforzó en el anexo **v147**, con autoridad prompt :123 y :129 / spec :71. Ante `ladder_step_pending` o `forbidden_promise`, debe quitar toda mención o sugerencia de bonificación, también genérica, condicional o interrogativa. Conserva los efectos anteriores en el ledger sin narrarlos durante esa reparación. Continúa con el curso pago y el escalón pendiente sustentado por hechos; la metadata fresca del rechazo prima sobre el snapshot, y el contador no inventa pasos comerciales completos. La llamada requiere permiso y orden previo acreditado. No se añadió regex, plantilla de respuesta al cliente ni condición comercial al backend. **Este replay no mide el efecto de v147 sobre Flash:** las respuestas grabadas fueron generadas con v146.

Pasaron **4.902 unitarias, 945 de integración y 100 pruebas offline del evaluador**, además de tipos, lint, build y validación ADK. El arquitecto aprobó reparación, evaluador y regresiones: ofertas en turnos anteriores válidas, mutaciones sin acción incluso iniciales, alias naturales, cobertura vacía, cancelación no probada, contexto final de reparaciones, fuentes históricas y citas inventadas. Los 73 archivos del manifiesto histórico conservan sus hashes. El replay definitivo se ejecutó después del commit, con `evaluation_worktree_dirty=false` y `fetch` bloqueado: cero intentos. Las llamadas nuevas a DeepSeek/NIM, tokens nuevos facturados allí y su costo son **0**.

[Resultados por invariante](evidence/2026-11-01-negotiation-invariants-replay/invariants.md) · [CSV con evidencia](evidence/2026-11-01-negotiation-invariants-replay/invariants.csv) · [Clasificación de los fallos históricos](evidence/2026-11-01-negotiation-invariants-replay/historical-failures.csv) · [Replay completo y procedencia](evidence/2026-11-01-negotiation-invariants-replay/replay.json) · [Protocolo y reproducción](../../evals/golden/NEGOTIATION-INVARIANTS.md).

Sin desplegar ni cambiar el modelo de producción. La suite completa no se ejecutó porque el requisito previo sigue sin cumplirse.
