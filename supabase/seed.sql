-- Canonical local reset entrypoint.
-- `\ir` resolves relative to this file, so a Supabase CLI reset and the
-- native disposable PostgreSQL runner apply exactly the same ordered seed.
\set ON_ERROR_STOP on
\ir seed/dev.sql
\ir seed/studyx.sql
\ir seed/studyx-temarios.sql
\ir seed/studyx-manual.sql
