# Revisión independiente live — Agente A

## Corrida V14 de ajuste, interrumpida

Fecha: 2026-09-04. Evaluador: Codex `/root/rubric_review`, independiente de `deepseek-v4-flash` y del coordinador que modifica el candidato. La revisión sólo leyó archivos locales; no llamó API, no consultó DB ni ejecutó el workflow. Se mantiene esta evidencia aunque la versión siguiente corrija sus defectos.

**La corrida no aprueba calidad global ni los gates numéricos.** Hay nueve conversaciones completas con 30 entradas de cliente: siete de persistencia y dos de `full`. Sus 29 mensajes de salida están correlacionados con la DB exportada y el adaptador local; la entrada restante es el silencio deliberado posterior al opt-out. También existen un focal de apertura y el primer turno de `wf_03`, ambos sin export DB. No hay conversación adaptativa completa, `wf_03` completo, `wf_04` nuevo ni held-out de esta corrida.

El coordinador informó interrupción con exit 143 al identificar una incompatibilidad del esquema de reparación. El HEAD estaba limpio en `360cd37201a35bf3c4cceb82a93e809885494529` al preparar esta revisión. Las decisiones no determinísticas y los eventos de estas fuentes declaran `studyx-agent-a-brain-v14` / `deepseek-v4-flash`; el ACK y bloqueo posteriores al opt-out son determinísticos. Los reportes no incorporan por sí solos un hash de build: el enlace con el commit depende del registro de ejecución del coordinador.

Todas las fuentes son de `botpress-agent/evals/results/`, `execution_harness=processInboundTurn`, `delivery_scope=local_adapter`, con `scenario_role=adjustment` en los casos individuales. Los snapshots por turno y el agregado de persistencia se deduplican por traza: no representan conversaciones adicionales. `Tn` numera las entradas del cliente, incluyendo las que no reciben respuesta.

## Resultado observado y límites

Se verificó por lectura y recálculo la coincidencia de cada outbound disponible con autorización, turno, traza, destino, estado `submitted`, ID de proveedor y texto capturado. Esto acredita el adaptador del laboratorio, no Telegram. El cambio de curso queda persistido; el veto de llamada deja preferencia chat; el teléfono declarado queda separado de la identidad `+999`; el link autorizado corresponde a seis cuotas; la postergación conserva doce cuotas sin emitir link; el aviso de pago queda registrado sin confirmar acceso; y el opt-out posterior tiene revocación causal y cero mensajes nuevos.

La protección del backend no resuelve todos los defectos conversacionales. En `telefono_declarado`, elegir pago único provoca una solicitud de datos para enviar el link sin que el cliente lo haya autorizado. Al recibir los datos, la acción se rechaza, pero la respuesta salta a explicar qué pasará cuando informe el pago. En `llamada_rechazada` y `wf_01` se entrega de nuevo una pregunta de diagnóstico ya rechazada por repetición. Hay aperturas con barras («Bienvenido/a», «asesor/a educativo/a») y ofertas de llamada copiadas literalmente entre turnos.

La postergación de persistencia **sí recibe respuesta ahora**: T3 «Tranquilo, no hay problema… Cualquier cosa me escribís por acá». La DB conserva `monthly_12`, `awaitingReply=none` y ningún link. Esto mejora la evidencia V13, pero no acredita el antiguo `wf_03` completo: la corrida nueva se interrumpió antes de completarlo.

## Métricas recalculadas sin duplicar snapshots

Se aplicó `summarizeWorkflowMetricsV1` a las trazas de las nueve conversaciones completas y, por separado, a los dos turnos adicionales sin DB. Los números no incluyen una llamada abortada que no llegó a generar snapshot.

| Medida | Nueve conversaciones completas | Incluyendo los dos turnos parciales |
| --- | --- | --- |
| Entradas observadas | 30 | 32 |
| Turnos elegibles de modelo | 28 | 30 |
| HTTP DeepSeek observados | 32 | 34 |
| Tokens input / cache / output conocidos | 295194 / 199168 / 9211 | 312884 / 205824 / 9786 |
| Reparaciones intentadas / exitosas | 4 / 0 | 4 / 0 |
| Tasa de reparación | 14,29% | 13,33% |
| Éxito de reparación | 0% | 0% |
| p50 / p95 del workflow | 3727 / 6051 ms | 3727 / 6051 ms |
| Fallback técnico observado | 0 | 0 |
| Fallos / desconocidos de disponibilidad | 0 / 0 | 0 / 2 |

No se cumplen `p95<6000ms`, `repair_rate<=5%` ni `repair_success>=80%`. La existencia de texto y de contratos persistidos no transforma cuatro reparaciones fallidas en éxito. Los reportes conservan `quality_ready=false`, `production_ready=false` y `stability_certified=false`. Los siete casos de persistencia y su test de escritura pasaron según el resultado comunicado por el coordinador; esa afirmación no se extiende a la suite `full`, que quedó interrumpida.

## Rúbrica conversacional V2 completa

Se usa la fuente ejecutable `scripts/lib/agent-a-conversation-quality.ts`, con las mismas ocho dimensiones y anclajes del informe histórico: 1=ausencia/incumplimiento grave; 2=defecto importante; 3=adecuado con fricción; 4=bueno; 5=resuelto sin el defecto observable. La media es de ocho dimensiones. `Rel` es relevancia complementaria y no se incorpora al promedio. Un dictamen formal exige además gate duro aprobado, media ≥4 y ninguna dimensión <3. Estas notas del texto no levantan los gates de la corrida ni reemplazan calibración humana.

| Caso | Escucha | Tono | Progresión | Iniciativa | Concisión | No repetición | Cumplimiento | Continuidad | Media V2 | Rel |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P / curso_cambiado | 4 | 3 | 3 | 3 | 4 | 2 | 3 | 4 | 3.250 | 4 |
| P / llamada_rechazada | 4 | 3 | 4 | 4 | 4 | 2 | 2 | 3 | 3.250 | 4 |
| P / telefono_declarado | 3 | 3 | 2 | 2 | 4 | 4 | 2 | 2 | 2.750 | 3 |
| P / link_autorizado | 4 | 3 | 4 | 4 | 4 | 3 | 3 | 4 | 3.625 | 4 |
| P / postergacion | 4 | 4 | 4 | 5 | 4 | 4 | 3 | 5 | 4.125 | 5 |
| P / pago_informado | 4 | 3 | 4 | 4 | 4 | 3 | 4 | 4 | 3.750 | 4 |
| P / opt_out | 5 | 3 | 5 | 5 | 4 | 5 | 4 | 5 | 4.500 | 5 |
| F / wf_01_consulta_y_cambio_de_curso | 2 | 2 | 2 | 3 | 4 | 2 | 2 | 2 | 2.375 | 2 |
| F / wf_02_objecion_precio_y_rechazo_llamada | 4 | 3 | 4 | 4 | 4 | 3 | 3 | 4 | 3.625 | 4 |

**P / curso_cambiado.** Escucha/continuidad 4: T2 cambia a Excel y T3 responde al temario de ese curso. Tono 3: apertura «Bienvenido/a» y valoración genérica «una gran elección». Progresión/iniciativa 3: dos ofertas de llamada consecutivas sin explorar la necesidad nueva. No repetición 2: T1 y T2 copian «Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas». Cumplimiento 3: la segunda oferta aparece al cambiar curso, mientras el preámbulo la reserva para una segunda consulta de información. Concisión 4: T3 reduce el temario a 35 palabras; no repite el diagnóstico. DB: `excel_integral`, tres outbounds correlacionados.

**P / llamada_rechazada.** Escucha/iniciativa 4: respeta chat y no vuelve a llamar; DB `declined`, count=1. Tono 3 por apertura formularia. No repetición/cumplimiento 2 y continuidad 3: T2 vuelve a preguntar «¿ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?», igual que T1, pese a `REPEATED_AGENT_REPLY`. Progresión/concisión 4: T3 explica modalidad/contenido y T4 responde con los tres planes y un siguiente paso. No se confunde este acierto posterior con reparación exitosa de T2.

**P / telefono_declarado.** Escucha 3: guarda curso, pago único y datos, pero interpreta el avance comercial por delante del permiso visible. Iniciativa/progresión/cumplimiento/continuidad 2: T2 «Para dejarlo registrado y enviarte el link de pago, necesito…» pide intake tras elegir sólo plan. T3 «Cuando informes el pago, el equipo lo revisará…» no pregunta si quiere el link ni explica el siguiente paso pendiente. La propuesta lleva `ACTION_NOT_AUTHORIZED`; el backend conserva `payment_confirmation` y no emite URL/acción. Tono 3 por fórmulas; concisión/no repetición 4 por respuestas cortas y distintas. No se castiga la contención de la acción como fallo técnico: el defecto es la conversación desalineada.

**P / link_autorizado.** Escucha/progresión/iniciativa/continuidad 4: T2 confirma seis cuotas y pregunta «¿Querés que avancemos…?»; T3 recibe solicitud explícita y datos, persiste `monthly_6` y entrega una sola URL `/6m`. Concisión 4. Tono/cumplimiento 3 por apertura genérica «Soy tu asesora educativa» y poca adaptación al «quiero anotarme». No repetición 3: el texto anuncia el plan y el renglón materializado lo repite. El contrato local de link sí tiene correlación completa; T2 tuvo una reparación fallida y p95=6051ms.

**P / postergacion.** Escucha/progresión 4: reconoce plan y aplazamiento sin reiniciar venta. Iniciativa/continuidad 5: T3 permite retomar y no exige datos, no emite efecto y conserva plan. Tono/concisión/no repetición 4: respuesta breve y cordial, distinta de T2. Cumplimiento 3: T1 salta saludo/presentación/diagnóstico canónico y pasa al curso. El texto supera el umbral numérico de calidad; la reparación fallida de T2 mantiene rojo el gate de esta corrida.

**P / pago_informado.** Escucha/progresión/iniciativa/cumplimiento/continuidad 4: T2 registra aviso; T3 responde «El acceso al campus lo gestiona el equipo humano una vez que verifiquen que el pago está acreditado». No promete acceso habilitado ni notificación futura. Concisión 4: 18 y 30 palabras en T2/T3. Tono 3 por apertura promocional y autolimitación rígida «yo no tengo forma de habilitarlo». No repetición 3: repite «aviso de pago quedó registrado» antes de aclarar acceso. DB: `paymentReportedAt` presente; no es evidencia de acreditación real.

**P / opt_out.** Escucha/progresión/iniciativa/no repetición/continuidad 5: T2 acusa «Listo, no te enviaremos más mensajes» y T3 permanece en silencio pese a una pregunta de precio. Cumplimiento/concisión 4 y tono 3: apertura genérica; la ejecución posterior es adecuada. Revocación `2026-09-04T14:17:29.085Z`, vinculada al turno de baja, anterior a la decisión muda T3 `14:17:31.355Z`. Ninguna acción en los turnos restringidos, dos outbounds totales. Dos de sus tres turnos son determinísticos; este caso no aporta tres muestras de naturalidad del modelo.

**F / wf_01.** Escucha/progresión/continuidad 2: T4 «¿?» recibe «¡Perfecto! Excel Integral es una gran opción» y la misma pregunta diagnóstica anterior. No repetición/cumplimiento 2: la repetición se detecta pero llega al cliente; la reescritura tampoco resuelve la confusión. Tono 2: barras en apertura y «Perfecto» incongruente ante incertidumbre. Iniciativa 3: orienta con cursos disponibles al principio, luego cae en la pregunta repetida. Concisión 4: no hay desborde de longitud, pero la brevedad no compensa la pregunta omitida. El cambio a Excel y los cuatro outbounds sí quedan guardados.

**F / wf_02.** Escucha/progresión/iniciativa/continuidad 4: T3 sigue por chat y T4 contesta sólo «12 pagos mensuales de USD 30» como cuota mínima, con siguiente paso. Concisión 4. Tono 3: «Entiendo que te parezca mucho, pero…» responde de forma genérica a la objeción. No repetición/cumplimiento 3: T3 vuelve a listar las tres opciones recién dadas en T2 sin que el cliente las haya pedido de nuevo. DB chat/declined y sin despacho de llamada. No confundir esta repetición moderada con la pregunta diagnóstica literal de los casos anteriores.

## Reparación: generación, rechazo y texto realmente entregado

Los cuatro intentos de reparación tienen respuesta HTTP/usage observados, `repair_attempted=true` y `repaired=false`. En las cuatro solicitudes, el esquema `text.format.schema.properties` omite `repair_of` y declara `additionalProperties=false`. Las cuatro respuestas de reparación también omiten `repair_of`. El coordinador identificó que el resolver exige su `rejection_id`; esa incompatibilidad es compatible con los cuatro fracasos, pero no se afirma que sea la única causa semántica posible.

| Caso / turno | Rechazo original | Resultado de la reescritura y entrega |
| --- | --- | --- |
| P / llamada_rechazada T2 | `REPEATED_AGENT_REPLY`, previous_agent_question | La reescritura explica las 38 clases y pregunta por modalidad; no tiene `repair_of`. Se entrega el borrador original con el diagnóstico repetido. Traza `03172413-f8cf-4c6b-94ba-cbd0e27725bf`. |
| P / link_autorizado T2 | `FACT_VALUE_MISMATCH`, price | El borrador dice 6 pagos de USD60 y total USD360, con citas canónicas. La reescritura vuelve a pedir datos sin nuevo permiso y no tiene `repair_of`; se entrega el borrador. Traza `4f920a19-8811-483e-bbc3-0781c4fd8798`. |
| P / postergacion T2 | `FACT_VALUE_MISMATCH`, price | El borrador dice 12 pagos de USD30 y total USD360, con citas canónicas. La reescritura vuelve a pedir datos sin permiso y no tiene `repair_of`; se entrega el borrador. Traza `90096e10-d4be-416a-b6a3-6eb16e5d7f96`. |
| F / wf_01 T4 | `REPEATED_AGENT_REPLY`, previous_agent_question | La reescritura vuelve a describir Excel y repite el diagnóstico. Tampoco tiene `repair_of`; se entrega el borrador original. Traza `59c9e9b6-abd2-4b79-b4f3-7489b68c39d4`. |

Los dos rechazos de precio merecen diagnóstico gratuito: los montos visibles del borrador coinciden con los valores del contexto capturado y el rechazo sólo precisa `subject=price`. Esta revisión no atribuye una causa de implementación sin un caso reproducible. Corregir el sobre de reparación no demuestra por sí solo que una reescritura vaya a escuchar mejor, respetar consentimiento o corregir una repetición.

## Fuentes, hashes y reproducción

Los nueve archivos de caso de la tabla siguiente contienen las transcripciones completas evaluadas. El SHA de transcripción usa `buildConversationQualityReviewPacketV2`, que redacta correo/teléfono antes de calcular el hash. El SHA del archivo preserva el resto de la evidencia, incluidos los HTTP. Los nombres son únicos e inmutables.

| Caso | Archivo | SHA-256 del archivo | SHA-256 de transcripción redactada |
| --- | --- | --- | --- |
| P / curso_cambiado | `workflow-persisted-curso_cambiado-2026-09-04T14-16-19-763Z-464721c5-66cf-4f0a-8ca1-17e2238bdb97.json` | `0e6643346cbd007e1651ed86ccf2101fe0f6a77dbb7e9d2d2319c143ba6e900a` | `874ff05aad9c9d1fcfe01166a24b50356ec91a2f63ad8c5ab001124a167bbbc0` |
| P / llamada_rechazada | `workflow-persisted-llamada_rechazada-2026-09-04T14-16-37-967Z-0f1c1776-a1ee-4226-9363-29d4659000e6.json` | `d660d6c921c5f95789b2cdbd37beedb6750937229f9e41bfa3047323e2980e8f` | `674b8bddd2bc30ec1083da749bdecde8c526c29b185ea63c2dd4b8d23814e201` |
| P / telefono_declarado | `workflow-persisted-telefono_declarado-2026-09-04T14-16-48-081Z-502f2aeb-0352-4997-8a9f-c3a915b9e286.json` | `006830900e494414171bb77a6ce2cabd6119b60db80a7773c575e61d84fdcb31` | `300cc07122d690155e6154125a7132ae121ef62490cda7aa0620490694f6e6f9` |
| P / link_autorizado | `workflow-persisted-link_autorizado-2026-09-04T14-17-01-185Z-2dcf539d-5e7a-4db6-8a75-cd0db29d3b5f.json` | `d48c6fd1ad54e30aa229fbb637247b092f5bae66f9be230a6307ecc5841e08d4` | `4838bcad03d3d4ffafda2bdccb155c03476c0f05a2b342e76e85d76470c6b088` |
| P / postergacion | `workflow-persisted-postergacion-2026-09-04T14-17-14-476Z-b13a82dc-e975-4449-ba7f-3cbddfb8ec84.json` | `338291770e54ff494033e50b95e8c0a475e1e106eaf3d01c827635d90708309e` | `1cc0ac0bf448595abc3c635db95e1a66e7b8ce5e59fbf69b18deb5b245c273ec` |
| P / pago_informado | `workflow-persisted-pago_informado-2026-09-04T14-17-25-467Z-2096f5ba-2105-4aab-a192-2e3f34ecb65c.json` | `f24e9448ca2f5448e3f78b0184bf7c795227aa175fd708084133252f3bc0bab1` | `932cebec2261a48155afd66e71b664ec488128c37a16467a9d9af3b33a240894` |
| P / opt_out | `workflow-persisted-opt_out-2026-09-04T14-17-31-424Z-77376db3-e30e-4e3f-8dd1-af2656cf0e5f.json` | `3d721130cd1be40b3fc3281527cc6f2c20564b61fb76f4905950a3b950cdd4a7` | `1f63b8bf61c378178871d07c70e7e71aed1924749405793644ef75b05a77199b` |
| F / wf_01 | `workflow-conversation-2026-09-04T14-17-51-606Z-85e1ae78-87bb-4a19-80a0-0b13ca043b33.json` | `a94ee1b389e3f15be9ab67b5dd929e44c5624fcde6cf51ffdc14cad9a4c11ec9` | `190a236fdb38b7206eba82135c7cdeaf68abaa7f9d08ca41f1ac66f99fc5c957` |
| F / wf_02 | `workflow-conversation-2026-09-04T14-18-05-644Z-e46af47a-fe3d-49d2-9c1e-f456f5861af8.json` | `5df65b478979b50ad4ccf33b6c20357dc7d8c136de34d457b6f693ded54eb4b0` | `b734196c0a61e6a6e19a3371cc727a2b3a731f7af9fb5f8276fe199af8448141` |

El agregado `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json` contiene las mismas siete conversaciones; no se suma de nuevo. El focal `workflow-turn-2026-09-04T14-15-30-665Z-f209f39d-befd-4c86-844a-96863a40dd62.json` tiene un turno de apertura con «Soy asesor/a educativo/a» y diagnóstico/llamada; su SHA de archivo es `c001bdbbd245b9a4d08a113ebc579ee428ab797af53584bc8ed49cca01075451` y de transcripción `18ee068c57d733189a2d45161ece3a34168c91dd276fc96848f580ba039b4f07`. El parcial `workflow-turn-2026-09-04T14-18-09-275Z-82f937fd-140b-4dfd-825f-1396ca938bc7.json` sólo contiene la apertura de `wf_03`. Ninguno permite evaluar continuidad de una conversación completa o persistencia por DB; se conservan como evidencia parcial sin asignar ocho notas artificiales.

SHA de archivo del agregado: `ce74fc64683cc2d1a146a83b78533d079640399392d381295428ee53aa4cf244`. SHA del parcial de `wf_03`: archivo `595c3385489ab7ddd00122fb7fae96a769493d25699ba90a303de711a58a4b36`, transcripción `11d82a6061eafd2061d17b33ac4aebccd8d4f8125a27f879a10d0bd3a3161884`.

Para reproducir: leer `transcript` y `turns[].evidence.authorizedMessages`, recalcular hashes con el helper V2, correlacionar capturas contra `db.outbound`, y pasar una sola observación por `traceId` a `summarizeWorkflowMetricsV1`. Revisar los dos HTTP del turno en `evidence.httpExchanges` para cada reparación y el evento `agent_a_plannerless_v2` que registra el resultado. No sumar recursivamente todos los archivos: duplicaría tokens y turnos.

## Presupuesto y alcance de certificación

El coordinador informó para el cierre de esta corrida 36 registros HTTP, uno todavía reservado tras abortar sin usage, gasto nuevo contabilizado a tarifa pico **USD 0,083872616** y acumulado **USD 0,463872616**, incluyendo el previo USD 0,38 y con tope USD 1. Es información del ledger bajo control del coordinador, no una suma inferida por este revisor de transcripciones. Los snapshots revisados contienen 34 HTTP observados; las dos entradas restantes del ledger no se reconstruyen como consumo cero ni se restan del acumulado. El informe de ejecución del coordinador debe reconciliar su procedencia.

No hubo gasto de API de este revisor. No hay calibración con el dueño comercial, evaluación ciega, veinte conversaciones independientes del candidato ni validación held-out live en esta corrida. Las fuentes fueron leídas con procedencia conocida. No se certifica naturalidad general, reparación estable, Telegram, migración remota ni despliegue. Cualquier versión posterior debe tener resultados propios, sin reciclar estas notas como aprobación.

## Revisión gratuita posterior: wire, poda y canónico V5 / brain V15

Se revisaron las correcciones posteriores de los responsables: el esquema admite `repair_of=null` en generación inicial y exige el objeto con el rechazo real/attempt=1 en la reescritura; el resolver sigue validando la correlación y la propuesta. La poda de una pregunta repetida reconoce cambios de contenido aunque siga habiendo un solo mensaje, conserva el texto del modelo y revalida movimiento/acción. Las tres condiciones comerciales aclaradas en el canónico exigen permiso vigente antes de pedir intake o habilitar link; se conserva el resto del documento y no se agrega una respuesta comercial nueva.

No se halló bloqueante material en ese diff acotado. El revisor ejecutó cinco archivos unitarios (`agent-a-brain`, `resolve-agent-a-plannerless`, `agent-a-brain-prompt`, `agent-a-canonical-prompt`, `canonical-prompt-v2`) a las 11:27:31: **84/84 aprobadas**, incluidas la equivalencia byte a byte del generado, las 322 líneas del canónico y su SHA `35aac6be8f4999a64d8df2ef029793357956da94b1542118ea232e2d3a8e64b9`. Esto no constituye evaluación live de V15. Queda un límite explícito para esa evaluación: podar el diagnóstico de «¡Perfecto! Excel… ¿diagnóstico?» podría dejar un acuse que todavía no resuelve «¿?». Las notas V14 anteriores permanecen sin cambios.
