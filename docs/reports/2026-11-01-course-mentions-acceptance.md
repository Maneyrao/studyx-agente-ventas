# Aceptación del contrato course_mentions — 2026-11-01

El contrato detuvo las dos ofertas `bonus` con acción `none` que reaparecieron durante la medición. No se observaron bonificaciones sin respaldo en las 36 entregas revisadas. **La aceptación falla:** 06 y 14 no aprueban en ninguna corrida. No se ejecutaron las 16 ni se desplegó.

Código evaluado y subido: **25970d5b870bb7bf3b4ad01a42a764f0f19b390d**. Backend y workflow locales sobre ese SHA; brain **v148**, prompt canónico **v101**. En los 40 pedidos del agente se verificaron el campo obligatorio, los cuatro roles y la versión durable v148. Se pidió `deepseek-v4-flash` oficial; el proveedor devolvió `deepseek-flash`, alias servido actualmente por DeepSeek-V4.1-Flash-1017 según su [documentación](https://api-docs.deepseek.com/quick_start/pricing/). El modelo configurado en producción no se modificó.

| Caso / métrica | Corrida 1 | Corrida 2 |
|---|---|---|
| 06 | Fallido: 5/9 turnos aprobados | Fallido: 6/9 |
| 07 | Aprobado: 2/2 | Aprobado: 2/2 |
| 14 | Fallido: 2/7 | Fallido: 3/7; uno indeterminado |
| Total | 9/18 aprobados, 9 fallidos | 11/18 aprobados, 6 fallidos, 1 indeterminado |
| Nuevas ofertas sin respaldo observadas en entrega | 0 | 0 |
| Bonificaciones ejecutadas | 0 | 1 autorizada |
| Rechazos `ladder_step_pending`: turnos / eventos backend | 2 / 3 | 0 / 0 |
| Llamadas agente / juez | 21 / 18 | 19 / 18 |
| Tokens entrada / salida / caché | 541.012 / 9.938 / 184.704 | 506.408 / 7.873 / 169.088 |
| Costo estimado, USD | 0,059963112 | 0,055829064 |
| Latencia del agente, mediana / máximo | 2.982 / 3.474 ms | 2.699 / 3.245 ms |

Son **76 pedidos**, **1.065.231 tokens** y **USD 0,115792176 estimados** con las tarifas Flash de domingo: USD 0,003 entrada cacheada, 0,15 no cacheada y 0,60 salida por millón. Todos los pedidos tienen uso registrado; no hay intentos de costo desconocido. El saldo sólo se consultó para disponibilidad, no se usa como factura ni como cálculo de costo. No se añadieron corridas ni pedidos de prueba al modelo.

## Tabla por turno y evidencia

Los **36 turnos** con aprobado/fallido/indeterminado, capa, borradores, texto entregado, rechazos y latencia están en la [tabla completa](evidence/2026-11-01-course-mentions/acceptance/summary.md), [CSV](evidence/2026-11-01-course-mentions/acceptance/per-turn.csv) y [JSON](evidence/2026-11-01-course-mentions/acceptance/turns.json). Las declaraciones de roles de cada intento están en `drafts.course_mentions`; las originales completas, contextos y esquemas están en `raw/`.

La [auditoría contextual](evidence/2026-11-01-course-mentions/acceptance/delivery-audit.json) revisa texto, intención declarada y efectos previos/actuales: 36/36 sin bono indebido ni rol falso observado. Ese PASS tiene ese alcance; **no equivale a aprobar la golden**. El cruce conservador con el criterio específico del juez queda en 19 PASS y 17 INDETERMINATE cuando éste no acredita aisladamente esa condición. Se conservan ambos resultados y los scores originales; no se cambian criterios ni se convierten indeterminados en aprobados.

## Qué se ejercitó

- **R1, 06/bonus_3:** borrador `action=none`, curso adicional declarado `bonus`. El backend rechaza por `forbidden_promise`/`ladder_step_pending`: cinco objeciones, llamada pendiente. La reparación elimina el bono y ofrece llamada, pero duplica la invitación entre mensajes y `call_offer`; el turno termina en la contingencia autorizada «Qué dato o qué curso revisamos?». La garantía de nunca silencio se conserva; la respuesta no cumple el avance comercial.
- **R1, 14/bonus_1:** otro `bonus + none`, con llamada pendiente. Rechazado y reparado sin bono; la respuesta final vuelve a cuotas y el juez no acredita el escalón pendiente.
- **R2, 14/bonus_1:** bono declarado y `offer_course_bonus` ejecutado, con tres objeciones previas y llamada ya ofrecida. Se entrega el paquete con un bonificado y luego se cancela al cambiar a Marketing Digital. Esta oferta sí tiene respaldo; su juicio de recapitulación queda indeterminado, no aprobado.

Se registran tres eventos backend `ladder_step_pending`: dos en R1/06/bonus_3 y uno en R1/14/bonus_1. Son dos turnos afectados.

No apareció un rechazo `COURSE_ROLE_UNDECLARED` en estas corridas: los 40 pedidos devolvieron el campo nuevo. Ese rechazo se prueba con las cinco grabaciones antiguas y los tests. No se ejercitaron tres regalos acumulados ni la negativa a un cuarto sobre un paquete completo; esa falta de exposición no cuenta como aprobación.

## Texto y límites del diagnóstico

35/36 textos finales se conservan exactamente o con la eliminación autorizada de ¿/¡ y ajustes de espacios. El único reemplazo de prosa es la contingencia de R1/06/bonus_3 después del rechazo y la reparación fallida. No se observaron recortes de un borrador para escoger frases. El detalle bruto y el resultado de comparación están guardados por turno.

Hay dos advertencias sobre el juez que se documentan **sin alterar su resultado**: en R1/14/installments considera «te dejo el enlace» una expresión de regalo prohibida, aunque el objeto es el enlace; en R2/14/call_step fundamenta parte del fallo en el primer intento rechazado, aunque la reparación entregada sí ofrece llamada y el contexto posterior registra la invitación. Por eso no se atribuyen todos los fallos ciegamente al modelo. Aun con esas observaciones, 06 falla en ambas y no se habilita la suite completa.

Como referencia, las dos corridas anteriores v147 habían registrado cinco entregas sin respaldo y 21/36 turnos aprobados. Aquí se observan cero y 20/36 respectivamente. El control estructural mejora la seguridad de esas ofertas; no demuestra una mejora general de conversación ni una aceptación comercial. No es un replay de los mismos borradores ni una comparación determinista.

El contrato sigue limitado a nombres canónicos exactos y roles declarados: alias, insinuaciones sin nombre y declaraciones deshonestas de `alternative`/`paid_complement` requieren evaluación semántica. No se amplían listas de frases ni se agrega una regla de cómo vender al brain.

Trazabilidad: en estas observaciones locales el campo durable `backend_sha` quedó `null`. El SHA se acredita por el runner, su estado de ejecución, los resultados y el checkout limpio al inicio; brain v148, contrato y contenido bruto sí se verifican por intento. La variable vacía `STUDYX_RELEASE_SHA` del aislamiento local prevalece sobre `VERCEL_GIT_COMMIT_SHA` en el lector actual. Esta medición no acredita que ese campo esté completo en producción. El [comprobante de versiones](evidence/2026-11-01-course-mentions/acceptance/version-contract-proof.json) deja explícita esa limitación.

La [implementación y sus verificaciones offline](2026-11-01-course-mentions-contract.md) incluyen 4.940 unitarias, 954 de integración, 98 del evaluador, cuatro escenarios offline de workflow y replay 17/17. El arquitecto aprobó código, replay y evidencia final después de precisar los tres eventos de rechazo en dos turnos. El empaquetado ADK conserva la limitación local de dependencias documentada allí. No se desplegó.
