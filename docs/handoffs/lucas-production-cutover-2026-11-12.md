# Entrega a producción de Lucas — 2026-11-12

Esta rama deja el backend listo para que Lucas integre y despliegue sin tomar
código de ramas viejas ni volver a construir la configuración de StudyX.

## Fuente única de la entrega

- Repositorio: `lbozzolo/studyx-agente-ventas`
- Rama a integrar: `codex/lucas-main-fixes`
- Base: `origin/main` en `9b245aa`
- Backend de Lucas: `https://studyx-agente-ventas-sigma.vercel.app`
- Botpress destino: `Asesor de admisiones Studyx`
- Bot ID: `e0f6be70-db0e-48e0-a9b7-f7864b6699d1`
- Workspace ID: `wkspace_01M75G5S9RYXD656HZ6J4SAHYQ`
- Perfil ADK: `studyx-admissions`
- Brain: `studyx-agent-a-brain-v212`
- Prompt: `studyx-agent-a-canonical-v123`

No integrar la rama antigua que agregaba reglas comerciales al prompt. `main`
ya contiene el corte aprobado de v212/v123; esta rama agrega únicamente los dos
arreglos pedidos por Lucas y el presente handoff.

## Qué corrige esta rama

1. `assets/course-material/` queda admitido por la verificación de procedencia,
   por lo que Vercel puede compilar las fichas, imágenes y programas versionados.
2. La recuperación de conversaciones anteriores queda limitada por
   `workspace_id`.
3. Incluye el aumento ya integrado del catálogo de 40 a 60 cursos (`d52c049`).
   El backend viejo de Lucas está en `102bf708`, todavía usa el límite 40 y por
   eso hoy `/api/ready` falla con `commercial_snapshot: catalog_truncated`.

No hay que borrar ni resembrar el catálogo para corregir ese estado. Primero se
despliega esta rama. Si el nuevo despliegue siguiera informando truncamiento, se
detiene el corte y se revisa el total real; no se oculta el error aumentando el
límite a ciegas.

## Únicos pasos de Lucas

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git merge --no-ff origin/codex/lucas-main-fixes
git push origin main
```

Después debe desplegar ese `main` en el proyecto Vercel que sirve
`studyx-agente-ventas-sigma.vercel.app`. Las variables del proyecto se conservan;
no debe reemplazarlas por los defaults de `.env.example`.

El build ejecuta `scripts/stage-course-programs.mjs --build` automáticamente y
toma las fuentes versionadas en `assets/course-material/`. Ya no depende de
carpetas locales de Thiago.

## Contrato de variables

El inventario completo, sin valores secretos, está en
`docs/handoffs/lucas-production.env.example`. Lucas sólo verifica presencia y
mantiene los valores que ya tiene. Las dos coincidencias obligatorias con
Botpress son:

- Vercel `ORCHESTRATOR_API_KEY` = Botpress `STUDYX_ORCHESTRATOR_KEY`.
- Vercel `STUDYX_SIGNING_SECRET` = Botpress `STUDYX_SIGNING_SECRET`.
- Vercel `DEEPSEEK_API_KEY` = Botpress `DEEPSEEK_API_KEY`.

La conversación principal invoca DeepSeek desde el runtime de Botpress; la
clave de Vercel no se comparte automáticamente con ese runtime. El backend usa
la misma credencial para la narrativa post-llamada. Por eso el mismo valor debe
estar cargado como secreto en los dos entornos antes del corte.

`ORCHESTRATOR_KEY_ID` debe conservar `botpress-dev` en ambos lados. Nunca se
copian valores sensibles al repositorio, al PR o a capturas.

## Verificación posterior al despliegue

```bash
curl --fail --silent --show-error \
  https://studyx-agente-ventas-sigma.vercel.app/api/health

curl --fail --silent --show-error \
  https://studyx-agente-ventas-sigma.vercel.app/api/ready
```

Condiciones obligatorias antes de mover Botpress:

- `/api/health` devuelve HTTP 200 y el commit nuevo, no `102bf708`.
- `/api/ready` devuelve HTTP 200, `ready:true` y `failed_required:[]`.
- `commercial_snapshot` queda `ok`, no `catalog_truncated`.
- El build publica los programas y materiales sin `STAGING_FAILED`.

## Corte de Botpress

Botpress continúa deliberadamente contra
`https://studyx-agente-ventas.vercel.app` hasta que las cuatro condiciones
anteriores pasen. Cambiarlo antes dejaría WhatsApp conectado a un backend que
hoy devuelve 503.

Después de la confirmación de Lucas, Thiago/Codex hace el único cambio remoto
pendiente:

```text
perfil: studyx-admissions
configuración: apiBaseUrl=https://studyx-agente-ventas-sigma.vercel.app
```

En el mismo corte se carga `DEEPSEEK_API_KEY` en Botpress con el mismo valor
privado que Lucas conserva en Vercel, se verifica por presencia el resto de las
claves, se publica sin tocar WhatsApp ni las integraciones, y se realiza un
smoke real. Si falla, el rollback es restaurar únicamente `apiBaseUrl` a
`https://studyx-agente-ventas.vercel.app`; no se cambia el prompt, el brain ni
la base.

