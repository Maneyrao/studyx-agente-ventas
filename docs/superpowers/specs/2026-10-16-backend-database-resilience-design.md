# Resiliencia de base del backend — diseño 16/10/2026

## Problema demostrado

El backend productivo usa `postgres.js` sobre el pool transaccional de Supabase en Vercel Fluid Compute. Los registros del deployment activo contienen múltiples requests de `ingest`, `decision`, `delivery` y `receipts` terminadas por Vercel exactamente a los 300 segundos. En los casos de `ingest`, la ejecución llega a `persistence_requested` y no obtiene una respuesta de PostgreSQL; el mismo trabajo luego completa en una instancia nueva en menos de un segundo.

La configuración productiva conecta como `postgres`, no como `orchestrator_role`. Por eso no recibe `statement_timeout=8s`, `lock_timeout=1500ms` ni `idle_in_transaction_session_timeout=10s`, aunque la migración que configura esos límites ya está aplicada. El deployment activo tampoco contiene `connect_timeout=5`.

Supabase documenta este patrón para clientes persistentes en funciones serverless: una instancia puede reanudarse con un socket TCP vencido y quedar esperando hasta el límite de ejecución. La corrección recomendada para caminos transaccionales con `postgres.js` es una verificación corta de liveness y el reciclado del cliente cuando esa verificación vence.

## Objetivo

Eliminar los bloqueos de 300 segundos atribuibles a conexiones PostgreSQL vencidas o sin límites, convertirlos en recuperación transparente o error reintentable acotado, y mantener intactas la autonomía, el texto y la personalidad del Agente A.

## Diseño

1. `src/lib/db/orchestrator.ts` seguirá exportando un único `sql` compatible con `postgres.Sql`, pero será una referencia estable que delega al cliente activo. Así los stores ya construidos no conservan una conexión descartada.
2. El primer query o transacción después de la ventana de liveness ejecutará una consulta pequeña que comprueba conexión, usuario y límites efectivos. Las llamadas concurrentes compartirán una sola verificación.
3. Si esa consulta no termina en 1.500 ms, el cliente viejo se destruye con `end({ timeout: 0 })`, se crea uno nuevo y se verifica una vez. Dos fallos producen `ORCHESTRATOR_DATABASE_UNAVAILABLE` en menos de cuatro segundos; nunca se espera al techo de Vercel.
4. Las verificaciones exitosas se reutilizan durante 15 segundos. En tráfico normal no se añade una consulta por operación; después de inactividad se añade un único round trip de PostgreSQL.
5. El pool conserva `max=1` y `prepare=false`. Se añade `idle_timeout=20`, se conserva `connect_timeout=5` y no se cambia `max_pipeline` sin una prueba específica de compatibilidad con Supavisor.
6. En producción la verificación exige `current_user=orchestrator_role` y límites iguales o más estrictos que 8 s / 1,5 s / 10 s. Una credencial administrativa o una política más laxa deja readiness en 503 y no ejecuta el query de negocio.
7. Los timeouts de los probes cancelan el query pendiente. Un probe vencido no puede quedar ocupando la única conexión de una instancia caliente.

## Fronteras que no cambian

- No se modifica ningún prompt, persona, regla comercial ni archivo de Botpress.
- Agent A continúa interpretando, redactando y decidiendo; el backend conserva validación, persistencia y efectos.
- No se agregan Redis, Kafka, una cola nueva, otra base ni un servicio adicional.
- No se eleva `DB_POOL_MAX` para ocultar el problema.
- No se reintenta ciegamente un write cuyo resultado sea ambiguo. Sólo se repite la verificación de conexión antes del trabajo de negocio.

## Rollout y reversión

La base ya contiene las migraciones `20261015000001` a `20261015040001`. Antes del despliegue se ejecutan todas las suites locales y un build con configuración productiva. Luego se asigna una contraseña nueva a `orchestrator_role`, se valida el acceso por el pooler y se actualiza `DATABASE_URL` de producción sin imprimir secretos. Se publica un artefacto precompilado y se verifican health, readiness, usuario/límites, rutas firmadas, pago y worker de alta.

La reversión conserva el deployment anterior y la URL administrativa anterior en memoria durante el corte. Si readiness o los canarios fallan, se restaura la variable y se promociona el deployment anterior. Las migraciones aditivas permanecen.

## Criterios de aceptación

- Una conexión que no responde se recicla y un cliente nuevo completa el query; el trabajo de negocio se ejecuta una sola vez.
- Dos clientes no disponibles fallan dentro del presupuesto acotado y no dejan promesas/querys ejecutándose después.
- Cien operaciones concurrentes comparten una verificación y no crean cien clientes.
- Readiness rechaza `postgres` y acepta `orchestrator_role` con los tres límites efectivos.
- La suite unitaria, integración, workflow, typecheck, lint y build pasan sobre el candidato exacto.
- Producción responde cinco veces seguidas en `/api/ready`, no genera timeouts de 300 s durante el canario y conserva los flujos de conversación, llamada, link, pago, alta y bienvenida.
- La medición de latencia distingue el round trip de liveness; el p95 sano no aumenta materialmente. Un aumento de hasta 100 ms en la primera petición tras inactividad es aceptable a cambio de eliminar esperas de 300 s.
