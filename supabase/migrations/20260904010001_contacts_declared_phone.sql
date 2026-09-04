-- Teléfono comercial declarado, separado de la identidad de transporte.
--
-- `contacts.phone` es NOT NULL UNIQUE y es la clave con la que el canal
-- encuentra al contacto. Los canales que no entregan un teléfono real —hoy
-- Telegram— acuñan uno sintético con prefijo `+999`, un código de país
-- reservado por la ITU y no ruteable (`mintSyntheticPhone` en
-- `botpress-agent/src/channels/shared/telegram-envelope.ts`).
--
-- El contrato comercial pide seis datos, y uno es el teléfono. El lector
-- comercial devolvía `contacts.phone` como si fuera ese dato, así que
-- `intake_missing` nunca podía contener `telefono` y el gate del link de pago
-- se abría sobre un número que el cliente jamás dio. Tener un string no
-- demuestra tener un teléfono.
--
-- Esta columna es el lugar donde vive el número que la persona declara en la
-- conversación. No reemplaza ni pisa `contacts.phone`: si se sobrescribiera la
-- clave del canal, el contacto dejaría de ser encontrable y dos personas
-- distintas podrían colisionar en la unicidad.
--
-- No es un séptimo dato: es dónde se guarda el sexto. Sin esta columna el
-- teléfono declarado no tiene persistencia y el gate queda cerrado para
-- siempre en Telegram.
--
-- Aditiva y nullable: NULL significa «todavía no lo declaró», que es
-- exactamente lo que `missingContactIntakeFieldsV1` lee como faltante. No hay
-- backfill posible ni deseable — nadie declaró un teléfono todavía.

BEGIN;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS declared_phone text;

COMMENT ON COLUMN contacts.declared_phone IS
  'Teléfono que la persona declara en la conversación. NULL = no declarado. Distinto de contacts.phone, que es la identidad del canal y puede ser sintética (+999).';

-- Sin UNIQUE a propósito: dos contactos pueden declarar el mismo número (un
-- teléfono familiar, un error de tipeo) y eso no debe voltear la ingesta. La
-- unicidad que importa sigue siendo la del canal, en contacts.phone.
--
-- Sin CHECK de formato E.164 a propósito: el formato lo valida la captura, en
-- TypeScript, donde un número mal escrito puede repreguntarse. Un CHECK acá
-- convertiría un dato mal tipeado en un error de escritura del turno entero.

COMMIT;
