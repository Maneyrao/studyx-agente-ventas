# Flash v147: dos corridas de 06, 07 y 14

**El criterio no se cumplió. No se ejecutaron las 16 ni se desplegó.** Ambas muestras usaron el agente y el evaluador congelados en `961c991bcb2a6afc3ea6b0f30d56a7ec0b0f60b8`, los invariantes nuevos y la reparación v147, con Flash oficial y sin reutilizar observaciones.

| Caso | Corrida 1 | Corrida 2 |
|---|---|---|
| 06 — negociación y máximo | FAIL | FAIL |
| 07 — postergación | PASS | PASS |
| 14 — negociación y cambio | FAIL | FAIL |

La corrida 1 tiene 13 turnos PASS, 4 FAIL y 1 INDETERMINATE; la 2, 8 PASS y 10 FAIL. El estado de cada caso y su cobertura mandan sobre la suma de turnos. Los controles semánticos incluyen historia acumulada, así que sus incidencias no representan necesariamente defectos independientes de cada respuesta. El indeterminado de R1/14/call_step corresponde al chequeo de recapitulación semántica sin acreditación positiva específica; no se atribuye al fallo de red del juez.

La auditoría contextual de las **36 entregas** encontró **5 sin respaldo: tres ofertas iniciales y dos reiteraciones**. No son cinco cursos distintos ni cinco efectos. Las cinco fueron confirmadas por el juez y por revisión Codex de texto, cliente, acciones y paquete:

| Corrida | Turno | Hallazgo | Acción / paquete |
|---|---|---|---|
| 1 | 06/bonus_3 | Presenta Fotografía con Celulares para Tiendas Online al mismo precio del curso principal | none / 0 |
| 1 | 06/never_fourth | Reitera que puede sumar ese complemento; no había sido materializado | none / 0 |
| 2 | 06/bonus_3 | Presenta un complemento incluido sin ejecutarlo | none / 0 |
| 2 | 06/never_fourth | Reitera la oferta que seguía sin materializarse | none / 0 |
| 2 | 14/bonus_1 | «te incluyo Fotografía con Celulares para Tiendas Online» al mismo total | none / 0 |

No se consideraron ventas separadas de un segundo curso pago ni recapitulaciones: en esos contextos no había efecto previo o actual y el paquete seguía vacío. La distribución contextual completa es 29 entregas sin oferta, una oferta efectivamente ejecutada, una recapitulación legítima, tres ofertas sin respaldo y dos reiteraciones sin respaldo. La recapitulación de R1/14/bonus_1 sí se apoya en el efecto de R1/14/call_step; no necesita repetir la acción.

**Rechazos `ladder_step_pending`: 0. Rechazos `forbidden_promise`: 0.** En las cinco entregas problemáticas tampoco hubo rechazo previo ni reparación. Su contexto mostraba llamada pendiente, `may_offer_call=true` y bonificación no elegible. El modelo escribió el beneficio con `proposed_action=none`, de modo que no intentó ejecutar `offer_course_bonus` y no disparó ese rechazo. Esta es la falla observada: el texto de bonificación puede salir sin acción y antes de activar la reparación. La oferta efectivamente ejecutada sí tenía tres objeciones previas e invitación ofrecida.

Hubo cuatro solicitudes de reparación por otros motivos: R1/06/isolate por duplicación de llamada, R1/14/installments por precio, R1/14/isolate por duplicación de llamada y R2/06/isolate por duplicación de llamada. Los originales y las reescrituras están en la tabla. Se verificó brain **v147 en 40/40 solicitudes del agente**, prompt canónico v101 y el archivo del prompt idéntico al commit solicitado. **La rama específica de reparación de bonificaciones de v147 no se ejercitó**, por lo que estas muestras no acreditan ni refutan su eficacia cuando recibe uno de esos dos rechazos. El cambio sí estuvo cargado; no hay evidencia de una versión anterior atendiendo estos turnos.

Los últimos borradores se conservaron en **36/36 entregas**: 34 idénticos, uno con diferencias sólo de espacios y uno con eliminación autorizada de ¿/¡ y espacios. Las ofertas sin efecto ya estaban en los borradores; no fueron introducidas por una plantilla ni por un reemplazo posterior. Esto se limita a estas 36 entregas.

Hay una limitación del juez conservada sin modificar resultados: en R2/14/installments, la revisión contextual no interpreta «te dejo todo listo» como un regalo por sí mismo. Ese desacuerdo no se suma a las cinco entregas confirmadas ni permite recalificar el caso. Los scores originales permanecen intactos.

| Corrida | Solicitudes agente / juez | Total solicitudes | Tokens conocidos | Estimación con usage conocido |
|---|---:|---:|---:|---:|
| 1 | 21 / 19 | 40 | 539.966 | USD 0,057462960 + un intento sin usage |
| 2 | 19 / 18 | 37 | 503.169 | USD 0,055158606 |
| Total | 40 / 37 | **77** | **1.043.135** | **USD 0,112621566 + costo desconocido de un intento** |

El total exacto no se conoce: una solicitud del juez en R1 terminó en `DEEPSEEK_NETWORK_ERROR` sin usage tras 27.076 ms. El evaluador la reintentó y completó los juicios; ambos reportes tienen cero errores finales del evaluador. Hay 76 solicitudes con usage y una sin él. La latencia máxima del agente fue 3.416 ms; el pico de 27 segundos fue del juez, no del agente. Las recuperaciones de JSON del juez fueron una en R1 y cuatro en R2, sin cambiar criterios ni descartando sus respuestas originales.

Agente y juez solicitaron `deepseek-v4-flash`; ambos devolvieron `deepseek-flash`. La [documentación oficial verificada el 2026-11-01](https://api-docs.deepseek.com/quick_start/pricing/) indica que ese alias se sirve con V4.1-Flash-1017. La estimación usa horario valle de fin de semana por millón de tokens: caché USD 0,003, entrada sin caché USD 0,15 y salida USD 0,60. Tokens conocidos: 1.026.677 de entrada, 16.458 de salida y 348.672 de caché. El costo conocido del agente es USD 0,051818334; el del juez USD 0,060803232, más el intento no medible. Son estimaciones por usage y tarifas publicadas, no factura. Saldos de cuenta antes/entre/después: USD 4,66 / 4,61 / 4,58; no se usó su variación redondeada como costo de cada corrida. Hubo tres consultas de saldo, separadas de la inferencia.

La ejecución se aisló en un worktree exacto de `961c991`, con fuentes y evaluador sin diferencias antes y después de cada corrida. Pasaron las 100 pruebas offline previas; el hash del harness es idéntico en ambas muestras. Un primer arranque local falló porque Turbopack rechazó un symlink de dependencias fuera de su raíz. No llegó al proveedor y consumió cero solicitudes. Se copiaron las mismas dependencias dentro de la copia aislada, sin editar código, prompt, criterios, modelo o timeout, y se usó un identificador nuevo para la primera corrida real. Ese arranque abortado se conserva aparte; no fue una tercera muestra ni una repetición de resultados.

El criterio pedido exige 06/07/14 aprobados completos en ambas y cero ofertas o insinuaciones nuevas sin efecto. Fallan ambas condiciones. La aceptación completa de 41/48 y críticos 07/10/11/12/15 no se evaluó. **Sin despliegue y sin cambios de producción.**

[Tabla de los 36 turnos, borradores y entregas](evidence/2026-11-01-flash-v147-acceptance/summary.md) · [CSV con rechazos, efectos y latencias](evidence/2026-11-01-flash-v147-acceptance/per-turn.csv) · [Auditoría contextual final](evidence/2026-11-01-flash-v147-acceptance/delivery-audit.json) · [Diagnóstico y evidencia de versiones](evidence/2026-11-01-flash-v147-acceptance/diagnosis.json).

La auditoría contextual final es 31 PASS / 5 FAIL. La columna del resumen «Cruce conservador juez+Codex» combina la evidencia específica del juez con esa revisión: R1 13 PASS / 3 INDETERMINATE / 2 FAIL y R2 7 PASS / 8 INDETERMINATE / 3 FAIL. Sus indeterminados no son regalos nuevos ni sustituyen los resultados de los casos. Ambas fuentes permanecen diferenciadas. Los archivos raw del proveedor, observaciones y los 36 reportes de workflow están en `raw/r1` y `raw/r2`; cada revisión está vinculada al hash del texto entregado. El arquitecto verificó métricas, textos, efectos y cierre del gate.
