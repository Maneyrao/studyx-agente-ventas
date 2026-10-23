-- Durable scheduling evidence for course-bonus follow-ups. The database row is
-- the source of truth; Botpress events are replaceable delivery attempts.
ALTER TABLE public.course_bonus_followups
  ADD COLUMN schedule_attempt_count integer NOT NULL DEFAULT 0 CHECK (schedule_attempt_count >= 0),
  ADD COLUMN max_schedule_attempts integer NOT NULL DEFAULT 10 CHECK (max_schedule_attempts BETWEEN 1 AND 20),
  ADD COLUMN last_schedule_at timestamptz;

CREATE INDEX course_bonus_followups_dispatch_due_idx
  ON public.course_bonus_followups (due_at, last_schedule_at, created_at)
  WHERE status = 'pending' AND provider_event_id IS NULL;

COMMENT ON COLUMN public.course_bonus_followups.provider_event_id IS
  'Botpress schedule receipt. NULL remains recoverable by the cron dispatcher; duplicate events are fenced at claim.';
