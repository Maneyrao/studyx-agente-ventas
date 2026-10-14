# Restauración de la autoría y continuidad de Agent A

## Diagnóstico comprobado

No se encontró un commit perdido en el merge del 7 de octubre. Los commits
`579a6cf`, `0ca24b5` y `7dabdb3`, que separan rechazo de acción, redacción y
validación semántica, son ancestros de esta rama. `bb3cf3e` incorporó doce
archivos del alta en Central; no cambió conversación, Botpress ni llamadas.
El estado objetivo sigue siendo la especificación del 1 de octubre y su plan
del 2: A interpreta y redacta; el backend informa hechos, autoriza efectos y
persiste la transición. La implementación anterior conservaba rutas que no
cumplían completamente esa separación.

La frase «No pudimos completar la llamada…» provenía de
`renderPostCallFollowup`, una plantilla antigua, presente antes del merge
y modificada por última vez en `24dc684` (29 de septiembre). La corrección
`e34130a` la ejecutó también ante un rechazo confirmado del despacho, que
puede no generar webhook. Se corrigió el silencio, pero se activó una ruta
que seguía redactando desde el orquestador. Fue una interferencia de esa
corrección, no una eliminación del prompt de autosuficiencia.

En la conversación nueva de prueba, nombre, apellido, correo y teléfono
se conservaron. La llamada `0f91c4ff-01c6-4d8a-8563-2e3ff2f69bbd` recibió
HTTP 400 de Xendra. Un reintento posterior del usuario,
`a3609e31-7c45-4242-be15-1218c5b6ab74`, fue aceptado y terminó en buzón.
No se cambió el proveedor entre ambos. El motivo del primer 400 sigue sin
demostrarse: el adaptador anterior descartó el cuerpo del rechazo y el
equipo conectado no expone el proyecto administrativo de Xendra.

El fallo de «1 pago» y «un pago de 360» fue distinto. El permiso de Botpress
exigía un plan previamente persistido y una fase comercial particular;
rechazó `send_payment_link` antes de que el backend pudiera validar la
selección actual. Además, un clasificador léxico podía borrar el
`select_payment_plan` interpretado por A. El estado seguía en `handoff` con
plan nulo; no se habían perdido los datos de contacto.

La persistencia fragmentada de Agus ya quedó corregida en `232611a`.
Ese defecto se reprodujo también en `b742e30` (1 de octubre), por lo que
no se atribuye al merge posterior. Quedaba otra pérdida de continuidad:
una reparación podía sustituir el movimiento semántico original y perder
consentimiento de llamada, selección de plan o solicitud pendiente.

## Corrección

- A conserva la interpretación de curso y plan. La autorización comprueba
  recursos canónicos, datos confirmados y compra verificada; admite elegir
  un plan y solicitar su enlace en el mismo turno.
- El rechazo vuelve como códigos y campos faltantes. A redacta una
  continuación con el mismo prompt y contexto. `conversation_only` conserva
  su movimiento semántico mientras el backend impide cualquier efecto
  explícito o implícito en esa continuación.
- Si falla una continuación opcional, se conserva la primera respuesta de
  A que ya pasó validación. Dos propuestas inseguras no producen una frase
  comercial inventada: queda registrada la supresión y su diagnóstico.
  Una indisponibilidad real del modelo conserva el aviso técnico limitado
  previsto en el contrato del 1 de octubre.
- El límite de dos solicitudes al modelo incluye transporte, reparación de
  JSON y replay de pasos durables. No es una tercera reinterpretación.
- A redacta también el seguimiento de llamada con el prompt canónico v69,
  el estado y la academia del workspace de esa llamada. No hay plantilla de
  venta ni proveedor alternativo. Un fallo de generación queda pendiente
  para recuperación; no se crea otra llamada.
- La primera redacción queda congelada antes de enviar. Recuperación,
  concurrencia y webhook usan `post-call:<call_id>`; se mantienen los
  controles de no contactar y las entregas idempotentes.
- Despacho y webhook responden con el resultado operacional antes de
  generar el seguimiento en trabajo posterior de la misma petición.
- La recuperación programada conserva sus cincuenta candidatos. Un
  presupuesto de 120 segundos impide comenzar más filas al agotarse;
  `deferred` informa las que quedan pendientes. No se reduce a tres casos
  diarios ni se marcan como completados los que no fueron procesados.

La persona y el comportamiento canónico siguen en v69, sin modificar su
contenido. Brain v101 cambia el contrato de ejecución y continuidad.
No hay migraciones de base para esta restauración.

## Verificación y publicación

Revisión independiente final: sin hallazgos críticos o importantes pendientes.
Verificación local aprobada:

- 3892 unitarias, 17 omitidas por condición de entorno y 7 pendientes previas;
  cobertura configurada: 98,91% líneas y 93,07% ramas.
- 601 integraciones con PostgreSQL limpio, una omitida; 27 integraciones de
  seguimiento repetidas tras la última mejora del presupuesto de ejecución.
- 6/6 workflows reales de ingesta, backend HTTP, estado y entrega simulada:
  identidad fragmentada de Agus, reserva/replay de llamada, recuperación de
  faltantes con autoría de A y tres formas de elegir pago único tras handoff.
- Tipos, lint, configuración ADK y bundle de Botpress aprobados. Los módulos
  del prompt canónico de backend y Botpress son idénticos byte por byte.
- Compilación final del backend aprobada con Webpack en el laboratorio; el
  despliegue remoto se construye desde fuente, con su configuración real.
- Preflight Botpress: sin cambios de configuración, dependencias bloqueantes
  ni cambios destructivos de tablas, conocimiento o assets.

El laboratorio usa modelo, pagos y voz simulados; no ejecuta cobros ni llamadas
reales. La publicación se registrará con el SHA,
deployment y comprobaciones canónicas cuando concluyan.

## Límites de la conclusión

Estas correcciones resuelven las interferencias y pérdidas de estado
reproducidas; no garantizan que un modelo interprete cualquier entrada.
El primer rechazo remoto de Xendra y el evento automático de acceso sin
ejecución de handler siguen siendo investigaciones separadas. La recuperación
de Lucas y la extensión autorizada hasta el final del 15 de octubre se
conservan.
