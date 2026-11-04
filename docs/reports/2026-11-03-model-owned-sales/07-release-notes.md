# Notas de release — venta interpretada por el modelo

## Orden de despliegue (obligatorio)

El bot de Botpress (brain v161, prompt v107) y el backend (Next.js) cambian juntos el contrato de `commercial_state.sales_profile`, `capabilities.course_bonus.sales_flow`, `turn_reasoning` y las violaciones con `message_index`. Se despliegan **uno detrás del otro, sin espera intermedia, y sin turnos en vuelo**:

1. Pausar la entrada (sin lotes reclamados ni turnos en proceso; confirmar que no queda ningún `processInboundTurn` activo).
2. Publicar el bot de Botpress (artefacto preparado con `scripts/prepare-instrumented-botpress-release.mjs`).
3. Desplegar el backend inmediatamente después.
4. Reanudar la entrada y verificar `studyx.release.loaded` y el primer turno.

Compatibilidad mínima incluida: el parseo de la claim en Botpress acepta y descarta `sales_flow.price_probe` y `sales_flow.gift_request_pending_probe` del backend anterior; el esquema de propuesta del backend acepta `turn_reasoning`. No hay más compatibilidad hacia atrás: un bot nuevo contra un backend viejo (o al revés) durante una ventana larga no está soportado.

## Procedencia de la release del bot (H2)

- `BOT_RELEASE_BASE_SHA` queda fijado en `ca58c6be7a5dc3d0c17eb47b38c0668d753a9a73`, el último commit de la rama `claude/agent-a-model-owned-sales` que cambió código desplegable (brain v161, prompt v107). Fijar el HEAD final sería circular (el propio commit del pin cambia el script); por eso el script verifica que entre el pin y HEAD sólo cambien `docs/`, `evals/`, `tests/`, `AGENTS.md` y las dos herramientas de procedencia.
- `prepare` exige: árbol limpio, base ancestro de HEAD, sin cambios de código desde la base, y etiquetas v161/v107 iguales a las del código en la base. Los hashes revisados de los tres archivos instrumentados son los de esa base.
- Si se cambia cualquier archivo de código después, hay que volver a fijar la base (el test `botpress-release-provenance` falla hasta entonces).
