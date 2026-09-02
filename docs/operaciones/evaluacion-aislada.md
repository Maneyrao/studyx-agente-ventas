# Evaluación local aislada del Agente A

Este documento describe cómo correr los casos visibles y el held-out sin tocar
producción, y qué queda pendiente para poder correrlos.

## Por qué existe

`.env.local` de este repositorio apunta a la Supabase **de producción**. El
evaluador ingresa mensajes, reclama turnos, escribe decisiones y entrega
outbound: correrlo con ese archivo cargado escribiría veinte conversaciones
inventadas sobre datos reales, indistinguibles después de las de clientes.

La defensa no es acordarse. Es `scripts/lib/eval-isolation.ts`, que corre
**antes** de crear el cluster y antes de arrancar la API, y aborta si:

- `DATABASE_URL` no es loopback (`127.0.0.1`, `localhost`, `::1`);
- el puerto no es uno de los desechables (55432–55435);
- hay cargada cualquier credencial de efecto externo — Telegram, Stripe,
  Retell, Google Sheets;
- la API no usa un puerto dedicado 3200–3299 en loopback;
- alguno de los tres links de pago no apunta a `example.invalid` o
  `example.test` por HTTPS;
- falta `DEEPSEEK_API_KEY`.

Ese último punto no es burocracia. El runner trata DeepSeek como opcional y
cae a otro proveedor si no está: la corrida terminaría bien y los números
describirían un modelo que no es el que se está evaluando. Un número que no
mide lo que dice medir es peor que ningún número.

## Identidades y efectos

Todo lo del entorno de evaluación es sintético: el workspace y el catálogo
salen de `supabase/seed.sql`, los contactos son teléfonos `+54911…` generados
por caso, y los links de pago apuntan a `example.invalid`.

Telegram, Stripe, Sheets y Retell se apagan por **ausencia**: sus credenciales
no están en `.eval/.env.local` y el guard aborta si alguien las agrega. No hay
un flag que las desactive — no hay con qué llamarlas.

La API usa por defecto `127.0.0.1:3217` y se niega a arrancar si el puerto ya
está ocupado. Después del arranque, el ejecutor contrasta `/api/health` con el
SHA exacto del worktree y exige `/api/ready` positivo. Así, un proceso viejo en
otro checkout no puede producir un falso verde.

El harness fuerza `AGENT_A_BRAIN_V1_ENABLED=true` y shadow apagado en todas
las matrices. El grupo base conserva apagadas sólo las capacidades nuevas; no
cae a la ruta legacy ni cambia DeepSeek por otro proveedor silenciosamente.

## Preparación

1. Crear `.eval/.env.local` (está en `.gitignore`; usar el que ya existe como
   plantilla o copiarlo de otra máquina).
2. Poner la clave real de DeepSeek en `DEEPSEEK_API_KEY`, o exportarla en la
   sesión. **No** va en `.env.local` del repositorio ni en ningún archivo
   versionado, y su valor no se imprime en ningún log ni mensaje de error.

Una key de la sesión tiene precedencia sobre una declaración vacía en
`.eval/.env.local`; esto permite inyectarla desde un gestor de secretos sin
persistirla en disco.

## Correr

```bash
# Casos visibles, tres veces, con las capacidades nuevas apagadas
scripts/eval-agent-a.sh studyx-agent-a-conversational-baseline 3 base

# Los mismos, tres veces, con recorte + reparación + V5 por estado
scripts/eval-agent-a.sh studyx-agent-a-conversational-baseline 3 rep --repair

# Held-out
scripts/eval-agent-a.sh studyx-agent-a-brain-v1-heldout 3 heldout --repair
```

Los reportes quedan en `botpress-agent/evals/results/happy-path-<etiqueta>-<n>.json`,
que está en `.gitignore`.

## Qué prueba el reporte

El resultado final incluye `turn_metrics` por cada mensaje y un agregado
`metrics`. No se deducen estado, acciones ni reparaciones de la prosa: salen
del claim, del ciclo de propuesta validada y del commit. El texto entregado se
usa únicamente para medir superficie conversacional y para comprobar que no
llegó una promesa operativa sin el `fact_id` que la autoriza.

`acceptance_gates.ready` sólo puede ser `true` si simultáneamente hay cero
silencios accidentales, p95 menor a 6 segundos, tasa de reparación no mayor al
5 %, éxito de reparación de al menos 80 % cuando hubo muestras, fallbacks
técnicos no mayores al 2 %, cero promesas falsas y paridad exacta entre ofertas
visibles de llamada y entradas del ledger. Un checkpoint interrumpido publica
`partial_metrics`, pero deja `acceptance_gates: null`: no puede presentarse
como aceptación completa.

La calidad superficial se informa por separado: detecta respuestas vacías o
mayores a 600 caracteres, interrogatorios de más de dos preguntas, copy de
fallback genérico y respuestas duplicadas o casi duplicadas. No certifica
naturalidad. La calidad conversacional requiere un dictamen independiente en
cinco dimensiones ligado al hash del transcript redactado; sin los 20
dictámenes, `rubric.ready` permanece falso. La definición completa está en
`docs/operaciones/rubrica-conversacional-agente-a.md`.

## Held-out: qué significa "independiente"

`studyx-agent-a-brain-v1-heldout` es el conjunto de validación. Quien
implementa **no lee sus textos**: leerlos convierte el held-out en otro
conjunto de entrenamiento y su número deja de significar nada.

En la práctica esto quiere decir consumir sólo los agregados del reporte
—`summary`, veredictos, métricas— y no el contenido de los casos. La
verificación de que las suites no dependen de capacidades removidas por P1–P11
se hizo por conteo de patrones, sin abrir los textos.

## Versión del prompt

Cada suite declara `prompt_version` y el runner aborta con
`PROMPT_VERSION_MISMATCH` si no coincide con el prompt activo. Es
intencional: evita comparar contra oráculos escritos para otro prompt.

Al pasar a `studyx-agent-a-brain-v4` se verificó, por conteo de patrones sobre
las dos suites, que ningún caso ni oráculo menciona nada que P1–P11 hayan
removido (PDF, programa adjunto, plazos, seguimiento, ciudad, estado, ZIP).
Cero coincidencias en las dos. Por eso subir la versión declarada no es
acomodar un oráculo para que pase.
