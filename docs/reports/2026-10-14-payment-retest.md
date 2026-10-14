# Retest de pagos posterior a bee55aa

## Evidencia de producción

Los mensajes de prueba llegaron a Botpress y al backend. El health canónico
respondía 200 con `bee55aa`. Las primeras respuestas de las 09:16 Argentina
quedaron reemplazadas por mensajes entrantes más recientes
(`SUPERSEDED_BY_NEWER_INBOUND`); hubo respuestas entregadas después. Esto
explica ese intervalo observado, pero no demuestra que cualquier silencio
posterior tenga la misma causa.

Nombre, apellido, correo y teléfono seguían persistidos. No había una compra
pagada de la selección actual que justificara negar el enlace. Los pasos
durables del workflow muestran las propuestas originales, sus rechazos y la
continuación. La evidencia privada se conserva fuera de Git.

| Traza | Propuesta de A | Resultado anterior |
| --- | --- | --- |
| `6daf7307-f5f3-4c62-90e9-d994e1eff126` | `select_payment_plan`, `one_time`, sin movimientos secundarios, herramienta `send_payment_link` canónica | `PLAN_NOT_SELECTED` y `ACTION_NOT_AUTHORIZED` |
| `27d379fa-e3c9-4762-a8ee-98cfd13498e9` | `select_course`, curso/plan persistidos, herramienta de pago canónica | `ACTION_NOT_AUTHORIZED` |
| `6d1032b2-4366-459d-a7af-33afea420945` | Oferta condicional «si quieres te paso el enlace de pago ahora mismo» | Se interpretó como un efecto prometido |
| `01bd570b-0ffe-41f2-b82b-76ec8bf0151d` | Pregunta «Te envío el enlace de pago para avanzar?» | Se interpretó como un efecto prometido |

En otro flujo se observó el mismo rechazo con doce cuotas. La siguiente
propuesta, que sí incluía `request_payment_link`, produjo el enlace. Por eso
la evidencia apunta a nuestra autorización duplicada; no acredita una caída
del proveedor de pagos.

## Causa y diferencia con las pruebas anteriores

La corrección publicada quitó la exigencia de un plan en un turno anterior,
pero dejó otra exigencia: el movimiento debía incluir `request_payment_link`
además de la petición explícita a la herramienta. A había solicitado la
operación correctamente, usando su movimiento principal para registrar la
selección del plan o del curso. Ambas capas rechazaban esa variante.

Los workflows anteriores incluían precisamente las dos etiquetas. Pasaron,
pero no cubrían las propuestas reales anteriores. La verificación anterior
no demostraba que todas esas variantes funcionaran. No se encontró evidencia
de un commit perdido en el merge; la comparación histórica sigue en el
informe de restauración de autoría.

La guarda de promesas de pago ignoraba el alcance de preguntas y condiciones.
Además, conservar sólo el movimiento en una continuación perdía la solicitud
explícita cuando el movimiento era `select_payment_plan`, sin etiqueta de
solicitud. Era una pérdida de intención pendiente, aun con identidad completa
conservada.

## Corrección de la fase 6

- La herramienta explícita expresa la solicitud. Curso, plan, datos,
  consentimiento, compra pagada y vetos se validan con recursos canónicos;
  no se exige una segunda etiqueta de intención.
- Elegir un plan con `proposed_action=none` sigue sin crear un checkout.
  Preguntas y ofertas condicionales conservan el texto exacto de A.
- Un detector portable único evita diferencias entre Botpress y backend.
  Negaciones, preguntas y condiciones tienen alcance local; una pregunta
  posterior no borra una afirmación independiente de envío ya realizado.
- La continuación transporta `requested_action`, la operación original
  tipada, únicamente bajo `conversation_only=true`. Persiste la solicitud
  válida mientras todos los efectos están deshabilitados. No inventa otro
  movimiento semántico. Recibir los datos faltantes permite retomar el permiso
  pendiente una sola vez; recursos inválidos no lo crean.
- El curso canónico indicado por A no requiere repetir su nombre en el texto.
  Un identificador inexistente sigue rechazado.
- Se elimina la instrucción de ejecución que convertía un `not_found` del
  buscador en una interpretación obligatoria de lo que quiso decir el usuario.
  A recibe ese resultado como dato, junto con el catálogo autorizado.
- Se restaura en la fuente el callback previo a cada petición real al modelo.
  En `bee55aa` no estaba conectado dentro del generador, aunque el caller ya
  lo pasaba. Se verifica nuevamente el límite físico de dos peticiones y la
  coincidencia de fuente y bundle después de construir.

El prompt canónico v69 permanece intacto; Brain pasa a v102. No hay migración
de base, borrado de conversación, cobro o llamada real por la auditoría.

## Verificación y publicación

Fuente preparada y verificada; publicación pendiente en este checkpoint:

- 3994 unitarias aprobadas; 17 omitidas por condición de entorno y 7 pendientes
  previas. Cobertura configurada: 98,91% líneas y 93,07% ramas.
- 601 integraciones aprobadas en PostgreSQL local limpio; una omitida.
  El primer intento tenía la configuración global de Sheets del runner y
  activó proyecciones ajenas a seis expectativas del harness. La base tenía
  los mismos functions/triggers que la prueba anterior aprobada. Se repitió
  con el entorno explícito correcto, sin cambiar ni omitir esas pruebas.
- 8/8 workflows con ingesta, backend HTTP compilado y base reales, modelo y
  proveedores simulados: tres recorridos de llamada/intake, tres elecciones
  de pago tras handoff, pregunta de permiso seguida de petición explícita y
  solicitud de pago pendiente seguida de datos completos y replay sin duplicar.
- Revisión independiente: dos hallazgos importantes corregidos antes de
  publicar. La selección no resuelta se conserva desde parse hasta backend,
  para impedir reutilizar el curso anterior; preguntas posteriores no borran
  una afirmación independiente de envío. Revisión final sin hallazgos críticos
  o importantes pendientes.
- Lint, tipos de backend/ADK, compilación Webpack y ADK aprobados. Validación
  ADK `valid=true`, sin errores. 128 pruebas de Brain, continuidad y contrato
  repetidas después de construir; incluye callback de presupuesto real.
- Las 303 fuentes verificadas no cambiaron tras los builds ni el preflight
  prod. Ambos módulos canónicos v69 siguen idénticos byte por byte. Bundle
  contiene Brain v102, v69, callback físico y `requested_action`.
- Preflight prod Botpress: sin cambios de configuración, dependencias
  bloqueantes ni cambios destructivos de almacenamiento. Dos avisos de claves
  opcionales heredadas no participan en la ruta productiva de Agent A.

El backend se publicará primero porque debe aceptar el campo opcional del
nuevo caller; admite también al caller anterior. Luego se publicará el mismo
bot, preservando su configuración y las conversaciones existentes.

## Alcance

Estos cambios eliminan las restricciones y la pérdida de intención
reproducidas. No demuestran el motivo del HTTP 400 previo de Xendra ni
garantizan la interpretación de toda entrada por el modelo. El manejo de
errores de llamada, la persistencia fragmentada y las entregas idempotentes
se conservan y se verifican junto con pagos.
