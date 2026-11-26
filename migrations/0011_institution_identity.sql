ALTER TABLE agus_institutions RENAME COLUMN legal_name TO display_name;
ALTER TABLE agus_institutions ADD COLUMN legal_entity_name text;
ALTER TABLE agus_institutions ADD COLUMN legal_entity_identifier text;
ALTER TABLE agus_institutions ADD COLUMN legal_entity_verified boolean NOT NULL DEFAULT false;
