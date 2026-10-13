# Recuperación de llamadas — 13 de octubre de 2026

## Qué corrige

En el incidente de Lucas, Emma respondió «te llamo ahora» con `business_action: null`; no existió una sesión de llamada ni un intento al proveedor. La corrección parte de `a69970a`, cuya fuente del backend coincide con el despliegue auditado, en la rama `codex/lucas-call-recovery`.

La excepción de coherencia para llamadas vuelve a ser obligatoria aun con `semantic_rejections: advisory`. El modelo puede corregir su respuesta una vez. No se publica una promesa de llamada si no existe una acción autorizada; si faltan datos o confirmación, conserva la intención y los solicita. La verificación también se aplica después de resolver la autorización en el backend y al texto de `call_offer`.

Las preguntas, ofertas condicionales y negaciones reales permanecen permitidas. Una frase de tranquilidad, otra pregunta o una pregunta de cierre no pueden ocultar una afirmación operativa. Una solicitud existente permite confirmar su registro, pero no autoriza otra llamada ni demuestra que el proveedor la aceptó.

La captura de identidad conserva nombre y apellido declarados juntos, incluidos nombres compuestos. Los requisitos de llamada quedan alineados: nombre, apellido, teléfono utilizable y confirmación de disponibilidad. El correo no es requisito.

Cuando el despacho tiene un fallo confirmado, se ejecuta inmediatamente el seguimiento persistente ya existente. Esto cubre un rechazo del proveedor y un error de configuración anterior a cualquier petición externa. El aviso y el evento interno son únicos por llamada; replay y webhooks posteriores no duplican ni llamada ni mensaje. Los resultados ambiguos permanecen pendientes de conciliación.

Los diagnósticos registran la reparación por incoherencia, su código y la segunda generación. Se conserva el contrato existente de 0–2 generaciones; no es un contador de todas las peticiones HTTP, incluidos reintentos de transporte.

## Publicación

- Backend y Botpress requieren publicación coordinada desde esta rama.
- No requiere una migración nueva ni modificar registros de Lucas.
- Prompt canónico `v69`; instrucciones del agente `v100`.
- Actualizar el identificador de versión del despliegue: el marcador anterior de health estaba desfasado respecto de su fuente real.
- Confirmar el artefacto y la versión activos antes del canario.
- Con una persona disponible y su consentimiento, verificar una llamada real, su sesión y la aceptación del proveedor. Un mensaje de Emma por sí solo no demuestra el despacho.

## Verificación local

Se observaron fallos antes de cada corrección y luego pasaron las pruebas de regresión correspondientes. PostgreSQL se inicializó desde cero en el puerto local 55434, aplicando migraciones y seed; no se usó la base de producción.

- Unitarias completas: 3.785 aprobadas; 17 omitidas y 7 pendientes preexistentes.
- Cobertura del alcance configurado (heurísticas): 98,85% de líneas y 92,52% de ramas; umbrales aprobados.
- Integración completa: 591 aprobadas; 1 omitida.
- TypeScript y ESLint del backend: aprobados.
- Backend de producción: build con Webpack aprobado y `/api/ready` devuelve 200 al arrancar el artefacto local. El build predeterminado con Turbopack rechaza el symlink de dependencias compartidas usado en este worktree.
- Botpress: `check` válido sin errores ni advertencias, TypeScript aprobado y artefacto compilado.
- Recorrido del incidente: 2/2 pruebas aprobadas, también contra el artefacto del backend compilado para producción. Reparación, identidad completa, consentimiento, reserva y replay, con workflow, HTTP firmado y PostgreSQL reales; sólo la generación del modelo está controlada. Si la reparación insiste en la falsa promesa, se entrega un único aviso técnico, sin llamada ni afirmación de saturación inventada.
- Despacho: adaptador real con HTTP controlado para rechazo 503, configuración ausente y constructor fallido; se comprueban estado terminal, un aviso y ausencia de duplicados.

Las primeras ejecuciones detectaron interferencia de variables de Sheets del runner y un timeout de un proceso auxiliar bajo carga. La integración final se ejecutó sin esas variables y las unitarias finales con concurrencia limitada a cuatro workers. No se relajaron las aserciones.

Los cambios en versiones y huellas de pruebas del prompt reflejan el nuevo artefacto; no alteran sus requisitos. El límite de extensión del prompt se mantuvo.

La regresión ampliada de workflow resultó en 9/12 pruebas aprobadas. Los tres fallos se reprodujeron idénticos en un snapshot intacto de `a69970a`, con su backend aislado: intake/pago hace dos generaciones ante `CALL_OFFER_REQUIRED` cuando el fixture espera una; el detalle de cursos se conserva cuando otra prueba esperaba podarlo; y una comparación de cursos no se repara cuando la prueba espera reparación. Los dos últimos reflejan la política advisory incorporada el 2 de octubre. No se debilitaron ni reescribieron esas pruebas ni se cambió esa política general para ponerlas en verde. Son pendientes previos, no regresiones de esta corrección.

## Límites

No se realizó una llamada real ni una evaluación pagada del modelo. Los recorridos controlados verifican la ejecución y el manejo de errores, no garantizan cada redacción posible de un modelo. El detector protege las afirmaciones operativas cubiertas; no es un clasificador universal del lenguaje.

El mensaje que quedó sin reclamar durante la prueba original es un hallazgo separado de la auditoría. Su causa no quedó demostrada y este cambio no pretende corregirla.

Estado de publicación: corrección local, pendiente de despliegue y canario supervisado.
