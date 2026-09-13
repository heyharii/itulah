-- A letter can be written from a pattern.
--
-- Asked for by the owner on 2026-09-13, in the same breath as the blank
-- letter: "dan jg surat harusnya ada templatenya ya". It is the obvious next
-- thing once letters can be written from nothing — the fourth time somebody
-- types "Dengan ini kami menugaskan Sdr. … untuk mengambil barang retur" they
-- should be choosing it, not typing it.
--
-- # What a template is, and what it deliberately is not
--
-- It is the WRITABLE half of a letter, saved: the wording, and the head a
-- person would otherwise retype. It is not a letter — it has no number, it is
-- never issued, nobody signs it — and it is not a layout. What the paper looks
-- like belongs to the app; what it says belongs to the company.
--
-- So a template holds exactly two things: `body`, the editor's document, and
-- `facts`, the handful of typed head fields. It never holds lines: goods come
-- from the record a letter is drawn from, and a saved table of goods would be
-- last month's delivery printed onto this month's.
--
-- # Why it is per kind
--
-- A goods receipt note and a covering letter have nothing to say to each
-- other, and offering the wrong one is worse than offering none. The kind is
-- checked against the same three words `letter.kind` allows.
--
-- # Why nothing is deleted
--
-- Retiring rather than deleting, the rule the master lists in this system
-- already follow: a template that was used to write forty letters is part of
-- how those letters came to say what they say, and a row that vanishes takes
-- that with it. `retired_at` hides it from the picker and nothing else.

CREATE TABLE letter_template (
    template_id uuid PRIMARY KEY,
    kind        text NOT NULL CHECK (kind IN ('GOODS_RECEIPT', 'DELIVERY_NOTE', 'GENERAL')),
    name        text NOT NULL CHECK (btrim(name) <> ''),
    -- The editor's document, and the typed head. Same shapes the letter holds,
    -- because a template is a letter's writable half and nothing more.
    body        jsonb NOT NULL DEFAULT '{}'::jsonb,
    facts       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by  text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    retired_at  timestamptz,
    retired_by  text,
    CHECK ((retired_at IS NULL) = (retired_by IS NULL))
);

-- One name per kind, among the ones still offered. Two templates called
-- "Penugasan pengambilan retur" in the same menu is a choice nobody can make.
CREATE UNIQUE INDEX ux_letter_template_name
    ON letter_template (kind, lower(btrim(name)))
    WHERE retired_at IS NULL;

CREATE INDEX ix_letter_template_kind ON letter_template (kind, name);

COMMENT ON TABLE letter_template IS
    'The writable half of a letter, saved and named: wording plus the typed '
    'head. Never lines — goods come from the record, never from a pattern.';
