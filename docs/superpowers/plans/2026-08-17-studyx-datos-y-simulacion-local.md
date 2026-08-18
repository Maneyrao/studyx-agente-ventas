# StudyX — Datos reales + Simulación local A→B→A — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar el agente corriendo en sandbox local con (1) el catálogo real de StudyX cargado en `offerings`/`knowledge_sources` sin ningún precio inventable, y (2) el ciclo completo A→B→A (pedido de llamada → dispatch a Bot B por Telegram → veredicto → cron de cierre post-llamada) verificable desde la cuenta de Telegram del dueño.

**Architecture:** Se reutiliza el esquema universal de negocio ya mergeado (workspaces/offerings/knowledge_sources) agregando un workspace `studyx-sandbox` sembrado desde el análisis del sitio (14 cursos verificados, precios como `quote` porque el sitio publica $699 y cobra $1.200). La simulación local usa los dos bots de Telegram ya implementados (Bot A en Botpress, Bot B en el backend vía `/api/webhooks/voice/telegram`) con un túnel a `localhost`.

**Tech Stack:** Next.js + Supabase/PostgreSQL (postgres.js) + pgvector + Botpress ADK + Telegram Bot API + vitest.

**Spec:** `~/Downloads/ANALISIS-STUDYX-CONTEXTO-VS-SITIO.md` (análisis contexto vs sitio, 14-ago-2026) — copiarlo a `docs/analysis/ANALISIS-STUDYX-CONTEXTO-VS-SITIO.md` en la Task 1 para que viaje con el repo. También: `specs/007-post-call-followup/spec.md` y `docs/runbooks/telegram-agent-b-smoke.md`.

## Lo que este plan dice vs. lo que quedó implementado

El cuerpo del plan quedó como se escribió antes de ejecutarlo. Tres decisiones
tomadas durante la ejecución lo contradicen, y manda lo implementado:

| El plan dice | Quedó |
|---|---|
| workspace `studyx-sandbox` | **`studyx`** |
| `environment = 'sandbox'` | **`production`** (decisión del usuario) |
| bloque StudyX dentro de `supabase/seed/dev.sql` | archivo propio **`supabase/seed/studyx.sql`**; `dev.sql` quedó sólo con fixtures sintéticas y sin ninguna referencia a StudyX |

Donde el plan diga `studyx-sandbox`, `sandbox` o `dev.sql` a propósito de
StudyX, leer la columna derecha. El detalle está en la Ruling 11 del ledger
(`.superpowers/sdd/2026-08-17-studyx-datos-y-simulacion-local/progress.md`).

## ⛔ Antes de copiar cualquier comando de este plan

**`$DATABASE_URL` en `.env.local` apunta a la Supabase de PRODUCCIÓN**
(`aws-1-us-east-2.pooler.supabase.com:6543`). Este plan quedó escrito con
`psql "$DATABASE_URL" …` en más de diez pasos. Ejecutados tal cual, esos
comandos escriben en la base real de clientes: ya pasó una vez durante la
ejecución de este plan (se sembraron fixtures sintéticas en producción y hubo
que borrarlas en una transacción de limpieza).

Para cualquier trabajo local, sembrado o prueba, usar el cluster desechable:

```bash
LC_ALL=C bash scripts/pg-native-up.sh      # 127.0.0.1:55433, base studyx_test
export TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:55433/studyx_test"
```

y reemplazar `"$DATABASE_URL"` por `"$TEST_DATABASE_URL"` en todo comando de
este documento. `dev.sql` sólo carga fixtures sintéticas (Aburridont, "Alumno
Smoke") y no debe tocar producción nunca.

## Global Constraints

- Migraciones SOLO aditivas; nunca editar una migración aplicada (`.claude/rules/database.md`).
- Ningún comando de sembrado, prueba o limpieza corre contra `$DATABASE_URL`: es producción (ver el bloque de arriba).
- `contacts.phone` E.164 estricto `/^\+[1-9]\d{7,14}$/`; sandbox = `+999` + telegram user id con padding a 10 dígitos (13 dígitos totales).
- Sandbox: `provider = 'telegram_sandbox'` + fila en `sandbox_identities`. Ningún efecto real (Retell, cobro, WhatsApp, Sheets prod) sobre un contacto con fila en `sandbox_identities`.
- **Ningún precio de StudyX entra como `price_amount` numérico** hasta que StudyX responda $699 vs $1.200 (hallazgo #1 del análisis). Todo `price_type='quote'`, `never_invent_price: true`.
- El agente NO puede afirmar: "certificación verificada", título/homologación, cuotas, "más de 50 diplomados", horarios de clases en vivo, política de devoluciones (Parte D.2 del análisis).
- Verificación mínima por tarea: typecheck + tests de la tarea. Antes del commit final: `npm run typecheck && npm run lint` y suites tocadas.
- No registrar secretos ni imprimir valores de `.env`.
- Al cerrar el plan: invocar la skill `studyx-checkpoint`, commitear y pushear (workflow acordado).

## Estrategia de modelos (economía de tokens)

Regla del CLAUDE.md del proyecto, aplicada tarea por tarea:

| Tarea | Modelo | Por qué |
|---|---|---|
| 1. Topología de ramas + rama de trabajo | **Haiku** (scout) → **Sonnet** (ejecuta merge) | Lectura de git es barata; el merge solo si hace falta |
| 2. Seed workspace StudyX | **Sonnet** | Implementación con test |
| 3. Test de catálogo sin precios | **Sonnet** | TDD |
| 4. Script identidad sandbox | **Sonnet** (con scout **Haiku** para patrón de conexión) | Implementación corta |
| 5. Runbook túnel + setWebhook | **Haiku** | Es documentación + comandos |
| 6. Corrida E2E A→B→A | **Sonnet** (scout **Haiku** para el path de inyección) | Depuración probable |
| 7. Checkpoint + push | **Haiku** | Mecánico |
| Conflictos de merge en Task 1, o cambio de diseño del seed | **Opus** (solo si ocurre) | Única decisión de arquitectura posible |

Cómo alternar en la práctica: sesión principal en **Sonnet**; los pasos marcados "scout" se despachan como subagentes (`studyx-scout`, ya definido en el proyecto, corre en Haiku). Cambiar a Opus solo con `/model` si la Task 1 encuentra divergencia real con conflictos. No usar Opus para nada más.

---

### Task 1: Verificar topología de ramas y crear la rama de trabajo

La spec 007 afirma que `codex/agent-a-b-integration` se mergeó a `personal/main` el 17-ago, pero el HEAD de esa rama (`fc41051`, migración de Sheets + evidencia de evals) puede ser posterior al merge. Hay que trabajar sobre una base que contenga **ambas** cosas: la integración A-B completa y el cron post-llamada de spec 007.

**Files:**
- Create: `docs/analysis/ANALISIS-STUDYX-CONTEXTO-VS-SITIO.md` (copia del spec)
- Repo: `/Users/tmaneyro22/Documents/AGENTE IA/studyx-agente-ventas` (worktree principal)

**Interfaces:**
- Produces: rama `feat/studyx-datos-y-sim-local` que contiene `baefe9f` (spec 007) y `fc41051` (integración completa). Todas las tareas siguientes trabajan sobre esta rama.

- [ ] **Step 1: (Haiku scout) Verificar qué contiene cada punta**

```bash
cd "/Users/tmaneyro22/Documents/AGENTE IA/studyx-agente-ventas"
git merge-base --is-ancestor fc41051 baefe9f && echo "INTEGRACION_YA_INCLUIDA" || echo "FALTA_MERGEAR"
git log --oneline baefe9f..fc41051   # qué commits de la integración no están en 007
```

- [ ] **Step 2: Crear la rama de trabajo desde spec 007**

```bash
git checkout -b feat/studyx-datos-y-sim-local baefe9f
```

- [ ] **Step 3: Solo si el Step 1 dijo FALTA_MERGEAR — traer la integración**

```bash
git merge fc41051 -m "merge: integración A-B completa (sheets migration + evidencia evals)"
```

Si hay conflictos que no sean triviales (mismo archivo, lógica distinta): **parar y escalar a Opus** con el diff de conflicto. No resolver "a ojo" en Sonnet.

- [ ] **Step 4: Copiar el análisis al repo y commitear**

```bash
mkdir -p docs/analysis
cp ~/Downloads/ANALISIS-STUDYX-CONTEXTO-VS-SITIO.md docs/analysis/
git add docs/analysis/ANALISIS-STUDYX-CONTEXTO-VS-SITIO.md
git commit -m "docs: análisis StudyX contexto vs sitio (fuente del seed)"
```

- [ ] **Step 5: Verificar que la base compila y las suites corren**

```bash
npm run typecheck && npx vitest run --config vitest.config.mts
```

Expected: typecheck limpio; unitarias verdes (537+ según el último estado conocido). Si algo falla acá, es preexistente al plan: registrarlo y escalar antes de seguir.

---

### Task 2: Seed del workspace StudyX (datos reales, precios bloqueados)

**Files:**
- Modify: `supabase/seed/dev.sql` (agregar bloque StudyX al final, mismo patrón idempotente que el bloque Aburridont de las líneas 24–209)
- Test: `tests/integration/studyx-seed.test.ts`

**Interfaces:**
- Consumes: esquema universal (`workspaces`, `offerings`, `knowledge_sources`) de la migración `20260817010001_universal_business_schema`.
- Produces: workspace `slug='studyx-sandbox'` con id `'b0000000-0000-4000-8000-000000000001'`; 14 offerings con `price_type='quote'`; 3 knowledge_sources. La Task 3 y la Task 6 dependen del slug y de ese id.

- [ ] **Step 1: Escribir el test de integración que falla**

```typescript
// tests/integration/studyx-seed.test.ts
import { describe, it, expect } from 'vitest';
import { sql } from './helpers/db'; // usar el mismo helper que tests/integration/catalog-detail.test.ts

const WS = 'studyx-sandbox';

describe('seed studyx-sandbox', () => {
  it('crea el workspace en environment sandbox', async () => {
    const rows = await sql`SELECT environment, status FROM workspaces WHERE slug = ${WS}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ environment: 'sandbox', status: 'active' });
  });

  it('siembra 14 offerings, todas sin precio numérico', async () => {
    const rows = await sql`
      SELECT code, price_type, price_amount, currency, guardrails
      FROM offerings o JOIN workspaces w ON w.id = o.workspace_id
      WHERE w.slug = ${WS}`;
    expect(rows).toHaveLength(14);
    for (const r of rows) {
      expect(r.price_type).toBe('quote');
      expect(r.price_amount).toBeNull();
      expect(r.currency).toBe('USD');
      expect(r.guardrails.never_invent_price).toBe(true);
    }
  });

  it('la política comercial cita los límites de los T&C', async () => {
    const rows = await sql`
      SELECT content FROM knowledge_sources k JOIN workspaces w ON w.id = k.workspace_id
      WHERE w.slug = ${WS} AND k.source_type = 'policy'`;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].content).toContain('No somos una entidad educativa con licencia');
  });
});
```

Nota para el implementador: si `tests/integration/` no tiene un helper `db` compartido, copiar el patrón de conexión de `tests/integration/catalog-detail.test.ts` (mismo `DATABASE_URL` del cluster local de `scripts/pg-native-up.sh`).

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
npm run test:integration -- tests/integration/studyx-seed.test.ts
```

Expected: FAIL — el workspace `studyx-sandbox` no existe.

- [ ] **Step 3: Agregar el bloque StudyX a `supabase/seed/dev.sql`**

Reglas de contenido — todo sale de `docs/analysis/ANALISIS-STUDYX-CONTEXTO-VS-SITIO.md`, Parte B:

```sql
-- ---------------------------------------------------------------------------
-- StudyX (sandbox). Datos VERIFICADOS del sitio mystudyx.com al 14-ago-2026
-- (docs/analysis/ANALISIS-STUDYX-CONTEXTO-VS-SITIO.md). Los precios NO se
-- cargan: el sitio publica $699 y cobra $1,200 (hallazgo #1). price_type=quote
-- hasta que StudyX confirme. Idempotente via ON CONFLICT.
-- ---------------------------------------------------------------------------

INSERT INTO workspaces (id, slug, display_name, environment, status, default_locale, timezone, metadata)
VALUES (
  'b0000000-0000-4000-8000-000000000001', 'studyx-sandbox',
  'StudyX — Academia Internacional (Sandbox)', 'sandbox', 'active',
  'es-419', 'America/New_York',
  '{"legal_entity":"My Study X, LLC / World Digital Group Corp (FL)","psp":"authorize_net_cim_credit_card","source":"mystudyx.com 2026-08-14","price_conflict_open":true}'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name, environment = EXCLUDED.environment,
  status = EXCLUDED.status, default_locale = EXCLUDED.default_locale,
  timezone = EXCLUDED.timezone, metadata = EXCLUDED.metadata, updated_at = now();
```

Offerings — las 14 fichas con temario publicado y precio verificado en `/diplomado/` (tabla B.2 del análisis). Una fila por curso, todas con esta forma (ejemplo completo del primero; repetir con los datos de la tabla de abajo):

```sql
INSERT INTO offerings (
  id, workspace_id, code, display_name, offering_type, status, description,
  value_proposition, price_type, price_amount, currency, billing_interval,
  audience, delivery, guardrails, metadata
) VALUES
(
  'b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
  'maquillaje_profesional', 'Diplomado en Maquillaje Profesional', 'course', 'active',
  'Diplomado online de 38 clases en 5 módulos, con temario completo publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'quote', NULL, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":38,"modules":5,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El precio te lo confirma el equipo de inscripciones.","forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"source_url":"/diplomado/maquillaje-profesional/","published_price_conflict":"699_vs_1200"}'::jsonb
),
-- …repetir el mismo shape para las otras 13 filas…
ON CONFLICT (workspace_id, code) DO UPDATE SET
  display_name = EXCLUDED.display_name, offering_type = EXCLUDED.offering_type,
  status = EXCLUDED.status, description = EXCLUDED.description,
  value_proposition = EXCLUDED.value_proposition, price_type = EXCLUDED.price_type,
  price_amount = EXCLUDED.price_amount, currency = EXCLUDED.currency,
  billing_interval = EXCLUDED.billing_interval, audience = EXCLUDED.audience,
  delivery = EXCLUDED.delivery, guardrails = EXCLUDED.guardrails,
  metadata = EXCLUDED.metadata, updated_at = now();
```

Datos de las 14 filas (ids `b1000000-…-0001` a `-0014`, en este orden; `classes`/`modules` de la tabla B.2; guardrails idénticos en todas):

| # | code | display_name | classes | detalle delivery |
|---|---|---|---|---|
| 1 | `maquillaje_profesional` | Diplomado en Maquillaje Profesional | 38 | 5 módulos |
| 2 | `entrenamiento_funcional` | Diplomado en Entrenamiento Funcional | 36 | 3 módulos |
| 3 | `decoracion_de_interiores` | Diplomado en Decoración de Interiores | 34 | temario 20 ítems (discrepancia declarada en metadata) |
| 4 | `unas_gelificadas` | Diplomado en Uñas Gelificadas | 25 | — |
| 5 | `masoterapia` | Diplomado en Masoterapia | 24 | — |
| 6 | `paisajismo_jardineria` | Diplomado en Paisajismo y Jardinería | 24 | — |
| 7 | `fotografia_profesional` | Diplomado en Fotografía Profesional | 41 | 26 módulos (discrepancia) |
| 8 | `estetica_integral` | Técnica/o en Estética Integral | 20 | — |
| 9 | `vino_cata_maridaje` | Introducción al Vino, la Cata y el Maridaje | 19 | — |
| 10 | `nutricion_alimentacion` | Nutrición y Alimentación Saludable | 16 | — |
| 11 | `cuidador_adultos_mayores` | Asistente y Cuidador de Adultos Mayores | 14 | +7 TI + TP final |
| 12 | `barista` | Diplomado en Barista | 12 | — |
| 13 | `sushi_principiantes` | Sushi para Principiantes | 10 | — |
| 14 | `depilacion_definitiva` | Técnica/o en Depilación Definitiva | 7 | — |

(Se excluyen: Auxiliar de Farmacia y Home Maintenance por contaminación de contenido, Community Manager por slug reciclado, y los 13 sin temario publicado — C.4 del análisis prohíbe scrapearlos.)

Knowledge sources (3 filas, ids `b4000000-…-0001/2/3`, mismo `ON CONFLICT (workspace_id, title, version)` que el bloque Aburridont):

```sql
INSERT INTO knowledge_sources (id, workspace_id, source_type, title, content, status, version, metadata) VALUES
('b4000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','business_profile',
 'Qué vende StudyX',
 'StudyX (Studyx Academia Internacional, operada por World Digital Group Corp / My Study X LLC, Florida, EE.UU.) vende diplomados online en español, a ritmo propio, con actividades prácticas, exámenes y un certificado emitido por la academia. El catálogo verificado tiene 14 diplomados con temario publicado, en oficios, gastronomía, marketing, belleza y salud/bienestar. La moneda es USD y el pago es con tarjeta. La edad mínima es 18 años.',
 'active',1,'{"source":"mystudyx.com 2026-08-14"}'::jsonb),
('b4000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001','policy',
 'Límites comerciales (T&C literales)',
 'Los T&C del sitio dicen: "No somos una entidad educativa con licencia para brindar títulos, certificados con aval nacional" y "nuestros cursos/capacitaciones, no obtienen un certificado o licencia para poder ejercer dichos aprendizajes". Por eso el agente puede decir que se emite un certificado de la academia, y NUNCA puede prometer certificación verificada, título oficial, homologación, matrícula ni salida laboral. Tampoco puede citar precios (existe una contradicción $699/$1.200 sin resolver), ni ofrecer cuotas (no existen), ni afirmar horarios de clases en vivo (no hay publicados), ni responder sobre devoluciones (los documentos legales se contradicen). Ante cualquiera de esos temas: derivar al equipo de inscripciones.',
 'active',1,'{"source":"mystudyx.com 2026-08-14"}'::jsonb),
('b4000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000001','process',
 'Beca StudyX y cierre',
 'La Beca Studyx es el mecanismo de descuento del negocio y se aplica "únicamente con asistencia del departamento de inscripciones". Requisitos publicados: entregar los proyectos prácticos, 75% de asistencia y aprobar los exámenes con mínimo 6/10. El monto no está publicado: el agente nunca lo estima. El cierre natural del agente es agendar la conversación con inscripciones, donde se resuelven precio y beca.',
 'active',1,'{"source":"mystudyx.com 2026-08-14"}'::jsonb)
ON CONFLICT (workspace_id, title, version) DO UPDATE SET
  source_type = EXCLUDED.source_type, content = EXCLUDED.content,
  status = EXCLUDED.status, metadata = EXCLUDED.metadata, updated_at = now();
```

- [ ] **Step 4: Aplicar el seed al cluster local y correr el test**

```bash
bash scripts/pg-native-up.sh   # si no está levantado
psql "$DATABASE_URL" -f supabase/seed/dev.sql
npm run test:integration -- tests/integration/studyx-seed.test.ts
```

Expected: PASS (3/3). El trigger de `knowledge_sources` encola solo los jobs de proyección — no hace falta correr el worker para este test.

- [ ] **Step 5: Verificar que el seed es re-ejecutable (así se actualizan los datos a futuro)**

```bash
psql "$DATABASE_URL" -f supabase/seed/dev.sql   # segunda vez, debe ser no-op limpio
npm run test:integration -- tests/integration/studyx-seed.test.ts
```

Expected: sin errores de constraint; tests siguen PASS. **Este es el mecanismo de actualización:** cuando StudyX responda las preguntas de la Parte E, se edita este bloque (p.ej. `price_type='fixed', price_amount=…`), se re-corre el seed, y el trigger de `knowledge_projection_jobs` re-proyecta las fuentes editadas solo con subir `version`.

- [ ] **Step 6: Commit**

```bash
git add supabase/seed/dev.sql tests/integration/studyx-seed.test.ts
git commit -m "feat: seed del workspace studyx-sandbox con catálogo verificado y precios bloqueados"
```

---

### Task 3: El catálogo del agente sirve StudyX sin filtrar precios

**Files:**
- Test: `tests/integration/studyx-catalog.test.ts`
- (No debería requerir cambios de src: `/api/agent/tools/catalog` ya lee de `offerings` vía `BusinessContextStore`; esta tarea lo prueba con el workspace nuevo.)

**Interfaces:**
- Consumes: workspace `studyx-sandbox` de la Task 2; rutas `GET /api/agent/tools/catalog` y `GET /api/agent/tools/catalog/[sku]`.
- Produces: garantía de que con `BUSINESS_WORKSPACE_SLUG=studyx-sandbox` el agente ve 14 cursos y ningún número de precio.

- [ ] **Step 1: Escribir el test que falla (o pasa — ver Step 2)**

```typescript
// tests/integration/studyx-catalog.test.ts
// Copiar el arnés de tests/integration/catalog-detail.test.ts (misma forma de
// invocar la route con un env override) cambiando el workspace:
import { describe, it, expect } from 'vitest';

// BUSINESS_WORKSPACE_SLUG=studyx-sandbox para este suite (usar el mismo
// mecanismo de override de env que usa catalog-detail.test.ts).

describe('catálogo del agente con workspace studyx-sandbox', () => {
  it('lista los 14 diplomados', async () => {
    const res = await catalogList(); // helper del arnés copiado
    expect(res.items).toHaveLength(14);
  });

  it('ningún item expone un precio numérico ni los montos del conflicto', async () => {
    const res = await catalogList();
    const flat = JSON.stringify(res);
    expect(flat).not.toMatch(/699|1[.,]?200/);
    for (const item of res.items) expect(item.price_amount ?? null).toBeNull();
  });

  it('el detalle de barista mantiene paridad con la lista y sin precio', async () => {
    const detail = await catalogDetail('barista');
    expect(detail.price_amount ?? null).toBeNull();
    expect(JSON.stringify(detail)).not.toMatch(/699|1[.,]?200/);
  });
});
```

- [ ] **Step 2: Correr y leer el resultado con cuidado**

```bash
npm run test:integration -- tests/integration/studyx-catalog.test.ts
```

Si PASS de una: perfecto, la unificación de CP2 ya cubría esto; la tarea queda como test de regresión. Si FAIL: el fallo dice exactamente qué campo filtra precio o qué shape difiere — arreglar en la vista (`business-context.ts` / builder del catálogo), NUNCA relajando el test.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/studyx-catalog.test.ts
git commit -m "test: catálogo studyx-sandbox sin precios inventables"
```

---

### Task 4: Script de identidad sandbox para el dueño

Automatiza lo que hoy es manual: crear tu contacto sandbox + la conversación, para que Bot A/Bot B te reconozcan.

**Files:**
- Create: `scripts/seed-sandbox-tester.mjs`

**Interfaces:**
- Consumes: tablas `contacts`, `conversations`, `sandbox_identities` (regla: teléfono `+999` + user id a 10 dígitos).
- Produces: comando `node scripts/seed-sandbox-tester.mjs --telegram-user-id <id> --name "<nombre>"` que imprime el `contact_id` creado. La Task 6 lo usa.

- [ ] **Step 1: (Haiku scout) Confirmar el patrón de conexión de scripts existentes**

Leer cómo se conecta `scripts/ingest-kb.mjs` (¿`postgres` package con `DATABASE_URL`? ¿helper compartido?) y devolver solo el snippet de conexión. Usar ese mismo patrón en el Step 2.

- [ ] **Step 2: Escribir el script**

```javascript
// scripts/seed-sandbox-tester.mjs
// Crea (idempotente) el contacto sandbox del tester, su conversación abierta
// y la fila de sandbox_identities que exige el candado de sandbox.
import postgres from 'postgres'; // ajustar al patrón real detectado en Step 1

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : null)).filter(Boolean),
);
const userId = args['telegram-user-id'];
const name = args['name'] ?? 'Tester Sandbox';
if (!/^\d+$/.test(userId ?? '')) {
  console.error('Uso: node scripts/seed-sandbox-tester.mjs --telegram-user-id <id numérico> [--name "Nombre"]');
  process.exit(1);
}
const phone = `+999${userId.padStart(10, '0')}`; // 13 dígitos, E.164 válido

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const [contact] = await sql`
    INSERT INTO contacts (phone, status, channel_origin, name)
    VALUES (${phone}, 'prospecto', 'whatsapp', ${name})
    ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name
    RETURNING id`;
  await sql`
    INSERT INTO sandbox_identities (provider, external_user_id, contact_id, synthetic_phone)
    VALUES ('telegram_sandbox', ${userId}, ${contact.id}, ${phone})
    ON CONFLICT DO NOTHING`;
  await sql`
    INSERT INTO conversations (contact_id, channel, status)
    VALUES (${contact.id}, 'whatsapp', 'open')
    ON CONFLICT DO NOTHING`;
  console.log(JSON.stringify({ contact_id: contact.id, synthetic_phone: phone }));
} finally {
  await sql.end();
}
```

Nota: si `sandbox_identities` o `conversations` tienen constraints de unicidad con otros nombres de columna, el error de Postgres lo dice — ajustar el `ON CONFLICT` a la constraint real, no borrarlo.

- [ ] **Step 3: Probarlo dos veces contra el cluster local (idempotencia)**

```bash
node scripts/seed-sandbox-tester.mjs --telegram-user-id 123456789 --name "Prueba"
node scripts/seed-sandbox-tester.mjs --telegram-user-id 123456789 --name "Prueba"
psql "$DATABASE_URL" -c "SELECT count(*) FROM sandbox_identities WHERE external_user_id='123456789'"
```

Expected: mismo `contact_id` en ambas corridas; count = 1.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-sandbox-tester.mjs
git commit -m "feat: script de alta idempotente del tester sandbox"
```

---

### Task 5: Runbook de simulación local (túnel + webhooks)

**Files:**
- Create: `docs/runbooks/simulacion-local-a-b-a.md`

**Interfaces:**
- Consumes: `.env.example` (variables `TELEGRAM_AGENT_B_*`, `VOICE_PROVIDER=telegram_sandbox`, `BUSINESS_WORKSPACE_SLUG`), ruta `/api/webhooks/voice/telegram`.
- Produces: runbook que la Task 6 sigue al pie de la letra.

- [ ] **Step 1: Escribir el runbook con este contenido exacto**

````markdown
# Runbook — Simulación local A→B→A (Telegram sandbox)

## Qué prueba
El ciclo completo en tu máquina: le pedís una llamada a Bot A, Bot B te
escribe con el contexto (simula la llamada), marcás el veredicto, y el cron
post-llamada te manda el mensaje de cierre. Sin Retell, sin WhatsApp, sin
efectos reales.

## Preparación (una vez)
1. `bash scripts/pg-native-up.sh` y aplicar migraciones + seed:
   `psql "$DATABASE_URL" -f supabase/seed/dev.sql`
2. `.env.local`: copiar de `.env.example` y completar
   `TELEGRAM_AGENT_B_BOT_TOKEN`, `TELEGRAM_AGENT_B_WEBHOOK_SECRET` (inventá un
   secreto largo), `TELEGRAM_AGENT_B_SMOKE_CHAT_ID`, `TELEGRAM_AGENT_B_SMOKE_USER_ID`
   (tu chat id y user id de Telegram — te los da @userinfobot),
   `VOICE_PROVIDER=telegram_sandbox`, `BUSINESS_WORKSPACE_SLUG=studyx-sandbox`.
3. Tu identidad sandbox:
   `node scripts/seed-sandbox-tester.mjs --telegram-user-id <TU_USER_ID> --name "Tu Nombre"`
4. Abrí Bot B en Telegram y mandale `/start` (un bot no puede iniciarte
   conversación en frío).

## Por sesión de prueba
1. `npm run dev` (puerto 3000).
2. Túnel: `ngrok http 3000` (o `cloudflared tunnel --url http://localhost:3000`).
   Copiá la URL https que te da.
3. Registrá el webhook de Bot B (rota en cada URL nueva del túnel):
   ```bash
   curl -sS "https://api.telegram.org/bot${TELEGRAM_AGENT_B_BOT_TOKEN}/setWebhook" \
     -d "url=<URL_DEL_TUNEL>/api/webhooks/voice/telegram" \
     -d "secret_token=${TELEGRAM_AGENT_B_WEBHOOK_SECRET}"
   curl -sS "https://api.telegram.org/bot${TELEGRAM_AGENT_B_BOT_TOKEN}/getWebhookInfo"
   ```
   `getWebhookInfo` debe mostrar tu URL y `pending_update_count: 0`.
4. Bot A vive en Botpress: para la simulación local NO hace falta si inyectás
   el turno inbound directo al backend (ver runbook de la corrida E2E). Si
   querés la experiencia completa chateando con Bot A, configurá su webhook
   en el panel de Botpress hacia el mismo túnel.

## Al terminar
```bash
curl -sS "https://api.telegram.org/bot${TELEGRAM_AGENT_B_BOT_TOKEN}/deleteWebhook"
```
para que Telegram no siga pegándole a un túnel muerto.

## Qué mirar si no llega el mensaje de Bot B
- `getWebhookInfo` → `last_error_message` es el primer diagnóstico.
- El backend loguea el dispatch: buscá el `call_id` en los logs de `next dev`.
- `call_context_receipts`: `ack.status`, `delivery_status` y `verdict`
  separan "B armó el contexto" / "Telegram aceptó" / "vos confirmaste".
````

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/simulacion-local-a-b-a.md
git commit -m "docs: runbook de simulación local A→B→A"
```

---

### Task 6: Corrida E2E A→B→A con evidencia

**Files:**
- Create: `docs/evidence/simulacion-local-a-b-a.md`
- Posibles fixes menores en: `src/features/calls/**` (solo si la corrida los revela)

**Interfaces:**
- Consumes: todo lo anterior + `POST /api/agent/ingest` (o `scripts/run-pilot.mjs`) para inyectar el turno; cron `/api/cron/post-call-followup`.
- Produces: evidencia de la primera corrida completa del ciclo con el workspace StudyX.

- [ ] **Step 1: (Haiku scout) Determinar el camino de inyección del turno inbound**

Leer `scripts/run-pilot.mjs` y `src/app/api/agent/ingest/route.ts` (firma HMAC, shape del envelope) y devolver: el comando exacto para inyectar un mensaje inbound `"dale, llamame"` para el `contact_id` del tester creado en Task 4, con `provider='telegram_sandbox'`. Si `run-pilot.mjs` ya arma envelopes firmados, preferirlo.

- [ ] **Step 2: Ejecutar la secuencia completa**

Con el runbook de Task 5 activo (dev server + túnel + webhook registrado):

1. Inyectar el turno con el comando del Step 1.
2. Disparar el claim/decisión (el scout del Step 1 reporta si es automático o si hay que invocar el endpoint de claim-batch).
3. Verificar en DB que la decisión reservó la llamada:
   ```bash
   psql "$DATABASE_URL" -c "SELECT id, status, provider FROM call_sessions ORDER BY created_at DESC LIMIT 1"
   ```
   Expected: `status='requested'` o posterior, `provider='telegram_sandbox'`.
4. Mirar Telegram: debe llegarte el mensaje de Bot B con el contexto y dos botones. Apretar el de "correcto".
5. Verificar el veredicto y el cierre del ledger:
   ```bash
   psql "$DATABASE_URL" -c "SELECT ack->>'status' AS ack, delivery_status, verdict FROM call_context_receipts ORDER BY created_at DESC LIMIT 1"
   ```
6. Llevar la llamada a estado terminal (si el simulador no emite `ended` solo, insertar el evento vía el webhook o el helper que el scout identifique) y correr el cron:
   ```bash
   curl -sS -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/post-call-followup
   ```
7. Verificar el mensaje de cierre B→A:
   ```bash
   psql "$DATABASE_URL" -c "SELECT event_kind, external_event_id FROM channel_events WHERE event_kind='system_call_result' ORDER BY created_at DESC LIMIT 1"
   ```
   Expected: 1 fila `system:call_result:<call_id>`. Correr el cron una segunda vez y verificar que NO aparece una segunda fila (idempotencia FR-1 de spec 007).

- [ ] **Step 3: Registrar la evidencia**

Escribir `docs/evidence/simulacion-local-a-b-a.md` con: fecha, commit hash, workspace usado, los 7 checks del Step 2 con su resultado (sin ids reales de Telegram ni tokens), y cualquier fix aplicado.

- [ ] **Step 4: Commit**

```bash
git add docs/evidence/simulacion-local-a-b-a.md
git commit -m "test: evidencia de la corrida E2E A→B→A local con workspace studyx"
```

---

### Task 7: Checkpoint, push y estado

- [ ] **Step 1: Verificación final completa**

```bash
npm run typecheck && npm run lint && npx vitest run --config vitest.config.mts && npm run test:integration
```

Expected: todo verde. Si algo falla, volver a la tarea correspondiente — no commitear en rojo.

- [ ] **Step 2: Invocar la skill `studyx-checkpoint`** (corre las verificaciones del proyecto, escribe el resumen de estado que sobrevive al reinicio de contexto).

- [ ] **Step 3: Push**

```bash
git push -u personal feat/studyx-datos-y-sim-local
```

---

## Proceso repetible de actualización de datos (cuando StudyX responda)

Este plan deja el mecanismo listo; actualizar datos NO requiere un plan nuevo:

1. Editar `supabase/seed/studyx.sql` — **no** `dev.sql`. Durante la ejecución
   (Ruling 11) StudyX se separó a su propio archivo de seed: `dev.sql` quedó
   sólo con fixtures sintéticas y no contiene ninguna referencia a StudyX.
   Ejemplos de edición: precio confirmado → `price_type='fixed'`,
   `price_amount=…`; nueva política → editar el `knowledge_sources`
   correspondiente **subiendo `version`**.
2. Aplicarlo. Es idempotente (`ON CONFLICT`), así que actualiza en el lugar:

   ```bash
   # Local, que es donde se prueba primero:
   psql "$TEST_DATABASE_URL" -f supabase/seed/studyx.sql
   ```

   Contra producción, sólo después de que el cambio esté verificado localmente
   y con la URL escrita a mano en ese momento — nunca `$DATABASE_URL` desde un
   comando copiado, por lo explicado en el bloque del inicio.
3. El trigger de `knowledge_projection_jobs` re-encola la proyección de las fuentes editadas; el cron `/api/cron/project-knowledge` (cada 15 min) reconstruye el índice vectorial.
4. Ajustar los asserts de `tests/integration/studyx-seed.test.ts` (p.ej. quitar el assert de `price_amount IS NULL` para los cursos con precio confirmado) — el test es el contrato de qué datos son válidos.
5. Correr Task 7 de nuevo (verificación + checkpoint + push).

Preguntas abiertas que bloquean cada dato (Parte E del análisis): #1 precio real ($699 vs $1.200) → `price_amount`; #3 cuotas → `billing_interval` y guardrails; #5 texto del certificado → knowledge_source de política; #7 catálogo oficial firmado → agregar los 16 cursos restantes.
