# Preguntas bloqueantes del refactor conversacional de Bot A

Fecha de corte: 2026-08-24. Estas preguntas no se responden desde ingeniería. Cada una indica qué bloquea, dos opciones cerradas y un default fail-closed que permite avanzar sin inventar datos.

## 1. Bloquean activar G1 o cerrar contratos de G2

### Q1 — ¿Cuál es el catálogo comercial autoritativo?

**Bloquea:** activar el resolvedor, afirmar que un curso existe/no existe, recomendar alternativas y validar producción.

- **A.** Snapshot de Supabase remoto aprobado por negocio, con fecha/versión, checksum y taxonomía explícita.
- **B.** Archivo congelado aprobado por negocio con los 35 diplomados, 9 academias, aliases y vigencia; luego se carga de forma controlada.

**Default seguro:** desarrollar con fixture local marcado `non_production`; no afirmar completitud ni activar el resolvedor en tráfico real.

### Q2 — ¿Cómo se explica la diferencia entre 40 offerings locales y 35 diplomados?

**Bloquea:** conteos, filtros por área/tipo y la interpretación de “no encontrado”.

- **A.** Los 40 incluyen otros tipos/variantes; negocio entrega la regla de clasificación y qué tipos vende Bot A.
- **B.** Los 40 son datos desactualizados o incorrectos; negocio entrega la lista que reemplaza/corrige el snapshot.

**Default seguro:** no equiparar offering con diplomado; filtrar solo fixtures explícitamente aprobados y no modificar datos remotos.

### Q3 — ¿Qué debe ocurrir cuando el snapshot está truncado o no disponible?

**Bloquea:** contrato final de `not_found` y comportamiento fail-closed.

- **A.** Cargar/paginar el catálogo completo antes de resolver; si falla, respuesta técnica sin afirmar existencia o ausencia.
- **B.** Resolver únicamente el subconjunto visible y derivar a una persona/sistema externo para ofertas no visibles, diciendo explícitamente que no se pudo verificar.

**Default seguro:** A; `not_found` queda prohibido con `complete=false`.

### Q4 — ¿Bot A puede mencionar precios por chat?

**Bloquea:** valor productivo de `PricePolicy` y tests de egreso monetario.

- **A.** Nunca menciona importes; solo explica planes sin precio y ofrece el paso acordado.
- **B.** Menciona únicamente importe y moneda auditados del snapshot cuando `price_assertable=true`.

**Default seguro:** A, `never_in_chat`.

### Q5 — ¿Cómo se distingue precio de lista, beca y promoción?

**Bloquea:** claims de descuento/ahorro, etiquetas comerciales y cualquier comparación de precio.

- **A.** El snapshot agrega campos autoritativos separados, vigencia y regla de presentación aprobada.
- **B.** Bot A no menciona lista, beca, descuento ni ahorro; solo usa el precio autorizado vigente, si Q4 permite mostrarlo.

**Default seguro:** B; no inferir que una diferencia es beca o descuento.

### Q6 — ¿Dónde vive la fase comercial canónica?

**Bloquea:** ownership de escritura, migraciones y reglas de concurrencia de G2.

- **A.** Es una proyección derivada de decisiones, llamada, pago, opt-out y preferencia existentes; no se agrega una autoridad persistente.
- **B.** Se persiste explícitamente en el store autoritativo de conversación, con versión y transición transaccional; negocio/arquitectura identifica la tabla dueña.

**Default seguro:** A en shadow mode; no crear tabla/columna hasta completar el inventario de estados.

### Q7 — ¿Qué regla define las alternativas ante un curso inexistente?

**Bloquea:** ranking estable y copy determinista de `not_found`.

- **A.** Hasta tres ofertas activas de la misma área explícita/recordada, ordenadas por una prioridad de catálogo aprobada.
- **B.** Solo alternativas curadas por negocio para cada necesidad; si no hay mapping, una pregunta de área sin recomendar.

**Default seguro:** preguntar el área; no recomendar por similitud semántica sin una regla aprobada.

## 2. No bloquean el dominio puro, pero sí efectos reales o salida a producción

### Q8 — ¿Qué PSP y contrato de link quedan autorizados?

**Bloquea:** activar links reales, allowlist productiva y webhook de pago.

- **A.** Stripe con los adapters actuales, IDs/URLs exactos y webhook autoritativo.
- **B.** Otro PSP; debe implementar el puerto existente y los mismos invariantes antes de habilitarse.

**Default seguro:** provider fake/local; ningún link ni pago real.

### Q9 — ¿Cuál es la política exacta de opt-out?

**Bloquea:** cardinalidad esperada de outbound, retención del estado y reactivación por canal.

- **A.** Un único acuse aprobado y luego silencio durable hasta reactivación explícita del usuario.
- **B.** Silencio inmediato, sin acuse, y reactivación solo por una nueva iniciativa válida del usuario.

**Default seguro:** B; cero outbound comercial después del opt-out.

### Q10 — ¿Qué evento crea o actualiza Google Sheets?

**Bloquea:** semántica productiva, tests de no compradores e idempotencia de filas.

- **A.** Crear lead al capturar identidad/curso; actualizar la misma fila en llamada, link y pago.
- **B.** Crear una única fila solo al recibir pago confirmado; antes, mantener estado únicamente en PostgreSQL.

**Default seguro:** no escribir Sheets desde interés, prosa o declaración del usuario; usar fake local hasta fijar evento/campos/clave idempotente.

### Q11 — ¿Qué evento de Agente B autoriza la acción B→A?

**Bloquea:** follow-up, link o alta posterior a la llamada y smoke real A↔B↔A.

- **A.** Webhook/evento firmado y correlacionado de Retell con `call_id`, estado terminal y variable estructurada permitida.
- **B.** Resultado revisado/confirmado por una persona antes de emitir cualquier acción comercial de A.

**Default seguro:** registrar el evento como pendiente; no enviar link, dar de alta ni afirmar resultado sin evento autoritativo, firma e idempotencia.

### Q12 — ¿Qué PII puede persistirse y por cuánto tiempo?

**Bloquea:** producción, auditoría de seguridad, scan durable y política de Sheets.

- **A.** Allowlist mínima: nombre, email y teléfono necesarios; DNI, tarjeta, CVV, secretos y credenciales se descartan/redactan de superficies derivadas.
- **B.** Se conserva inbound original adicional por obligación definida, cifrado y con acceso/retención auditados; derivados siguen redactados.

**Default seguro:** A y mínima retención; nunca eco ni copia de datos de pago/secretos.

### Q13 — ¿Cuál es el camino de proveedor/fallback que debe aprobar release?

**Bloquea:** prueba de paridad y configuración productiva; no bloquea fast paths deterministas.

- **A.** Workflow con proveedor primario y failover Gemini↔Groq explícito, acotado e instrumentado.
- **B.** Un proveedor configurado por deploy; ante error, fallback determinista sin invocar otro proveedor.

**Default seguro:** B; una inferencia máxima y respuesta determinista segura. No asumir que el failover del runner existe en Botpress.

### Q14 — ¿Qué SLO de canal es obligatorio?

**Bloquea:** aceptación de Gate B y alertas de rollout.

- **A.** Adoptar como objetivo productivo p95 <2,5 s para fast paths y p95 <8 s para turnos con modelo.
- **B.** Negocio define otro SLO por Telegram/WhatsApp, con cold start, retry y ventana de medición explícitos.

**Default seguro:** A como presupuesto de ingeniería, sin declararlo SLA hasta medir canary real.

### Q15 — ¿Quién custodia held-out y cuál es el umbral final?

**Bloquea:** veredicto final independiente y aprobación del PR.

- **A.** Custodio no implementador; 20/20 held-out y cero fallos duros.
- **B.** Custodio no implementador; mínimo 19/20 (95%), pero cualquier fallo C/D o hard invalida la corrida.

**Default seguro:** B para planificar capacidad; cero tolerancia en C/D/hard. El dueño debe ratificar el umbral antes del freeze.

### Q16 — ¿Cuál es el canal y porcentaje del canary?

**Bloquea:** activación gradual y rollback productivo.

- **A.** Telegram sandbox/contactos sintéticos, luego WhatsApp con un porcentaje pequeño aprobado y expansión por gates.
- **B.** WhatsApp solo con allowlist explícita de testers antes de cualquier porcentaje de clientes.

**Default seguro:** A hasta terminar smoke; cero tráfico real no autorizado.

## 3. Respuestas mínimas necesarias para empezar

- G1 puro puede empezar sin respuesta usando fixtures; para activar catálogo requiere Q1–Q3 y Q7.
- G2 puede construir contratos con políticas parametrizadas; para cerrar persistencia requiere Q6 y para activar precio/link requiere Q4, Q5 y Q8.
- G3 local puede avanzar con defaults seguros; su oráculo final necesita Q9–Q12.
- G4 y producción requieren Q13–Q16 además de todas las decisiones anteriores.

Si una respuesta queda abierta, el comportamiento es fail-closed y se registra como `[FALTA DATO]`; jamás se completa con una suposición comercial.
