# Notas de release — venta interpretada por el modelo

## Orden de despliegue (obligatorio)

El bot de Botpress (brain v161, prompt v107) y el backend (Next.js) cambian juntos el contrato de `commercial_state.sales_profile`, `capabilities.course_bonus.sales_flow`, `turn_reasoning` y las violaciones con `message_index`. Se despliegan **uno detrás del otro, sin espera intermedia, y sin turnos en vuelo**:

1. Pausar la entrada (sin lotes reclamados ni turnos en proceso; confirmar que no queda ningún `processInboundTurn` activo).
2. Publicar el bot de Botpress (artefacto preparado con `scripts/prepare-instrumented-botpress-release.mjs`).
3. Desplegar el backend inmediatamente después.
4. Reanudar la entrada y verificar `studyx.release.loaded` y el primer turno.

Compatibilidad mínima incluida: el parseo de la claim en Botpress acepta y descarta `sales_flow.price_probe` y `sales_flow.gift_request_pending_probe` del backend anterior; el esquema de propuesta del backend acepta `turn_reasoning`. No hay más compatibilidad hacia atrás: un bot nuevo contra un backend viejo (o al revés) durante una ventana larga no está soportado.
