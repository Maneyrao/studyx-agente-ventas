# Rúbrica conversacional del Agente A

Esta rúbrica separa tres preguntas que no pueden compensarse entre sí:

1. **Gate duro:** ¿respetó estado, catálogo, seguridad y efectos?
2. **Calidad superficial:** ¿el texto evita vacíos, extensión excesiva,
   interrogatorios, fallback genérico y repetición?
3. **Calidad conversacional:** ¿escuchó y condujo una venta humana?

Una prosa agradable nunca puede tapar un link incorrecto, una promesa falsa o
un estado roto. Un caso con gate duro rojo siempre falla.

## Evaluación independiente

El modelo objetivo (DeepSeek) no se autoevalúa. Un humano de ventas o un modelo
distinto recibe `quality_review_packet`, que contiene el transcript redactado y
su SHA-256. Devuelve exactamente cinco notas enteras de 1 a 5, cada una con
evidencia breve:

| Dimensión | 1 | 3 | 5 |
| --- | --- | --- | --- |
| Escucha y contexto | Ignora/cambia lo pedido | Retoma lo esencial | Integra pedido, objeción y contexto sin hacer repetir |
| Tono natural | Robótico o fuera de tono | Correcto pero formular | Cordial, espontáneo y consistente |
| Progresión comercial | Estanca o salta etapas | Avanza con algún roce | Lleva al siguiente paso adecuado sin presionar |
| Iniciativa apropiada | Pasiva o invasiva | Sugiere una opción razonable | Propone el mejor siguiente paso y respeta vetos |
| Concisión | Abruma o no responde | Suficiente | Breve, completa y fácil de contestar |

El SHA del dictamen debe coincidir con el paquete. Un dictamen para otro caso,
otro transcript, con dimensiones faltantes o realizado por el mismo modelo se
rechaza.

## Umbral

Un caso conversacional pasa si:

- su gate duro está verde;
- el promedio de las cinco notas es al menos 4;
- ninguna dimensión es menor a 3.

La matriz exige 20 casos efectivamente evaluados y al menos 18 aprobados. Si
faltan dictámenes, `conversation_quality_complete=false` y `rubric.ready=false`:
la heurística superficial nunca certifica naturalidad por sí sola.

## Calibración visible

Antes del held-out, el dueño comercial y el evaluador independiente puntúan
cinco transcripts visibles que representen: descubrimiento, curso elegido,
rechazo de llamada, pago postergado y curso inexistente. Si cualquier nota
difiere en más de un punto, se corrige la rúbrica o sus ejemplos; no se modifica
el caso para favorecer al agente.

Ejemplos de anclaje:

- Repite la misma pregunta luego de que el cliente respondió: escucha 1–2.
- Ofrece llamada una vez y, ante rechazo, vende por chat: iniciativa 5.
- Envía tres párrafos para contestar modalidad: concisión 2.
- Dice “no sé” ante un curso inexistente y propone un área real: progresión 4–5.
- Envía link ante “no todavía”: gate duro rojo, sin importar las notas.

## Privacidad

El paquete reemplaza correos y teléfonos por marcadores antes de calcular el
hash. Los resultados generados son locales e ignorados por Git. El held-out lo
lee sólo el evaluador independiente; quien implementa recibe agregados, motivos
y número de turno, no las frases originales.
