# Telegram Development Unlock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this plan task-by-task.

**Goal:** Autorizar Telegram únicamente en Botpress Development, levantar Agent A local y comprobar que un mensaje llega al backend local.

**Architecture:** Botpress Cloud recibe Telegram y entrega el evento al runtime ADK local. Agent A llama al backend Next.js en `http://localhost:3000`; PostgreSQL sigue en `127.0.0.1:55433`. Producción no se modifica.

**Tech Stack:** Botpress ADK 2.0.5, Telegram, Next.js, PostgreSQL.

**Spec:** Estado operativo confirmado el 2026-08-22 en esta tarea.

## Global Constraints

- No mostrar, imprimir, guardar ni commitear el token de Telegram.
- No tocar Production, Vercel, Supabase remoto ni `.env.local`.
- No usar `adk integrations add telegram` desde CLI: previamente instaló una versión inexistente para el workspace.
- No modificar código salvo que una prueba demuestre un defecto propio del repositorio.
- Conservar todos los archivos no rastreados del usuario.

---

### Task 1: Instalar y autorizar Telegram en Development

**Files:** Ninguno.

- [ ] Abrir `http://localhost:3011/integrations` en Brave y confirmar que `Dev` está seleccionado.
- [ ] En `Integration Hub`, buscar Telegram e instalarlo desde la interfaz, no desde CLI.
- [ ] Ingresar el token proporcionado por el usuario en el formulario de Botpress y completar `Connect/Authorize`.
- [ ] Ejecutar:

```bash
npx adk integrations status --target dev --format json
```

Resultado exigido: una entrada `alias: telegram`, `enabled: true`, `state: available`. Si aparece `integration version doesn't exist`, desinstalar desde la interfaz y reinstalar desde el Hub una sola vez. No continuar mientras el estado no sea `available`.

### Task 2: Levantar Agent A local

**Files:** Ninguno.

- [ ] Confirmar que Next.js responde:

```bash
curl -fsS http://localhost:3000/api/health/ready
```

- [ ] Inspeccionar procesos:

```bash
npx adk ps --format json
```

- [ ] Si no hay `devServer`, iniciarlo desde `botpress-agent`:

```bash
npx adk dev --non-interactive --port 3010 --port-console 3011
```

Mantener el proceso vivo. Si el puerto 3011 ya pertenece al DevConsole, reutilizarlo; detener únicamente ese proceso exacto si ADK informa colisión y reiniciar el mismo comando.

- [ ] Verificar:

```bash
npx adk status --format json
```

Resultado exigido: `devServer.running: true`, `botId` no nulo y Telegram configurado.

### Task 3: Smoke test real

**Files:** Ninguno.

- [ ] Pedir al usuario un único mensaje al bot: `Hola, quiero conocer los planes`.
- [ ] Observar logs ADK y backend sin imprimir secretos.
- [ ] Confirmar llamadas a `/api/agent/ingest`, `/api/agent/claim`, `/api/agent/decision` y `/api/agent/delivery`.
- [ ] Confirmar una sola respuesta de Telegram y ausencia de duplicados.
- [ ] Reportar por separado cualquier degradación de RAG por `GEMINI_API_KEY`; no confundirla con el canal Telegram.

## Criterio de finalización

Telegram está `available` en Development, Agent A permanece ejecutándose, un mensaje real atraviesa el backend local y recibe exactamente una respuesta. Producción permanece sin cambios.
