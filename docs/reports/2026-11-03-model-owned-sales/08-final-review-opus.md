# Revisión final (Opus, sólo lectura) — HEAD 2d3befd

Veredicto: hacen falta cambios. No desplegar tal cual, ni siquiera a TEST.
La frontera de autoridad se cumple: no quedan jueces por regex de calidad de venta en la ruta viva.

## HIGH
- **H1 [material]:** puede commitearse una bonificación sin que la respuesta nombre el curso (full16 14/installments). Se agregaría al paquete, al link y al alta.
- **H2 [material]:** los pines de provenance del release apuntan a fdbe4e54. El script instrumentado empaquetaría el workflow del 2-nov con la etiqueta v161/v107.
- **H3 [material, a verificar]:** hard-claims (699, beca) corre sobre la URL de pago que inserta el backend.
- **H4:** no hay un orden seguro entre bot y backend (esquemas estrictos). En TEST se despliegan juntos, uno detrás del otro; antes de producción, parseo tolerante.

## MEDIUM
- **M1 [material]:** una clave de memoria no conforme en sales_profile vuelve imposible parsear el claim.
- **M2:** «tiempo limitado» con vencimiento real choca con hard-claims.
- **M3:** el arreglo del dos puntos abre un bypass: un curso inventado en minúsculas pasa.
- **M4:** la comparación exacta de oraciones informadas por el backend falla por diferencias de segmentación.
- **M5:** se anuncia offer_course_bonus durante el checkout o sin evidencia de precio.

## LOW (pendientes)
- Autoautorización por cita corta («sí»).
- Persistencia de una inyección en source_quote.
- Comentario engañoso en processInboundTurn:1527.
- Quedan varios textos fijos técnicos.
- invented_testimonial amplio.
- AGENTS.md desactualizado.
- Enums muertos.
- El reporte cuenta mal los veredictos null.

## Clasificación golden
- De acuerdo con: «regalo» (regla del golden desactualizada), 05/16 (Regla A retirada), etiquetas de move, 08 partner (fallo real).
- 14/installments también falla por H1, y debe seguir fallando.
- 16/discount falla por la memoria sin registrar y por la apertura defensiva.
- Con las correcciones justificadas el resultado quedaría en ~39–42/48, al límite del mínimo de 41. No se acredita sin volver a correr.

## Áreas «No romper» sin defectos
- Transacción de bonificación (máx. 3, uno por turno, cambio, idempotencia, checkout por estado).
- turn_reasoning fuera del hash.
- Sin 699/beca en fichas ni en hechos generales.
- Los datos faltantes siguen bloqueando el link.
- Llamadas, opt-out, audio, seguimientos y leads, intactos.
