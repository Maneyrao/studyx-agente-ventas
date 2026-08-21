DO $$
DECLARE
  bad_rows integer;
BEGIN
  SELECT count(*) INTO bad_rows
  FROM selected_memories
  WHERE id IN (
    'e4000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000002'
  )
    AND (
      embedding_max_attempts < embedding_attempts
      OR embedding_state <> 'dead_letter'
    );
  IF bad_rows <> 0 THEN
    RAISE EXCEPTION 'embedding epoch migration stranded % legacy attempt rows', bad_rows;
  END IF;
END
$$;
