DO $$
DECLARE
  bad_rows integer;
  surviving_rows integer;
BEGIN
  SELECT count(*) INTO surviving_rows
  FROM selected_memories
  WHERE id IN (
    'e4000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000002',
    'e4000000-0000-4000-8000-000000000003'
  );
  IF surviving_rows <> 3 THEN
    RAISE EXCEPTION 'embedding epoch migration preserved only % of 3 legacy attempt rows', surviving_rows;
  END IF;

  SELECT count(*) INTO bad_rows
  FROM selected_memories
  WHERE id IN (
    'e4000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000002',
    'e4000000-0000-4000-8000-000000000003'
  )
    AND (
      embedding_max_attempts < embedding_attempts
      OR (id = 'e4000000-0000-4000-8000-000000000001' AND embedding_attempts <> 5)
      OR (id = 'e4000000-0000-4000-8000-000000000002' AND embedding_attempts <> 7)
      OR (id = 'e4000000-0000-4000-8000-000000000003' AND embedding_attempts <> 9)
      OR (id <> 'e4000000-0000-4000-8000-000000000003' AND embedding_state <> 'dead_letter')
      OR (id = 'e4000000-0000-4000-8000-000000000003' AND embedding_state <> 'failed')
    );
  IF bad_rows <> 0 THEN
    RAISE EXCEPTION 'embedding epoch migration stranded % legacy attempt rows', bad_rows;
  END IF;
END
$$;
