# Botpress StudyX Admissions Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover el ingreso y egreso de WhatsApp de StudyX desde `StudyX Pruebas` a `Asesor de admisiones Studyx` en el workspace compartido de StudyX, conservando brain v210, prompt v121, backend, memoria, pagos, llamadas, materiales y altas.

**Architecture:** El backend y la base siguen siendo la fuente de verdad; Botpress sólo cambia de bot/workspace. El destino se prepara con WhatsApp deshabilitado, se publica el mismo artefacto, se corta un único consumidor y recién entonces se habilita el bot compartido de StudyX. El bot anterior queda apagado como rollback, nunca se elimina.

**Tech Stack:** Botpress ADK 2.0.5/2.0.8, Botpress Client, TypeScript, Vitest, Vercel, WhatsApp Cloud API.

**Spec:** `AGENTS.md`, `docs/runbooks/release-agent-a.md`, `docs/authority/prompt-agente-a-studyx-v2.md`.

## Global Constraints

- Fuente aprobada: commit `d5549583eb4140b66e56484efbc1aa0e209ac72a`, brain `studyx-agent-a-brain-v210`, prompt `studyx-agent-a-canonical-v121`.
- Origen actual: perfil `default`, workspace `wkspace_01M0X4K3H2EE7RGM39Q29GF6VS`, bot `15050253-3088-47a4-940d-dc849c03860c` (`StudyX Pruebas`).
- Destino: cuenta autenticada `ipsj.thiagomaneyro@gmail.com`, workspace `wkspace_01M75G5S9RYXD656HZ6J4SAHYQ` (`studyx's workspace`), bot `e0f6be70-db0e-48e0-a9b7-f7864b6699d1` (`Asesor de admisiones Studyx`). La cuenta IPSJ tiene rol `administrator`; el owner es `studyxacademiallc@gmail.com`.
- Backend durante el corte: `https://studyx-agente-ventas.vercel.app`, con el mismo `orchestratorKeyId=botpress-dev`.
- Un solo bot puede tener el WhatsApp público habilitado. Nunca dejar origen y destino enviando simultáneamente.
- No imprimir, copiar a Git ni registrar valores de tokens, secretos o credenciales Meta.
- No publicar el cambio local ajeno de `botpress-agent/agent.config.ts` que renombra el agente a `calm-ostrich`.
- No borrar conversaciones, contactos, pagos, promociones, auditoría ni el bot anterior.
- El número terminado en 72 no entra en el corte. La identidad permitida sigue siendo `whatsappAllowedBotPhoneNumberId=1300545066485709`.

## Review Focus

- El bot destino está recién creado: no tiene integración WhatsApp, secretos ni configuración operativa de StudyX. Debe quedar completo antes del corte.
- Un inbound en el nuevo bot crea otro `botpress_conversation_id`; la conversación canónica debe seguir vinculándose por contacto/workspace sin duplicar efectos.
- Seguimientos, postventa y llamadas no deben seguir enviándose por el bot anterior después del corte.
- Una entrega ambigua o una llamada en curso se drena antes del cambio; nunca se reintenta a ciegas.
- Rollback restaura encaminamiento, no una copia vieja de la base de datos.

---

### Task 1: Capturar inventario y barrera de corte

**Files:**
- Create: `docs/reports/evidence/2026-11-11-botpress-vertice-cutover/inventory.sanitized.json`
- Modify: ninguno
- Test: lectura remota de ambos bots y `GET /api/health`, `GET /api/ready`

**Interfaces:**
- Consumes: perfiles ADK existentes y commit aprobado.
- Produces: inventario sin secretos y decisión GO/NO-GO.

- [x] **Step 1: Guardar sólo presencia y metadatos seguros**

  Registrar bot/workspace, `deployedAt`, integración WhatsApp, flags, nombres de secretos, URL backend, SHA y estado de Vercel. No registrar valores.

- [x] **Step 2: Verificar el estado actual**

  Esperado: origen WhatsApp `enabled=true`; destino `enabled=false`; ambos apuntan al mismo backend; planner comercial apagado.

- [x] **Step 3: Confirmar ausencia de trabajo incierto**

  Verificar que no haya entregas ambiguas, pagos en conciliación, llamadas abiertas ni jobs con lease para el contacto de prueba y la ventana de corte.

- [x] **Step 4: Emitir GO/NO-GO**

  NO-GO si el destino no tiene crédito, si `/api/ready` falla o si no se puede completar la credencial manual de WhatsApp sin exponerla.

### Task 2: Reorientar el publisher hacia el workspace compartido de StudyX

**Files:**
- Modify: `scripts/lib/botpress-release-destination.mjs`
- Modify: `tests/unit/scripts/botpress-release-destination.test.ts`
- Modify: `botpress-agent/agent.json`
- Modify: `docs/runbooks/release-agent-a.md`
- Test: `tests/unit/scripts/botpress-release-destination.test.ts`

**Interfaces:**
- Consumes: IDs confirmados en Task 1.
- Produces: un publisher que falla cerrado salvo que el destino sea exactamente el workspace compartido y `Asesor de admisiones Studyx`.

- [x] **Step 1: Escribir primero el test del destino**

  Debe exigir un perfil ADK explícito ligado al workspace compartido, el bot `Asesor de admisiones Studyx`, WhatsApp registrado/habilitado y Phone Number ID permitido.

- [x] **Step 2: Ejecutar el test y confirmar que falla con el destino anterior**

  Run: `npx vitest run tests/unit/scripts/botpress-release-destination.test.ts`

- [x] **Step 3: Actualizar el destino y el vínculo ADK**

  Cambiar únicamente los IDs y nombres de destino. No incluir el cambio local `calm-ostrich`.

- [x] **Step 4: Actualizar el runbook**

  Dejar el workspace compartido de StudyX como destino único de próximos releases y conservar StudyX Pruebas sólo como rollback apagado.

- [x] **Step 5: Ejecutar tests focalizados y commit**

  Run: `npx vitest run tests/unit/scripts/botpress-release-destination.test.ts tests/unit/scripts/botpress-release-provenance.test.ts`

  Commit: `chore(release): target Agent A releases to StudyX admissions`

### Task 3: Preparar el bot compartido sin tráfico

**Files:**
- Modify: configuración y secretos remotos de Botpress, no Git.
- Test: preflight remoto sanitizado.

**Interfaces:**
- Consumes: nombres de variables y credenciales administradas por Botpress/Meta.
- Produces: bot destino completo pero todavía incapaz de enviar tráfico público.

- [x] **Step 1: Poner el destino en modo seguro**

  `automationEnabled=false`, `whatsappPublicEnabled=false`, `whatsappCanaryEnabled=false`, integración WhatsApp deshabilitada.

- [x] **Step 2: Verificar secretos por presencia**

  Requeridos: `STUDYX_ORCHESTRATOR_KEY`, `STUDYX_SIGNING_SECRET`, `CRON_SECRET`, `DEEPSEEK_API_KEY`; opcionales sólo si el proveedor está activo.

- [x] **Step 3: Completar la integración manual de WhatsApp**

  El destino hoy carece de `accessToken`, `appId`, `clientSecret`, `defaultBotPhoneNumberId`, `verifyToken` y `whatsappBusinessAccountId`. Ingresarlos sin imprimirlos y mantener la integración deshabilitada.

- [x] **Step 4: Verificar configuración no secreta**

  `apiBaseUrl`, `orchestratorKeyId`, timeouts, Emma, planner apagado y Phone Number ID deben coincidir con el release aprobado.

### Task 4: Publicar v210/v121 en el bot compartido

**Files:**
- Modify: ninguno fuera de los artefactos generados del release.
- Test: TypeScript, unitarias, ADK check/build y preflight remoto.

**Interfaces:**
- Consumes: commit de Task 2 y configuración segura de Task 3.
- Produces: código v210/v121 en `Asesor de admisiones Studyx`, todavía sin WhatsApp público.

- [x] **Step 1: Crear un worktree limpio del SHA aprobado**

  Vincular dependencias y verificar `git status --porcelain` vacío.

- [x] **Step 2: Ejecutar verificación**

  Run: `npx tsc --noEmit -p .`, `npx tsc --noEmit -p botpress-agent`, `npx vitest run tests/unit`, `adk check`, `adk build`.

- [x] **Step 3: Ejecutar preflight read-only contra el bot compartido**

  Debe confirmar bot/workspace, contratos, plugins, integraciones, flags y publicación code-only. No publicar si el destino no coincide.

- [x] **Step 4: Publicar código preservando conexiones**

  Guardar `publication.json` sanitizado y verificar un `deployedAt` nuevo. La falta de hash remoto se documenta, no se disfraza.

### Task 5: Ejecutar el corte único de WhatsApp

**Files:**
- Modify: configuración remota de ambos bots.
- Test: lectura remota inmediata y un inbound canario.

**Interfaces:**
- Consumes: destino publicado y credenciales WhatsApp completas.
- Produces: un único consumidor activo: `Asesor de admisiones Studyx`.

- [x] **Step 1: Apagar el origen**

  En StudyX Pruebas: `automationEnabled=false`, `whatsappPublicEnabled=false` y deshabilitar WhatsApp. Confirmar lectura remota.

- [x] **Step 2: Habilitar la conexión del destino**

  En `Asesor de admisiones Studyx`: habilitar WhatsApp y comprobar `registered`; después `whatsappPublicEnabled=true` y `automationEnabled=true`. Mantener canary apagado salvo prueba acotada explícita.

- [x] **Step 3: Probar un único inbound del dueño**

  Confirmar que el mensaje aparece sólo en el bot compartido, genera una única entrega y conserva el contexto canónico del backend.

- [x] **Step 4: Verificar que el origen quedó mudo**

  No deben aparecer nuevos mensajes, workflows, seguimientos ni postventa en StudyX Pruebas.

### Task 6: Verificación punta a punta y cierre

**Files:**
- Create: `docs/reports/evidence/2026-11-11-botpress-vertice-cutover/verification.sanitized.json`
- Modify: ninguno
- Test: canario WhatsApp del dueño.

**Interfaces:**
- Consumes: bot compartido activo.
- Produces: aceptación o rollback.

- [ ] **Step 1: Conversación comercial corta**

  Saludo, exploración, recomendación, respuesta natural y ausencia de preguntas repetidas.

- [ ] **Step 2: Material**

  Ante pedido explícito: PDF, imagen y texto, una sola vez.

- [ ] **Step 3: Efectos**

  Pedido de llamada con consentimiento y datos; promoción válida; checkout sandbox; webhook, alta y acceso sin duplicados.

- [ ] **Step 4: Operación**

  Verificar typing, latencia, audit log, opt-out, seguimiento y ausencia de silencios/duplicados.

- [ ] **Step 5: Cierre o rollback**

  Si falla un efecto real: apagar el bot compartido, reactivar StudyX Pruebas con su configuración preservada y reconciliar entregas antes de reintentar. Nunca restaurar una DB vieja.

