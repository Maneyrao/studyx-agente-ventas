-- Supabase CLI loads this local globals file before project migrations.
-- The hosted project already provisions pgvector in `extensions`; the local
-- PostgreSQL image needs the same pre-migration layout so historical,
-- already-applied migrations remain immutable.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
