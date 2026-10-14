-- Agent A owns semantic identity interpretation. Nullable profiles keep legacy
-- callers compatible; each contact migrates lazily inside a row-locked ingest
-- or profile transaction. No existing row or grant is rewritten here.
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS contact_profile_v1 jsonb;

ALTER TABLE public.contacts ADD CONSTRAINT contacts_contact_profile_v1_shape_check CHECK (
  contact_profile_v1 IS NULL OR COALESCE(
    jsonb_typeof(contact_profile_v1) = 'object'
    AND contact_profile_v1->>'owner' = 'agent_a_v1'
    AND contact_profile_v1->>'schema_version' = '1'
    AND jsonb_typeof(contact_profile_v1->'version') = 'number'
    AND (contact_profile_v1->>'version')::numeric >= 0
    AND (contact_profile_v1->>'version')::numeric = trunc((contact_profile_v1->>'version')::numeric)
    AND jsonb_typeof(contact_profile_v1->'fields') = 'object'
    AND contact_profile_v1->'fields' ?& ARRAY['nombre', 'apellido', 'correo', 'telefono']
    AND jsonb_typeof(contact_profile_v1#>'{fields,nombre}') = 'object'
    AND jsonb_typeof(contact_profile_v1#>'{fields,apellido}') = 'object'
    AND jsonb_typeof(contact_profile_v1#>'{fields,correo}') = 'object'
    AND jsonb_typeof(contact_profile_v1#>'{fields,telefono}') = 'object'
    AND jsonb_typeof(contact_profile_v1#>'{fields,nombre,value}') IN ('string', 'null')
    AND jsonb_typeof(contact_profile_v1#>'{fields,apellido,value}') IN ('string', 'null')
    AND jsonb_typeof(contact_profile_v1#>'{fields,correo,value}') IN ('string', 'null')
    AND jsonb_typeof(contact_profile_v1#>'{fields,telefono,value}') IN ('string', 'null')
    AND contact_profile_v1#>>'{fields,nombre,status}' IN ('missing', 'confirmed', 'retracted')
    AND contact_profile_v1#>>'{fields,apellido,status}' IN ('missing', 'confirmed', 'retracted')
    AND contact_profile_v1#>>'{fields,correo,status}' IN ('missing', 'confirmed', 'retracted')
    AND contact_profile_v1#>>'{fields,telefono,status}' IN ('missing', 'confirmed', 'retracted')
    AND jsonb_array_length(jsonb_path_query_array(contact_profile_v1, '$.fields.*.version')) = 4
    AND NOT jsonb_path_exists(contact_profile_v1,
      '$.fields.* ? (@.version.type() != "number" || @.version < 0 || @.version % 1 != 0)')
    AND NOT jsonb_path_exists(contact_profile_v1, '$.fields.* ? (@.version > $version)',
      jsonb_build_object('version', contact_profile_v1->'version'))
    AND NOT jsonb_path_exists(contact_profile_v1,
      '$.fields.* ? ((@.status == "confirmed" && @.value.type() != "string") || (@.status != "confirmed" && @.value.type() != "null"))')
    AND jsonb_array_length(jsonb_path_query_array(contact_profile_v1, '$.fields.*.source_seq')) = 4
    AND NOT jsonb_path_exists(contact_profile_v1,
      '$.fields.* ? (@.source_seq.type() != "null" && (@.source_seq.type() != "number" || @.source_seq < 1 || @.source_seq % 1 != 0))')
    AND jsonb_array_length(jsonb_path_query_array(contact_profile_v1, '$.fields.*.source_message_id')) = 4
    AND jsonb_array_length(jsonb_path_query_array(contact_profile_v1, '$.fields.*.source_conversation_id')) = 4
    AND jsonb_array_length(jsonb_path_query_array(contact_profile_v1, '$.fields.*.source_quote')) = 4
    AND NOT jsonb_path_exists(contact_profile_v1,
      '$.fields.* ? ((@.source_message_id.type() != "string" && @.source_message_id.type() != "null") || (@.source_conversation_id.type() != "string" && @.source_conversation_id.type() != "null") || (@.source_quote.type() != "string" && @.source_quote.type() != "null"))')
    AND jsonb_array_length(jsonb_path_query_array(contact_profile_v1, '$.fields.*.source')) = 4
    AND NOT jsonb_path_exists(contact_profile_v1,
      '$.fields.* ? (@.source != null && @.source != "agent_a_v1" && @.source != "legacy" && @.source != "channel")')
    AND NOT jsonb_path_exists(contact_profile_v1,
      '$.fields.* ? (@.source == "agent_a_v1" && (@.source_message_id.type() != "string" || @.source_conversation_id.type() != "string" || @.source_quote.type() != "string" || @.source_seq.type() != "number"))'),
    false)
);

COMMENT ON COLUMN public.contacts.contact_profile_v1 IS
  'Agent A canonical independent identity fields, per-field versions and literal inbound provenance; legacy columns are compatibility projections.';
