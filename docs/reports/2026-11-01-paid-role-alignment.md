# Alineación de identidad paid y referencias del juez — 2026-11-01

La regresión nacía de dos lecturas distintas: `claim-batch` proyectaba el curso de interés resuelto desde el mensaje o el historial reciente sobre `selected_offering_code`, sin persistir una selección de compra. El contexto del modelo copiaba esa proyección. En cambio, `prepare-agent-turn-v2` recargaba sólo el estado persistido; al quedar nulo, el contrato rechazaba la misma identidad que el modelo había recibido. Los artefactos prueban esa desalineación, pero no permiten distinguir en cada turno si faltaba una selección persistida o había caducado por inactividad.

## Corrección del backend

Claim y prepare reutilizan el mismo proyector técnico de curso y filtro de sesión. Durante el commit se recarga el contexto desde PostgreSQL por el batch, con el mismo límite configurado de historial; se resuelve con el catálogo canónico completo. No se agrega un campo de autorización al JSON del modelo ni un snapshot aportado por el cliente.

`paid_mention_offering_code` sólo respalda la mención `paid` cuando falta una identidad de compra vigente. Una selección persistida o un cambio validado tienen prioridad. Este foco no escribe selección, no autoriza checkout, no hace vigente un paquete ni habilita un regalo. Las autorizaciones de bonificación conservan el ancla anterior y sus reglas 9+10. Los códigos desconocidos, cursos pagos incorrectos, reservas pendientes y paquetes cancelados mantienen sus rechazos.

La extracción preserva la resolución que ya usaba claim: referencia exacta del mensaje actual, o búsqueda hacia atrás de mensajes entrantes de la sesión si el mensaje actual es neutral; ambigüedad, curso no disponible y una petición nueva no neutral cortan el recorrido. No hay regex nuevas para vender, frases obligatorias ni cambios al prompt de Gabi. Brain v149 y prompt canónico v101 permanecen iguales.

## Replay de la regresión

Se prueban las 12 propuestas originales de 05/interest, 05/budget, 13/syllabus y 13/duration_followup: antes 12 `paid_mismatch`, ahora 0 en la validación de identidad/roles. Ocho mutaciones controladas —curso pago incorrecto y bonificación sin efecto— siguen rechazadas. No se cambia la grabación, la propuesta original ni su score histórico.

El replay reconstruye el foco con el mensaje y el historial lógico capturados, ya acotados por el claim original. No fabrica timestamps o aliases ausentes. Su alcance es el límite de identidad/roles, no la aceptación integral del turno ni una entrega. Las pruebas con PostgreSQL cubren la recarga real de historial, la persistencia nula conservada, entrega útil y ausencia de efectos no autorizados. Otros rechazos independientes, como logística no respaldada, siguen vigentes.

[Tabla de replay](evidence/2026-11-01-paid-role-alignment/offline-replay.md) · [datos y hashes](evidence/2026-11-01-paid-role-alignment/offline-replay.json). Reproducir sin modelos: `npx tsx evals/golden/replay-paid-role-alignment.ts`.

## Corrección del juez

El identificador válido de requisito determina su tipo: `must_not:0` produce `SEMANTIC_MUST_NOT_FAILED`, aunque el modelo devuelva el código redundante equivocado. Se mantienen el lookup exacto del ID, el alcance del requisito, la evidencia literal positiva obligatoria para must_not y la comprobación contra la fuente entregada. No se resuelven IDs inexistentes ni se fabrica evidencia.

Las cuatro respuestas históricas 0099–0102 se convierten en **FAIL válido**, no en aprobado ni indeterminado, con un único pedido simulado de frontera por test. No se llama a un modelo para el replay del juez. La versión lógica pasa a `studyx-golden-semantic-delivered-v4`; el esquema de salida v3 permanece compatible.

## Verificación y aceptación

Pasaron **4.964 unitarias, 960 de integración y 115 del evaluador offline**, además de tipos, lint, build Next y chequeo ADK. El arquitecto aprobó el código y el alcance del replay; resultados y logs están en [checks.json](evidence/2026-11-01-paid-role-alignment/checks.json). Se repite la integración completa desde una base fresca tras el último ajuste del límite de historial; una assertion antigua de orden por conversation_seq nulo se reemplaza por comprobar IDs/contenido en el orden del plan autorizado, conservando contador y recibos idempotentes.

Tras commit y push se ejecutará una sola aceptación Flash de las 16 golden: ≥41/48, críticos 07/10/11/12/15 completos y cero bonificaciones sin respaldo observadas. 06 y 14 se informan y sus turnos integran el total, sin gate individual. No se despliega.

La [única aceptación posterior](2026-11-01-paid-role-alignment-acceptance.md) sobre 9482954 entregó los cuatro turnos sin paid_mismatch, pero obtuvo 35/48 y falló el crítico 12. No aprobó el criterio formal ni se desplegó.
