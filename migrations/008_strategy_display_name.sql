ALTER TABLE strategies
ADD COLUMN IF NOT EXISTS display_name VARCHAR(100);

UPDATE strategies
SET display_name = name
WHERE display_name IS NULL OR BTRIM(display_name) = '';
