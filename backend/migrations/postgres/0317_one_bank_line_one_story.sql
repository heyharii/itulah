-- One bank line, one story.
--
-- # What was wrong
--
-- Three mechanisms can point at a `bank_statement_line`, and none of them
-- asked the others: a giro's clearance names it (`giro.cleared_line_id`),
-- booking it as a document claims it (`ux_cash_document_statement_line`),
-- and matching it to a journal line claims it (`bank_line_match`). Booking
-- refused a MATCHED line, but nothing refused matching or booking a line a
-- giro had cleared, and nothing told the giro the line was already spoken
-- for. The same money from the same statement could reach the books twice,
-- and the reconciliation screen would show the line as agreed while it was
-- agreed about two different things.
--
-- # The shape
--
-- One claim row per line, mutable ownership, with an audit of the release.
-- Kinds are exclusive AGAINST EACH OTHER and not against themselves: a match
-- may split a line across several journal lines (0213) and that stays legal;
-- what becomes impossible is a line that is a giro's clearance evidence on
-- Monday and a booked charge on Tuesday.
--
-- Rows written before this migration are not backfilled: no environment
-- holds any, and a guard that invents history would be worse than none.

CREATE TABLE bank_line_claim (
    line_id     uuid PRIMARY KEY REFERENCES bank_statement_line(line_id),

    -- Which story this line is part of.
    claim_kind  text NOT NULL CHECK (claim_kind IN ('MATCH', 'CASH_DOCUMENT', 'GIRO_CLEAR')),

    claimed_by  text NOT NULL CHECK (btrim(claimed_by) <> ''),
    claimed_at  timestamptz NOT NULL DEFAULT now(),

    -- A release is a fact with a name on it, not a DELETE: the row is the
    -- history of the line's ownership, and "unmatched by whom" is the
    -- question an auditor asks next.
    released_by text CHECK (released_by IS NULL OR btrim(released_by) <> ''),
    released_at timestamptz,

    CHECK ((released_by IS NULL) = (released_at IS NULL))
);

COMMENT ON TABLE bank_line_claim IS
    'Which of the three stories a bank line belongs to — matched, booked as a document, or a giro''s clearance evidence. Kinds are mutually exclusive; a match may still split across journal lines.';
