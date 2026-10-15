-- Run after the three 20261015 migrations, only in the verified StudyX database.
-- Enables the available Supabase Cron extension; no HTTP secret or paid Vercel
-- cron frequency is needed. Existing unrelated jobs are untouched.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'studyx-expire-inbound-recoveries-v1',
  '* * * * *',
  $$SELECT * FROM public.expire_inbound_batch_recoveries('studyx', 100);$$
);
-- Rollback scheduling only:
-- SELECT cron.unschedule('studyx-expire-inbound-recoveries-v1');
