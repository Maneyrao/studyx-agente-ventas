# Agente A: validación real y cierre

Estado: candidato verificado y preparado para publicar. La publicación y el canary se registrarán al finalizar, sin presentar las pruebas locales como producción.

Se continuaron exactamente tres identidades: apertura (5 turnos), llamada (5) y pago (10). No se ejecutó la campaña de veinte casos. La autorización explícita del usuario permitió validar las fuentes de credenciales indicadas; una clave autorizada funcionó. No se cambiaron secretos remotos. Se preservó el intento HTTP 401 anterior y las fallas intermedias: no fueron veinte turnos exitosos desde el inicio.

## Cuatro fallos adicionales encontrados con DeepSeek

| Capa | Fallo real | Corrección mínima y evidencia |
|---|---|---|
| Captura / commit | El cliente dio el teléfono completo, ingestion ya lo guardó y DeepSeek lo repitió en `confirmed_phone`. El commit exigió incorrectamente una sugerencia anterior del agente y rechazó un dato ya durable. | Reafirmar exactamente el teléfono canónico guardado es una operación idempotente. Cambiarlo sigue exigiendo procedencia y entrega. Regresión de integración primero roja, después aprobada. |
| Permiso / reserva de llamada | El cliente había solicitado llamar sin teléfono. Al llegar el número, DeepSeek etiquetó la continuación como `accepted_offer`; el registro exigió una oferta proactiva inexistente y devolvió `CALL_OFFER_MISSING`. | La aceptación durable pendiente, anterior a `handoff`, autoriza retomar como petición del cliente. No reinicia ni consume el contador. Se conserva el control de negativas, teléfono y llamada activa. La reproducción de las propuestas reales falló antes y pasó después. |
| Contrato del proveedor | DeepSeek devolvió `+54 11 5555 0101`. La expresión canónica exigía todos los dígitos juntos; dos intentos terminaron en fallback. | Se normalizan sólo separadores del campo telefónico antes del schema. No se infiere país, no se alteran dígitos y no se modifica el mensaje comercial. Los números locales, letras y alternativas ambiguas continúan rechazados. |
| Validación anterior al commit | Una confirmación válida decía «Dejo registrado tu teléfono». El validador miraba el intake anterior y rechazaba la confirmación que ese mismo commit iba a persistir. La reparación añadió una oferta innecesaria y terminó en otro fallback. | El recibo del teléfono declarado por `confirmed_phone` considera ese efecto propuesto. El backend prueba su procedencia y lo persiste antes de autorizar la respuesta; la excepción no completa otros datos ni concede llamadas o pagos. Ambas variantes reales pasan en el workflow completo. |

El fixture manual inicial no revelaba toda la contradicción de la llamada: su pregunta por teléfono también se clasificaba como invitación. Por eso se agregaron las propuestas exactas de DeepSeek a la regresión, conservando reales el contexto, validador, HTTP firmado, commit y PostgreSQL.

## Resultados observados

- Apertura: `Info` produjo una pregunta sobre el interés, sin curso ni plan elegidos. La recomendación posterior mostró opciones; sólo se seleccionó Instagram para Emprendedores cuando el cliente lo eligió. La preferencia posterior de chat quedó durable.
- Llamada: el primer pedido sin teléfono guardó `call/accepted`, no reservó una llamada y pidió únicamente el número. Después quedó el teléfono `+5491155550101` y una sola sesión `a35e77ea-399a-46a2-bd4c-2ac42a08312c`, estado `requested`. La continuación no creó otra sesión. El modelo sí volvió a proponer llamar en el último turno: la validación exigió una reparación, que dejó la acción en `none`.
- Pago: `Ludmi Medina` y `ludmi@example.test` se conservaron. El `Sí` guardó `+541155550101`, el número completo sugerido y confirmado en ese caso. Ante «Sí, necesito que me agendes la inscripción y me mandes el link de pago» hubo una sola acción de pago y una entrega de `https://example.invalid/eval/12m`. Estado final `payment_link_sent`, `awaiting_reply=none`. Las dos continuaciones conservaron el teléfono y el único enlace.
- Presupuesto de llamadas: la regresión completa incluye dos ofertas rechazadas, inactividad de tres días, reparación del tercer intento y solicitud posterior del cliente. Contador final dos y una sola reserva, incluso después del replay. La memoria recuperada no puede reiniciar ese contador.

El proveedor recibió el mismo modelo configurado de producción, `deepseek-v4-flash`, con razonamiento desactivado. Reportó `deepseek-flash` en las respuestas. Hubo 24 solicitudes, incluidas reparaciones y el 401 anterior; estimación conservadora registrada USD 0,0695. No es una factura del proveedor.

## Redacción y límites

El prompt final es brain v79 / canónico v45, de 47 líneas frente a las 148 originales. La primera evaluación todavía mostró recapitulación de curso y precio al enviar el link y aperturas repetidas. Se sustituyó la orden de recapitular los datos por una confirmación breve de avance y se aclaró que el enlace se acompaña sin repetir la selección. La continuación final respondió directamente a la consulta, sin precio, curso, datos ni un segundo enlace. Las respuestas normales observadas tuvieron uno o dos mensajes; la apertura con opciones usó tres con lista y cierre.

Esto verifica una muestra y las protecciones transaccionales; no garantiza redacción perfecta ante cualquier entrada. No se repitió un pago nuevo desde cero con v79: se continuó la misma identidad para respetar el límite de tres conversaciones. El modelo conserva margen para proponer algo innecesario, como mostró la llamada ya pendiente; el rechazo y la reparación funcionaron. El detector narrativo heredado de invitaciones no comprende toda paráfrasis posible; el contrato exige declararlas en `response.call_offer`. No se añadieron regex comerciales para perseguir variantes.

El formato E.164 confirmado no prueba que el teléfono sea alcanzable. El laboratorio usa proveedor de pago falso y entrega local: la evidencia prueba la reserva durable de llamada y el envío de un link canónico de pruebas, no una llamada física ni un cobro de Stripe. La muestra productiva posterior se limita al canary autorizado.

## Gates

3.483 unitarios aprobados; 16 omitidos y 7 pendientes preexistentes. 532 integraciones aprobadas y una omitida, incluyendo concurrencia, replay, fallos inyectados, Sheets, pagos, memoria, opt-out y A↔B. Nueve regresiones verticales, 27 turnos más reintentos, aprobadas. Lint y typecheck raíz y Botpress aprobados. Build Next.js aprobado; el artefacto final de Botpress se construye desde el commit congelado antes de publicar.

La primera repetición del gate unitario inyectó por error la URL de la base del laboratorio y activó pruebas de proyección; además el sandbox bloqueó el socket local del worker. La repetición con el entorno unitario correcto pasó; no se alteraron las pruebas para ocultarlo. Los checks de Botpress dieron `valid=true`, sin errores ni advertencias; su telemetría no pudo salir del sandbox.

[Evidencia real por turno](evidence/2026-09-23-real-conversation/live-observed.json.gz), [estado y resultados](evidence/2026-09-23-real-conversation/live-results.json), [regresión vertical completa](evidence/2026-09-23-real-conversation/final-workflow-observed.json.gz), [gates y fallos antes/después](evidence/2026-09-23-real-conversation/final-gates.json).
