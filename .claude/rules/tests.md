---
paths:
  - "tests/**"
  - "**/*.test.ts"
  - "supabase/tests/**"
  - "botpress-agent/evals/**"
---

# Tests — reglas de subsistema

## Cómo correr (barato primero)
1. Test puntual del archivo tocado.
2. Suite de la carpeta.
3. Suite completa sólo antes de cerrar la fase.
Nunca volcar la salida completa de una corrida verde: reportar sólo fallos y
su stack relevante.

## Regla no negociable
Un test que falla se arregla en el código, nunca debilitando el test.
Si un test se relaja, hay que justificarlo por escrito en el commit.

## Cobertura obligatoria
Cada fila de `docs/FAILURE_MATRIX.md` necesita su test con evidencia.
Casos que no pueden faltar: reentrega ×10, mismo ID con otro contenido (409),
mensajes concurrentes, contacto bloqueado, opt-out, OpenAI caído,
pgvector caído, entrega ambigua, firma inválida.

## Integración
Contra base desechable vía `TEST_DATABASE_URL`. Nunca contra el proyecto
remoto compartido.
