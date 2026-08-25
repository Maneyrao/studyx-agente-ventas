# Informe — 25 clientes realistas de Agent A

Fecha: 2026-08-23
Prompt: `studyx-agent-a-sales-v10`
Fuente comercial: `studyx_manual_1`
Entorno: Botpress Development + Next.js local + PostgreSQL desechable local.

## Alcance

Se ejecutaron 25 personas sintéticas, divididas en cinco familias: indecisos,
preguntadores, objetores difíciles, cambios llamada/chat y clientes erráticos.
Fueron 139 mensajes planificados. Cada conversación recibió una identidad E.164
sintética distinta y una fila en `sandbox_identities`; por eso no podía provocar
efectos reales sobre Telegram, WhatsApp, Stripe o Google Sheets.

## Resultado medido

| Indicador | Resultado |
|---|---:|
| Casos que aprobaron todas sus expectativas | 11/25 |
| Conversaciones que completaron todos los turnos | 23/25 |
| Contactos distintos persistidos | 25/25 |
| Contactos protegidos como sandbox | 25/25 |
| Casos con memoria activa | 21/25 |
| Casos con memoria vectorial `ready` | 21/25 |
| Interés canónico exacto persistido | 13/25 |
| Compradores que llegaron a link/outbox | 12/14 |
| No compradores que recibieron links indebidos | 0/11 |
| Rechazos de llamada respetados | 6/6 |
| Fallbacks técnicos persistidos | 0 |
| Contactos con nombre/email persistidos | 0/25 |
| Filas de Sheets con nombre/email/curso | 0/12 |

## Hallazgos prioritarios

### P0 — El bot afirma registrar datos que no guarda

Doce conversaciones recibieron respuestas como “registramos tu información”,
pero `contacts.name`, `contacts.email` y los campos equivalentes del outbox de
Sheets quedaron vacíos. El prompt prohíbe guardar PII y no existe un contrato
estructurado separado para capturar esos datos.

### P0 — Falso opt-out

“Déjame hablarlo con mi familia, no me mandes link todavía” coincide con la
expresión regular `no me mandes` y revoca todo consentimiento de mensajería. El
turno queda suprimido con `CONSENT_REVOKED`, aunque la persona sólo pidió demorar
el enlace.

### P0 — Selección válida de pago rechazada

“Quiero pagar los 360 dólares en un único pago” fue interpretado correctamente
por el modelo, pero la política determinista no reconoce el orden “un único
pago”. El backend respondió `AMBIGUOUS_OR_ABSENT_CHOICE` y dejó al cliente sin
respuesta.

### P1 — Interés comercial inconsistente

La memoria vectorial opera y sus embeddings están listos, pero los valores son
literales libres: “catering”, “markting”, “quiero aprender inglés” o “instalar
cámaras”. No existe una proyección determinista al código/nombre canónico de la
oferta. Además, el outbox descarta `offering_sku`, por lo que `curso_interes`
queda vacío incluso después de un cierre.

### P1 — Política de devolución inventada

El bot afirmó “No contamos con política de devolución o garantía de reembolso”.
La fuente canónica dice que los documentos se contradicen y ordena no afirmar
ninguna política, sino derivar el caso a inscripciones.

### P2 — Demasiada insistencia en llamada

El agente mencionó la llamada en 24/25 conversaciones, normalmente una vez. Es
coherente con la prioridad comercial definida y respetó 6/6 rechazos, pero debe
medirse conversión/abandono para decidir si esa frecuencia es óptima.

### Caso 15 — Expectativa de prueba a corregir

El cliente dijo “creo que quiero 6 cuotas” y después “quizá contado”; el agente
envió ambos links antes de que la persona pidiera esperar confirmación. La suite
pretendía que no enviara nada hasta el quinto turno, pero esa restricción aún no
había sido expresada. Este caso debe reformularse con “estoy considerando, no
confirmo” antes de usarlo como regresión.

## Orden recomendado de corrección

1. Separar “no me mandes el link” de un opt-out total.
2. Ampliar y probar las variantes lingüísticas deterministas de pago único.
3. Incorporar captura estructurada consentida de nombre/email y no afirmar
   registro hasta confirmar su persistencia.
4. Conservar y proyectar `offering_sku` al interés canónico y a Sheets.
5. Reforzar el fail-closed sobre devoluciones contradictorias.
6. Reejecutar primero los casos 5, 10, 11, 14, 15, 18, 21 y 22; luego los 25.

El reporte JSON completo, con transcript, checks SQL y fallos por caso, se
encuentra en `botpress-agent/evals/results/happy-path-realistic25-20260823.json`.
