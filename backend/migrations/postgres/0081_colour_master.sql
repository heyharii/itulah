-- 0081: Colour becomes a thing that is picked, not a word that is typed.
--
-- `article_colour.label` is free text, unique only within one article. There
-- is no master, so nothing stops "Navy", "navy" and "Biru Navy" being three
-- different colours across the catalogue — which is exactly the split 0027
-- created the `tag` table to prevent, repeated one table over. A colour filter
-- over free text finds a third of the navy garments and reports that as the
-- answer.
--
-- The company's previous estate hit this and solved it the same way
-- (`740_color_identity.sql`): one master, an identity per colour, and the
-- article↔colour row stops describing a colour and starts naming one.
--
-- # What this migration does NOT do
--
-- It does not widen `colour_digit` and it does not touch the SKU format, so
-- the ten-colourway ceiling stands. The digit is one character of an 11-digit
-- SKU that the warehouse, the handhelds and the printed labels already speak;
-- lifting the cap is a change to the business code, not to this table.
--
-- It also drops nothing. `label` and `hex_code` keep their data on both tables
-- and only lose their NOT NULL, so nothing written before today is lost and a
-- deploy that has to be rolled back has something to roll back to. Pushing to
-- main here is a production deploy (render.yaml), which makes a DROP COLUMN
-- irreversible the moment it lands. A later migration removes them once
-- production is confirmed to be reading `colour_code` and nothing else — the
-- legacy migration made the same call, in the same words: nothing is dropped.
--
-- # The colour code is derived from the LABEL, never from the digit
--
-- `colour_digit` is article-scoped: digit 3 is a different colour on a
-- different article, and that is correct, because the digit only has meaning
-- inside the SKU string it sits in. It is therefore not a colour code and must
-- never be turned into one.

CREATE TABLE colour (
    code          text PRIMARY KEY CHECK (btrim(code) <> ''),
    label         text NOT NULL CHECK (btrim(label) <> ''),
    hex_code      text CHECK (hex_code IS NULL OR hex_code ~ '^#[0-9A-Fa-f]{6}$'),
    display_order integer NOT NULL DEFAULT 0,
    active        boolean NOT NULL DEFAULT true,
    -- Renaming a colour renames it on every article wearing it, so the edit is
    -- guarded the way every other edit here is: If-Match against this. Two
    -- merchandisers renaming one row in two tabs must not both succeed.
    version       integer NOT NULL DEFAULT 1,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- The same guard `tag` carries, for the same reason: two rows both reading
-- "Navy" are the split this table exists to prevent, and a picker showing the
-- same word twice teaches people to distrust it.
CREATE UNIQUE INDEX colour_label_unique ON colour (lower(btrim(label)));

-- A starter list: neutrals and the basics a garment range actually reaches
-- for. Deliberately short. A hundred invented rows would be a picker nobody
-- can scan and a vocabulary nobody agreed to; merchandising adds what it
-- actually sells, through POST /api/v1/colours.
INSERT INTO colour (code, label, hex_code, display_order) VALUES
    ('BLACK',      'Black',      '#111111',  10),
    ('CHARCOAL',   'Charcoal',   '#36454F',  20),
    ('GREY',       'Grey',       '#808080',  30),
    ('WHITE',      'White',      '#FFFFFF',  40),
    ('OFF_WHITE',  'Off White',  '#F2EFE6',  50),
    ('NATURAL',    'Natural',    '#D9CFC1',  60),
    ('BEIGE',      'Beige',      '#D8C3A5',  70),
    ('KHAKI',      'Khaki',      '#A89A6B',  80),
    ('BROWN',      'Brown',      '#6B4A2F',  90),
    ('NAVY',       'Navy',       '#1F2A44', 100),
    ('BLUE',       'Blue',       '#2563EB', 110),
    ('LIGHT_BLUE', 'Light Blue', '#7EA6E0', 120),
    ('DENIM',      'Denim',      '#4A6D8C', 130),
    ('TEAL',       'Teal',       '#2A7D7D', 140),
    ('GREEN',      'Green',      '#2E7D46', 150),
    ('OLIVE',      'Olive',      '#6B7A3A', 160),
    ('MINT',       'Mint',       '#A8D8C0', 170),
    ('YELLOW',     'Yellow',     '#F2C230', 180),
    ('MUSTARD',    'Mustard',    '#C9A227', 190),
    ('ORANGE',     'Orange',     '#E8762C', 200),
    ('RED',        'Red',        '#C0392B', 210),
    ('MAROON',     'Maroon',     '#6E1E1E', 220),
    ('PINK',       'Pink',       '#E89AB0', 230),
    ('PURPLE',     'Purple',     '#6B4FA0', 240);

-- ---------------------------------------------------------------------------
-- Every colour the catalogue already believes in
-- ---------------------------------------------------------------------------
--
-- Two sources, unioned: the colourways articles actually carry, and the ones
-- setup sessions declared. Both are colours that real rows point at, so both
-- have to survive as master rows or the backfill below cannot resolve them.
--
-- Grouped on lower(btrim(label)), which is the same normalisation the label
-- index enforces: two spellings of one word are one colour.
--
-- MIN(hex_code) rather than a vote. Where one colour name was given two hex
-- values on two articles, one is chosen and the disagreement is left where it
-- is, visible in the old columns. A swatch is a merchandising decision, not a
-- migration's, and a migration that quietly picks a shade is a migration that
-- silently repaints goods.
--
-- The code is a slug of the label, and slugs are NOT injective: "Red/Blue" and
-- "Red Blue" reduce to the same string. `code` is the primary key, so a
-- collision would either abort this migration or drop a colour that garments
-- on a shelf are wearing. Collisions are suffixed with a short hash of the
-- normalised name instead: they are genuinely different colours and both must
-- exist.
INSERT INTO colour (code, label, hex_code, display_order)
SELECT src.code, src.label, src.hex_code, 900
  FROM (
        SELECT grouped.*,
               grouped.slug || CASE WHEN count(*) OVER (PARTITION BY grouped.slug) > 1
                                    THEN '_' || upper(substr(md5(grouped.norm), 1, 6))
                                    ELSE '' END AS code
          FROM (
                SELECT lower(btrim(n.label)) AS norm,
                       min(btrim(n.label))   AS label,
                       min(n.hex_code)       AS hex_code,
                       btrim(regexp_replace(upper(btrim(min(btrim(n.label)))),
                                            '[^A-Z0-9]+', '_', 'g'), '_') AS slug
                  FROM (
                        SELECT label, hex_code FROM article_colour
                         WHERE btrim(COALESCE(label, '')) <> ''
                        UNION ALL
                        SELECT label, hex_code FROM article_setup_colour
                         WHERE btrim(COALESCE(label, '')) <> ''
                       ) n
                 GROUP BY lower(btrim(n.label))
               ) grouped
       ) src
 WHERE btrim(src.slug) <> ''
   AND NOT EXISTS (SELECT 1 FROM colour c WHERE lower(btrim(c.label)) = src.norm)
   AND NOT EXISTS (SELECT 1 FROM colour c WHERE c.code = src.code);

-- ---------------------------------------------------------------------------
-- article_colour names a colour
-- ---------------------------------------------------------------------------

ALTER TABLE article_colour
    ADD COLUMN colour_code text REFERENCES colour(code);

-- By label first, because a label that matched a seeded colour was skipped
-- above and has no row of its own to match by code. Then by slug, which
-- catches the labels whose code was won by a colliding sibling.
UPDATE article_colour ac
   SET colour_code = c.code
  FROM colour c
 WHERE ac.colour_code IS NULL
   AND lower(btrim(c.label)) = lower(btrim(ac.label));

UPDATE article_colour ac
   SET colour_code = c.code
  FROM colour c
 WHERE ac.colour_code IS NULL
   AND c.code = btrim(regexp_replace(upper(btrim(ac.label)), '[^A-Z0-9]+', '_', 'g'), '_');

ALTER TABLE article_colour
    ALTER COLUMN colour_code SET NOT NULL,
    -- Kept, and no longer required. New rows name a colour and say nothing
    -- about it; the old rows keep what they said.
    ALTER COLUMN label DROP NOT NULL;

-- One article must not use the same colour under two digits. This is the same
-- rule the label index was reaching for — two digits a picker cannot tell
-- apart on a list — now stated against the thing that has an identity.
DROP INDEX article_colour_label_unique;
CREATE UNIQUE INDEX article_colour_colour_unique
    ON article_colour (article_id, colour_code);

CREATE INDEX ix_article_colour_colour ON article_colour (colour_code);

-- ---------------------------------------------------------------------------
-- article_setup_colour names one too
-- ---------------------------------------------------------------------------

ALTER TABLE article_setup_colour
    ADD COLUMN colour_code text REFERENCES colour(code);

UPDATE article_setup_colour asc_
   SET colour_code = c.code
  FROM colour c
 WHERE asc_.colour_code IS NULL
   AND lower(btrim(c.label)) = lower(btrim(asc_.label));

UPDATE article_setup_colour asc_
   SET colour_code = c.code
  FROM colour c
 WHERE asc_.colour_code IS NULL
   AND c.code = btrim(regexp_replace(upper(btrim(asc_.label)), '[^A-Z0-9]+', '_', 'g'), '_');

ALTER TABLE article_setup_colour
    ALTER COLUMN colour_code SET NOT NULL,
    ALTER COLUMN label DROP NOT NULL;

DROP INDEX article_setup_colour_label_unique;
CREATE UNIQUE INDEX article_setup_colour_colour_unique
    ON article_setup_colour (session_id, colour_code);

-- ---------------------------------------------------------------------------
-- An article can be edited, so it needs to say which version was edited
-- ---------------------------------------------------------------------------
--
-- Until now nothing edited an article: it was minted by a setup session and
-- never touched again, so it needed no version. The Articles screen changes
-- that, and every other editable record here carries If-Match against exactly
-- these three columns. Without them two people editing the same article in two
-- tabs both succeed and the second one silently wins.
ALTER TABLE article
    ADD COLUMN version    integer     NOT NULL DEFAULT 1,
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN updated_by text;

-- The Articles list sorts and pages by `article_code`, and its search matches
-- a code or a name typed into one box.
CREATE INDEX ix_article_active_code ON article (active, article_code);
CREATE INDEX ix_sku_article_colour ON sku (article_id, colour_digit)
    WHERE colour_digit IS NOT NULL;

COMMENT ON TABLE colour IS
    'The company-wide colour list. An article picks at most ten of these, one per colour digit; colours are picked, never typed.';
COMMENT ON COLUMN article_colour.label IS
    'Superseded by colour_code (0081). Kept with its data so the rename is reversible; new rows leave it null.';
COMMENT ON COLUMN article_setup_colour.label IS
    'Superseded by colour_code (0081). Kept with its data so the rename is reversible; new rows leave it null.';
