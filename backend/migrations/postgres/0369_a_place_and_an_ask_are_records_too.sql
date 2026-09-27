-- A place and a supply request join the one vocabulary of records.
--
-- GA's two tahap-5 objects are things a person wants to attach a photograph, a
-- comment or a line of history to: the signed lease for a site, the quotation
-- for a mop. That is what `record_kind` is for (0190), and it is why the two
-- words are declared here rather than left to the screens. `migration_hygiene`
-- compares this table against `RecordKind::ALL`, so the list in Rust and the
-- list here have to move in one change or the test says which half was
-- forgotten.

INSERT INTO record_kind (code, label) VALUES
    ('location', 'Location'),
    ('supply_request', 'Supply request')
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
    missing text;
BEGIN
    SELECT string_agg(want.code, ', ')
      INTO missing
      FROM (VALUES ('location'), ('supply_request')) AS want(code)
     WHERE NOT EXISTS (SELECT 1 FROM record_kind k WHERE k.code = want.code);

    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'record_kind is missing: %', missing;
    END IF;
END $$;
