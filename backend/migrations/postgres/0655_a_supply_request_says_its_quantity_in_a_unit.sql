-- A supply request says its quantity in a unit the company knows.
--
-- GA's requests kept the quantity as free text ("2 rim", "5 dus"), which is
-- how a shop asks and how it should keep asking. The owner wants units to
-- mean the same thing everywhere (2026-09-28), so the text is now also READ:
-- when it is a number and a unit the master knows, the number and the unit
-- code are kept beside it. Text that does not read that way stays text, and
-- nothing is refused for it.
--
-- The master gains the packaging and supply units GA and suppliers print —
-- a ream, a box, a pack, a carton. None has a global factor: a DUS of one
-- thing is not a DUS of another, so what one is worth is the article's own
-- unit row (0653), never the master.

ALTER TABLE ga_supply_request
    ADD COLUMN quantity_value numeric(14, 4) CHECK (quantity_value IS NULL OR quantity_value > 0),
    ADD COLUMN unit_code      text REFERENCES unit_of_measure (code);

INSERT INTO unit_of_measure (code, label, category, whole_number, created_by, updated_by)
SELECT code, label, 'COUNT', true, 'migration:0655', 'migration:0655'
  FROM (VALUES
        ('PASANG', 'Pasang'),
        ('SET',    'Set'),
        ('LEMBAR', 'Lembar'),
        ('RIM',    'Rim'),
        ('PAK',    'Pak'),
        ('DUS',    'Dus'),
        ('BOX',    'Box'),
        ('KARTON', 'Karton'),
        ('BOTOL',  'Botol'),
        ('ROLL',   'Roll'),
        ('BAL',    'Bal')
       ) AS seed (code, label)
 WHERE NOT EXISTS (SELECT 1 FROM unit_of_measure u WHERE u.code = seed.code);

-- A ream is five hundred sheets everywhere; that one is global.
INSERT INTO unit_conversion (conversion_id, from_unit, to_unit, factor, note, created_by, updated_by)
SELECT gen_random_uuid(), 'RIM', 'LEMBAR', 500, '1 rim = 500 lembar', 'migration:0655', 'migration:0655'
 WHERE NOT EXISTS (SELECT 1 FROM unit_conversion WHERE from_unit = 'RIM' AND to_unit = 'LEMBAR');

INSERT INTO unit_alias (alias, unit_code, created_by)
SELECT alias, unit_code, 'migration:0655'
  FROM (VALUES
        ('psg', 'PASANG'), ('pair', 'PASANG'), ('pairs', 'PASANG'), ('prs', 'PASANG'),
        ('lbr', 'LEMBAR'), ('sheet', 'LEMBAR'),
        ('rm', 'RIM'), ('ream', 'RIM'),
        ('pack', 'PAK'), ('pck', 'PAK'), ('pk', 'PAK'),
        ('dos', 'DUS'),
        ('ctn', 'KARTON'), ('krt', 'KARTON'), ('carton', 'KARTON'),
        ('btl', 'BOTOL'), ('bottle', 'BOTOL'),
        ('rol', 'ROLL')
       ) AS seed (alias, unit_code)
 WHERE EXISTS (SELECT 1 FROM unit_of_measure u WHERE u.code = seed.unit_code)
   AND NOT EXISTS (SELECT 1 FROM unit_alias a WHERE a.alias = seed.alias);
