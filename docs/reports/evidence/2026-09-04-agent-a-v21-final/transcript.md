# Agente A V21 — transcripción de regresión paga

Ejecución: 2026-09-04 22:00 UTC  
Caso: `telegram_photography_call_first_cash_link`  
Harness: `processInboundTurn`  
Modelo: `deepseek-v4-flash`  
Datos personales y enlace: sintéticos  
Entrega: adaptador local correlacionado; no certifica recepción por Telegram

El proceso de Vitest terminó con código 0 después de las aserciones finales. El reporte se escribe antes de esas aserciones y por eso conserva el estado técnico `observed_before_final_assertions`.

## Transcripción

**Cliente:** Hola, quisiera información del curso de fotografía.

**Agente:** ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos. Encontré dos cursos de fotografía: Fotografía con Celulares para Tiendas Online y Fotografía Profesional. ¿Cuál de los dos te interesa más para contarte los detalles?

**Cliente:** Me interesa Fotografía Profesional.

**Agente:** ¡Excelente elección! Fotografía Profesional es un curso de la Academia de Emprendedores con 41 clases, pensado para que conozcas desde cero todo el proceso fotográfico digital actual. Es 100% online y en español.

¿Te gustaría que te cuente los detalles por una llamada breve?

**Cliente:** Quizás personal.

**Agente:** ¡Perfecto! Fotografía Profesional te sirve muy bien para uso personal: vas a aprender a manejar tu cámara, componer mejor tus fotos y sacar provecho del proceso digital completo, todo desde cero y a tu ritmo.

¿Te parece si te cuento los detalles del curso en una llamada breve?

**Cliente:** No quiero una llamada; prefiero que sigamos por chat.

**Agente:** ¡Perfecto, seguimos por chat! 😊 Fotografía Profesional es un curso de 41 clases, 100% online y en español, pensado para que aprendas desde cero todo el proceso fotográfico digital. ¿Ya tenías conocimientos previos de fotografía o partís desde cero?

**Cliente:** ¿Cuál es el precio total y qué opciones de pago tienen?

**Agente:** El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es USD 360 en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

**Cliente:** Elijo hacer un pago único al contado.

**Agente:** ¡Perfecto! Queda elegido el pago único de USD 360. ¿Querés que avancemos con eso para dejarlo registrado?

**Cliente:** Sí, quiero avanzar ahora: mandame el enlace para pagar al contado.

**Agente:** ¡Perfecto! Para dejarlo registrado necesito tu nombre, apellido, correo electrónico y teléfono.

**Cliente:** Inés

**Agente:** ¡Gracias, Inés! Me falta tu apellido, tu correo electrónico y tu teléfono para dejarlo registrado.

**Cliente:** Valdés

**Agente:** ¡Gracias, Inés Valdés! Me falta tu correo electrónico y tu teléfono para dejarlo registrado.

**Cliente:** ines.valdes@example.test

**Agente:** ¡Gracias, Inés! Solo me falta tu teléfono para dejarlo registrado.

**Cliente:** +1 305 555 0176

**Agente:** ¡Gracias, Inés! Quedó registrado tu teléfono. Te envío el enlace para el pago único de USD 360.

Pago único de USD 360: https://example.invalid/eval/contado

## Resultado verificable

- 11/11 turnos con un request real a DeepSeek por turno.
- Cero reparaciones, fallback, silencios y fallos HTTP.
- p50 3.292 ms; p95 3.900 ms.
- Estado final: `fotografia_profesional`, `one_time`, `payment_link_sent` y llamada `declined` después de dos ofertas.
- PostgreSQL conservó `Inés Valdés`, correo y teléfono declarado.
- Una decisión `send_payment_link`, un enlace registrado y el mismo enlace en el outbound capturado.
- El `outboundId` final coincide con la captura del adaptador.
- Naturalidad independiente: 4,25/5. El principal punto de pulido es la repetición de fórmulas.

El enlace `example.invalid` es intencional en laboratorio. El canario supervisado debe comprobar que producción usa el enlace canónico configurado y que Telegram lo muestra al usuario.
