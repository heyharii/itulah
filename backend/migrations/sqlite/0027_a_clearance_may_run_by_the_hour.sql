-- 0027: The shop's half — a clearance that runs on chosen days and hours.
--
-- Mirrors postgres 0088. The weekdays travel as a JSON array rather than a
-- typed one, for the reason `tags_json` does on the catalogue: nothing here
-- queries inside the value, it is read once per markdown and handed straight
-- to the engine.
ALTER TABLE commercial_markdown ADD COLUMN iso_weekdays_json TEXT;
ALTER TABLE commercial_markdown ADD COLUMN from_minute INTEGER;
ALTER TABLE commercial_markdown ADD COLUMN to_minute INTEGER;
