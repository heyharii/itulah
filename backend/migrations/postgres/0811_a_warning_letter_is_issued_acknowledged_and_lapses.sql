-- 0811: a warning letter is issued, acknowledged, and lapses.
--
-- Teguran / SP, kept by the owner on 2026-09-30 (Hubungan industrial). A
-- verbal warning on record (TEGURAN), then the three surat peringatan. Each
-- SP is in force six months unless the company's rules say otherwise (UU
-- 13/2003 pasal 161 ayat 2), so a letter carries the day it lapses. The
-- employee acknowledges it from their phone — the record that they were told,
-- not that they agreed — and head office may revoke one issued in error. A
-- letter is never deleted.

CREATE TABLE warning_letter (
    id               text PRIMARY KEY CHECK (btrim(id) <> ''),
    employee_id      text NOT NULL REFERENCES employee (id),
    level            text NOT NULL CHECK (level IN ('TEGURAN', 'SP1', 'SP2', 'SP3')),
    issued_on        date NOT NULL,
    valid_until      date NOT NULL,
    -- What was done, as the letter states it.
    violation        text NOT NULL CHECK (btrim(violation) <> ''),
    issued           jsonb NOT NULL,
    acknowledged_at  timestamptz,
    revoked_at       timestamptz,
    revoked          jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT warning_letter_lapses_after_it_is_issued CHECK (valid_until >= issued_on),
    CONSTRAINT warning_letter_revocation_is_signed CHECK ((revoked_at IS NULL) = (revoked IS NULL))
);

CREATE INDEX ix_warning_letter_employee ON warning_letter (employee_id, issued_on DESC);
