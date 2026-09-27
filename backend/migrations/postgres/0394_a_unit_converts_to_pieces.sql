-- A unit is a name for a number of pieces.
--
-- Stock is counted in pieces and always has been: every quantity on a movement,
-- a receipt or a count is a PCS. But nobody orders shoes one at a time. A
-- supplier quotes by the LUSIN (a dozen) or the KODI (a score), and a buyer who
-- has to do that arithmetic in their head before typing a purchase order is a
-- buyer who one day types 5 when they meant 5 lusin.
--
-- Two tables. `unit_of_measure` is the list of names the company uses, with one
-- of them marked as the base — the unit stock is actually kept in. There is at
-- most one base, and the database holds that rather than the code.
-- `unit_conversion` says how many of one unit another is worth:
--
--     Satuan lain | Satuan utama | Nilai konversi | Keterangan
--     LUSIN       | PCS          | 12             | ...
--     KODI        | PCS          | 20             | ...
--
-- read as "one LUSIN is twelve PCS". A conversion is a fact about two units and
-- nothing else, so a pair appears once, and a unit never converts to itself.
--
-- # What this refuses to decide
--
-- Nothing here changes what a quantity column means. A purchase order line is
-- still pieces; the screen that lets a buyer think in lusin converts before it
-- sends. Storing the unit a line was ordered in — so the paperwork can print
-- "5 lusin" back — is a later change with its own migration, not a column
-- slipped in here.
--
-- No delete, for either table. A unit that was used on a document is part of
-- what that document said; it is retired (`active = false`) instead, and hides
-- from the pickers while staying readable.
CREATE TABLE unit_of_measure (
    -- Upper case, no spaces: what a quantity is printed with ("12 PCS").
    code        text PRIMARY KEY
                    CHECK (code ~ '^[A-Z0-9_]{1,16}$'),
    label       text NOT NULL CHECK (btrim(label) <> ''),
    -- The unit stock is kept in. See the index below.
    is_base     boolean NOT NULL DEFAULT false,
    active      boolean NOT NULL DEFAULT true,

    version     integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by  text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  text NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- At most one base unit. Two would make "how many pieces is this" a question
-- with two answers.
CREATE UNIQUE INDEX unit_of_measure_one_base
    ON unit_of_measure ((true)) WHERE is_base;

CREATE TABLE unit_conversion (
    conversion_id  uuid PRIMARY KEY,
    -- "Satuan lain": the unit being described.
    from_unit      text NOT NULL REFERENCES unit_of_measure (code),
    -- "Satuan utama": the unit it is described in.
    to_unit        text NOT NULL REFERENCES unit_of_measure (code),
    -- "Nilai konversi": how many `to_unit` one `from_unit` is.
    factor         numeric(12,4) NOT NULL
                       CONSTRAINT unit_conversion_factor_positive CHECK (factor > 0),
    -- "Keterangan".
    note           text,
    active         boolean NOT NULL DEFAULT true,

    version        integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by     text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_by     text NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT unit_conversion_pair_once UNIQUE (from_unit, to_unit),
    CONSTRAINT unit_conversion_not_itself CHECK (from_unit <> to_unit)
);

-- The three the owner named (2026-09-26): the piece, the dozen and the score.
INSERT INTO unit_of_measure (code, label, is_base, created_by, updated_by) VALUES
    ('PCS',   'Piece', true,  'migration:0394', 'migration:0394'),
    ('LUSIN', 'Lusin', false, 'migration:0394', 'migration:0394'),
    ('KODI',  'Kodi',  false, 'migration:0394', 'migration:0394');

INSERT INTO unit_conversion
    (conversion_id, from_unit, to_unit, factor, note, created_by, updated_by)
VALUES
    ('7b0f3a52-2d1e-4c1a-9a51-0394000000a1', 'LUSIN', 'PCS', 12,
     '1 lusin = 12 pcs', 'migration:0394', 'migration:0394'),
    ('7b0f3a52-2d1e-4c1a-9a51-0394000000a2', 'KODI', 'PCS', 20,
     '1 kodi = 20 pcs', 'migration:0394', 'migration:0394');
