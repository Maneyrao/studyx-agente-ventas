# Curso de regalo en el alta — tarea orquestador

Oct 22, 2026 · @Lucas Bozzolo

## Actualización de entrega — 28 oct 2026

El cuerpo del 22 de octubre describe el pedido y estado histórico, no el estado
de despliegue actual. El orquestador ahora tiene contratos locales de paquetes
directos versionados de 1–3 regalos, aceptación/snapshot, checkout, recuperación
parcial y continuidad de voz. La evidencia local está en el
[reporte Task 9](../reports/2026-10-28-agent-a-direct-bonus-verification.md).
La integración completa sigue **889 passed, 7 failed, 1 skipped**, incluyendo
sensibilidad de reloj/orden de fuentes en contact-profile. No equivale a aprobación
de producción ni a una Central o configuración de voz desplegada.

El [runbook de cutover V2](../runbooks/direct-course-bonus-v2-cutover.md) fija el
orden obligatorio y la matriz de canary: migraciones/backend aditivos en review,
readiness/schema y compatibilidad del ADK anterior, publicar ADK dual-mode y recién
entonces direct sólo para contactos allowlisted con global apagado. Volver a review
bloquea ofertas/ampliaciones nuevas y conserva la aceptación de la versión exacta
ya entregada y el pago/alta de obligaciones accepted/attached; mantener el ADK
dual-mode y nunca borrar migraciones ni promesas aceptadas.

Lucas coordina con Central la versión desplegada, mappings, Moodle nuevo/existente,
replay sin duplicación/email y recuperación real sólo del subconjunto pendiente
con `supports_partial_recovery:true`; coordina negocio y forwarding autenticado
Retell/Xendra. Thiago/nosotros verificamos suites, bundle/manifest y readiness,
compatibilidad y recibos WhatsApp autenticados de entrega confirmada. Cada entrega
requiere IDs de release, hashes, códigos/estados/tiempos y responsable de pendientes,
sin secretos/PII. Acceso, publicación, deploy, entrega real WhatsApp, recuperación
Central y forwarding externos siguen pendientes; no se inventa su ejecución.
El manifest local falló cerrado por falta de evidencia del prompt renderizado.
La tabla de owners y campos exactos del runbook es la lista de handoff vigente.

**Para:** Thiago · **Base:** `codex/orchestrator-mvp-closure` (o `main` cuando esté mergeada)

## Qué se pidió y qué se acordó con la Central

Los agentes (voz y texto) tienen que poder ofrecer "comprando este curso te regalamos otro". Con una sola venta el alumno queda inscripto en el curso pagado y en el de regalo. El contrato está en `docs/contracts/central-de-carga-enrollment.md` (§3.5, checklist de §8, §9.7–§9.9); Lucas lo commitea antes de que arranques.

- **Sin regalo no cambia nada:** se sigue mandando `schema_version: 1`.
- **Con regalo va `schema_version: 2`:** la v1 más `bonus_offerings: [{ code, display_name, promotion_code }]`.
  - De 1 a 3 regalos, sin códigos repetidos y ninguno igual a `offering.code`.
  - `promotion_code` tiene de 1 a 64 caracteres y es sólo para trazabilidad; la Central no lo valida.
  - Hace falta versión nueva porque la Central ignora campos desconocidos: un regalo en un request v1 se perdería sin aviso.
- **Un pago, un alta:** un solo `payment_id`, un job y un alta para todos los cursos. La idempotencia queda igual.
- **Errores de la Central:**
  - `422 unknown_offering`: algún código no está mapeado; no se crea nada.
  - `422 unsupported_schema_version`: la Central todavía no soporta la v2.
  - `409 idempotency_conflict`: mismo `payment_id` con otro conjunto de regalos (el orden no importa).
- **Respuesta:** la de §3.4 (`enrollment_id` y `enrollment_status` son del curso pagado) más `bonus_enrollments: [{ offering_code, enrollment_status: "active" }]`, en el orden del request y siempre `active`.
  - Un `200`/`201` garantiza que todos los cursos quedaron inscriptos. Mientras tanto el GET responde `202`/`404` y reintentar es seguro.

**Estado en la Central:**

- La v1 está en producción. La v2 está implementada en `Api_enrollments.php`, pero no commiteada ni desplegada.
- Sólo se probaron las validaciones; falta una prueba completa contra Moodle.
- El email de bienvenida es uno solo y no nombra cursos. **Nuestro mensaje de post-venta es el único lugar donde el alumno se entera del regalo.**
- En el panel de Inscripciones, la fila del regalo no se distingue de una venta.

## Lo que hay hoy en el orquestador

El orquestador no tiene promociones, combos ni pagos con más de un curso, así que el regalo se modela desde cero.

- Cada fila de `payments` tiene un solo `offering_id` (`supabase/migrations/20260817030001_canonical_payments.sql`).
- Stripe cobra un solo item por pago (`src/features/payments/adapters/stripe-checkout-provider.ts`).
- Los links fijos por plan (`config-payment-link.resolver.ts`, con `PAYMENT_LINK_12M/6M/CONTADO`) no se pueden asociar a un pago concreto.
- `buildEnrollmentRequest` en `src/features/fulfillment/central-carga/contract.ts` fija `schema_version: 1`.
- No hay flujo de reembolso hacia la Central: sólo el estado `paid → refunded` en `src/features/payments/domain/payment-state.ts`.
- `docs/ROADMAP.md:185` deja fuera de alcance los "descuentos autónomos". **El agente nunca decide un regalo:** sólo ofrece promociones que configuró negocio.
- Tu rama `codex/orchestrator-mvp-closure` reescribió la post-venta con bloques fijos del backend y un filtro de salida (`protectedFactsInContentV1`). Eso condiciona cómo se nombra el regalo (ver Trabajo, punto 4).

## Trabajo

El regalo se fija en la base antes de cobrar, y de ahí lo leen el checkout, el worker y la post-venta. Si cambia entre reintentos, la Central responde 409.

### 1. Modelo de promociones (§9.7)

Es lo primero, porque todo lo demás depende de esto. Va en una migración nueva y aditiva.

- **`promotions`:** `workspace_id`, `promotion_code` único, el curso pagado que la activa, de 1 a 3 cursos de regalo, vigencia, canales (`voice`/`text`) y `active`.
- **`payment_bonus_offerings`:** `payment_id`, `offering_id` del regalo, `promotion_id` y una copia fija de `code`, `display_name` y `promotion_code` al crear el pago.
  - Constraints: de 1 a 3 regalos por pago, sin cursos repetidos, y el regalo no puede ser el curso pagado.
  - Trigger que bloquea insertar, modificar o borrar regalos cuando el pago ya no está `pending`.
- `fulfillment_jobs` y `central_enrollments` siguen con un único `payment_id`.
- Guardar `bonus_enrollments` de la respuesta en una tabla hija de `central_enrollments` (o en un jsonb validado).
- Un regalo ofrecido después del pago queda fuera de alcance.

### 2. Checkout

- Al crear el pago, resolver la promoción y guardar los regalos en la misma transacción, antes de crear la sesión de Stripe.
- El cobro sigue siendo un solo item, porque el regalo cuesta 0. Agregar `promotion_code` a la metadata.
- Una venta con regalo usa el checkout dinámico. Con los links fijos no se puede asociar el regalo, así que se bloquea.
- **Control antes de cobrar (§9.9):** con regalo y `CENTRAL_CARGA_BONUS_ENABLED` apagado, se rechaza el pago. Nunca se cobra ni se manda como v1.

### 3. Contrato y worker de la Central

Archivos en `src/features/fulfillment/central-carga/`.

- **`contract.ts`:**
  - Agregar `EnrollmentRequestV2` (referencia: el Zod de §3.5) y `EnrollmentResponseV2` con `bonus_enrollments`.
  - `buildEnrollmentRequest` elige v1 o v2 según `payment_bonus_offerings`. Lee la copia guardada, nunca el catálogo actual.
  - Ordenar los regalos siempre igual, para que logs y replays sean reproducibles.
- **Validar la respuesta v2:** `bonus_enrollments` trae exactamente los códigos pedidos, todos `active`. Si no, la respuesta es inválida y el alta no se marca completa.
- **`client.ts`:** 409 y 422 ya van a dead letter. Sumar alertas específicas para `unknown_offering`, `unsupported_schema_version` y el 409 por regalos.
- La política de reintentos (`policy.ts`, máximo 3) no cambia.

### 4. Post-venta

Archivo: `src/features/fulfillment/post-sale/service.ts`, tal como quedó en tu rama.

- Nombrar el regalo sólo si vino en `bonus_enrollments` de una respuesta `200`/`201`.
- Ponerlo en un bloque fijo del backend (`deterministicAccessBlocks`), no en el texto del LLM. Si no, `protectedFactsInContentV1` y el filtro de salida lo bloquean, como corresponde.
- Las credenciales no cambian.

### 5. Agentes

- **Texto** (`src/features/orchestration/domain/decision-v4.ts`): campo opcional `promotion_code` en `send_payment_link`. El servidor valida que la promoción exista, esté activa y aplique al curso y al canal. Si no, rechaza la acción y lo registra.
- **Voz** (`src/features/calls/application/retell-tools.ts`): `consultar_oferta` y `consultar_curso` devuelven las promociones vigentes. Confirmar cómo una venta cerrada por voz llega al pago con el regalo, porque hoy las herramientas de voz no generan links.
- **Catálogo** (`src/app/api/agent/tools/catalog/`): mostrar las promociones de cada curso.
- **Prompt canónico** (`docs/prompts/studyx-agent-a-canonical.md` y los dos `.generated.ts`, en `src/shared/prompts/` y en `botpress-agent/src/prompts/`):
  - Ofrecer sólo promociones que existen.
  - No prometer acceso al regalo antes de la confirmación.
  - Dejar claro cuál es el curso pagado y cuál el de regalo.

### 6. Flag

- `CENTRAL_CARGA_BONUS_ENABLED=false`, con el mismo patrón que `central-carga/config.ts`, y agregarlo en `.env.example`.
- Un solo flag controla tres cosas: que el agente ofrezca regalos, que el checkout los acepte y que el worker mande la v2.

## Tests

La entrega pasa los cinco casos del checklist de §8 y los chequeos mínimos del repo.

- **Unitarios:**
  - Esquemas v1 y v2, y elegir la versión según haya o no regalos.
  - Validar la respuesta: que no falte ni sobre ningún regalo.
  - Validar `promotion_code` en `decision-v4`.
  - Post-venta con y sin regalo.
- **Base de datos** (`test:db:invariants`): los constraints y el trigger que impide modificar regalos de un pago ya cobrado.
- **Integración** (`tests/integration/central-carga-enrollment-worker.test.ts`), los cinco casos de §8:
  - 422 `unknown_offering`
  - falla a mitad de camino y reanudación
  - 409 por regalos distintos
  - un solo email
  - un solo regalo por fila
- **Además:**
  - 422 `unsupported_schema_version`
  - replay del mismo pago con un request idéntico
  - con el flag apagado, una venta con regalo se bloquea antes de cobrar
- **Antes de entregar:** `typecheck`, `lint`, `test:unit`, `test:integration`, migración limpia en Supabase local y `build`.

## Dependencias y orden

El flag se enciende recién cuando la Central confirme que la v2 está en producción. Hasta entonces todo se puede construir y probar con el flag apagado.

**Dependencias externas (las coordina Lucas):**

- **Central de Carga:** desplegar la v2, hacer una prueba completa contra Moodle y dar de alta los códigos de regalo en `application/config/enrollment_api.php`.
- **Negocio:** qué promociones hay, en qué canales y con qué vigencia.
- **Reembolsos (§9.8, junto con §9.4):** definir si un reembolso del curso pagado también da de baja el regalo. Para el MVP alcanza con una alerta y una baja manual.
- **Roadmap:** agregar esto en `docs/ROADMAP.md` (hoy la fase activa es la 8) y aclarar que no contradice la exclusión de descuentos autónomos.

**Orden sugerido:**

1. Migración y tests de base de datos.
2. Contrato v2 y armado del request, con el flag apagado.
3. Checkout y el bloqueo antes de cobrar.
4. Post-venta.
5. Herramientas de los agentes y prompts.
6. Prueba de punta a punta contra la Central en staging.
7. Encender el flag.
