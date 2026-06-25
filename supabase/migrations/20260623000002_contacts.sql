CREATE TABLE contacts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone          text        NOT NULL,
  status         text        NOT NULL DEFAULT 'prospecto'
                             CHECK (status IN ('prospecto', 'cliente', 'inactivo')),
  channel_origin text        NOT NULL
                             CHECK (channel_origin IN ('whatsapp', 'voice')),
  opted_in_at    timestamptz NOT NULL DEFAULT now(),
  name           text,
  email          text,
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contacts_phone_unique UNIQUE (phone)
);

CREATE INDEX contacts_phone_idx  ON contacts (phone);
CREATE INDEX contacts_status_idx ON contacts (status) WHERE deleted_at IS NULL;
